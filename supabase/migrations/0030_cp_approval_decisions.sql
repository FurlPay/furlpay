-- ---------------------------------------------------------------------------
-- 0030: human approval decisions for the control plane.
--
-- THE GAP THIS CLOSES. 0020 writes a cp_approvals row for every decision that
-- needs a human, and the lifecycle has APPROVE, RELEASE and DENY edges, but no
-- function could record a human's answer. A payment that required approval sat
-- in PENDING_APPROVAL until its authorization expired.
--
-- cp_decide_approval() records the answer as ONE fact: the approval row, the
-- authorization's phase, and an evidence record are written together or not at
-- all. Any two of those three without the third is a state an auditor cannot
-- explain: an APPROVED payment with no approver, an approver with no phase
-- change, or a decision with no evidence.
--
-- WHAT THE FUNCTION CHECKS, under the same per-organization advisory lock that
-- cp_record_decision takes, so evidence sequencing cannot interleave:
--   · the approval exists in this organization (another tenant's id is not found)
--   · it has not been decided. A repeat of the SAME decision by the SAME actor
--     returns the stored outcome with replayed=true, so a client retrying a lost
--     response does not see an error for something that worked.
--   · the authorization is still in the phase the application read
--     (p_from_phase), so a decision computed from a stale read cannot land
--   · the evidence slot the application hashed is still the next one. The leaf
--     hash commits to its sequence and predecessor, so a slot taken by a
--     concurrent write raises cp_evidence_slot_stale and the caller recomputes.
--
-- The application decides WHETHER the transition is allowed (the pure
-- resolveApprovalDecision in @furlpay/control-plane). This function makes the
-- write safe; it does not second-guess the rules beyond refusing an
-- approval-after-decision and a phase the FSM never produces.
--
-- Re-runnable: create or replace, and the function is the only object.
-- ---------------------------------------------------------------------------

create or replace function cp_decide_approval(
  p_organization_id text,
  p_approval_id     text,
  p_decision        text,         -- 'APPROVE' | 'DENY'
  p_actor           text,         -- the human's account id
  p_from_phase      text,         -- phase the application read
  p_to_phase        text,         -- 'APPROVED' | 'DENIED'
  p_step_up_hash    text,         -- hash of the step-up proof, nullable
  p_expires_at      timestamptz,  -- fresh execution window on APPROVE, null on DENY
  p_evidence        jsonb         -- { id, leaf_hash, bundle, sequence, previous_leaf_hash }
) returns jsonb
language plpgsql
as $$
declare
  v_approval   cp_approvals%rowtype;
  v_phase      text;
  v_seq        bigint;
  v_prev_hash  text;
begin
  if p_decision not in ('APPROVE', 'DENY') then
    raise exception 'cp_decide_approval: decision must be APPROVE or DENY, got %', p_decision;
  end if;
  if (p_decision = 'APPROVE' and p_to_phase <> 'APPROVED')
     or (p_decision = 'DENY' and p_to_phase <> 'DENIED') then
    raise exception 'cp_decide_approval: % cannot move a payment to %', p_decision, p_to_phase;
  end if;
  if p_actor is null or length(p_actor) = 0 then
    raise exception 'cp_decide_approval: an approval decision must name its actor';
  end if;

  perform pg_advisory_xact_lock(hashtext('cp_evidence:' || p_organization_id));

  select * into v_approval
    from cp_approvals
   where id = p_approval_id and organization_id = p_organization_id
   for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  if v_approval.approved_at is not null or v_approval.denied_at is not null then
    if (p_decision = 'APPROVE' and v_approval.approved_by = p_actor)
       or (p_decision = 'DENY' and v_approval.denied_by = p_actor) then
      return jsonb_build_object(
        'status', 'replayed',
        'authorization_id', v_approval.authorization_id,
        'decided_at', coalesce(v_approval.approved_at, v_approval.denied_at)
      );
    end if;
    return jsonb_build_object('status', 'already_decided');
  end if;

  select phase into v_phase
    from cp_authorizations
   where id = v_approval.authorization_id and organization_id = p_organization_id
   for update;
  if v_phase is distinct from p_from_phase then
    return jsonb_build_object('status', 'phase_changed', 'phase', v_phase);
  end if;

  select coalesce(max(sequence), 0) + 1 into v_seq
    from cp_evidence_records where organization_id = p_organization_id;
  select leaf_hash into v_prev_hash
    from cp_evidence_records
   where organization_id = p_organization_id and sequence = v_seq - 1;

  if (p_evidence ->> 'sequence')::bigint is distinct from v_seq
     or (p_evidence ->> 'previous_leaf_hash') is distinct from v_prev_hash then
    raise exception 'cp_evidence_slot_stale' using errcode = 'P0001',
      detail = format('expected sequence %s', v_seq);
  end if;

  if p_decision = 'APPROVE' then
    update cp_approvals
       set approved_by = p_actor, approved_at = now(), evidence_hash = p_step_up_hash
     where id = p_approval_id;
    update cp_authorizations
       set phase = p_to_phase,
           expires_at = coalesce(p_expires_at, expires_at),
           updated_at = now()
     where id = v_approval.authorization_id;
  else
    update cp_approvals
       set denied_by = p_actor, denied_at = now(), evidence_hash = p_step_up_hash
     where id = p_approval_id;
    update cp_authorizations
       set phase = p_to_phase, updated_at = now()
     where id = v_approval.authorization_id;
  end if;

  insert into cp_evidence_records (
    id, organization_id, authorization_id, sequence, leaf_hash,
    previous_leaf_hash, bundle
  )
  values (
    p_evidence ->> 'id', p_organization_id, v_approval.authorization_id, v_seq,
    p_evidence ->> 'leaf_hash', v_prev_hash,
    coalesce(cp_jsonb_present(p_evidence -> 'bundle'), '{}'::jsonb)
  );

  return jsonb_build_object(
    'status', 'decided',
    'authorization_id', v_approval.authorization_id,
    'phase', p_to_phase,
    'evidence_id', p_evidence ->> 'id',
    'sequence', v_seq
  );
end;
$$;

-- Service role only. PostgREST exposes public-schema functions to anon and
-- authenticated by default, and this one moves a payment to APPROVED. The
-- functions are SECURITY INVOKER over RLS-enabled tables with no policies, so a
-- non-service caller's writes already fail; the revoke means they are never
-- reachable at all. 0020's two functions never had this, so it is applied to
-- them here too.
--
-- The role checks keep the file applicable to a plain Postgres (the PGlite
-- test harness) where the Supabase roles do not exist; on Supabase they all do.
do $$
declare
  fn text;
  r  text;
begin
  foreach fn in array array[
    'cp_decide_approval(text, text, text, text, text, text, text, timestamptz, jsonb)',
    'cp_record_decision(jsonb, jsonb, jsonb)',
    'cp_next_evidence_slot(text)'
  ] loop
    execute format('revoke all on function %s from public', fn);
    foreach r in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then
        execute format('revoke all on function %s from %I', fn, r);
      end if;
    end loop;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', fn);
    end if;
  end loop;
end;
$$;
