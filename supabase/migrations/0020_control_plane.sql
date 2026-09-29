-- ---------------------------------------------------------------------------
-- The programmable-money control plane: durable authority, decisions, evidence.
--
-- WHY. `@furlpay/control-plane` models the whole authorization lifecycle —
-- delegation chain, mandates, revocation, policy, approval, routing, evidence —
-- as PURE functions, and its 307 tests prove the decisions are right. It has no
-- persistence, so today none of it survives a request. That is not a slow store,
-- it is NO store: a mandate cannot be revoked tomorrow if it was never written,
-- and "why was this payment allowed" cannot be answered after the process exits.
--
-- WHAT THIS IS NOT. It does not make money real. Settlement still needs
-- ONCHAIN_SETTLEMENT_LIVE, a KMS fee payer, and a rail with actual access. It
-- removes the reason those cannot safely be turned on.
--
-- MONEY REPRESENTATION, AND WHY NOT BIGINT. Every amount here is
-- NUMERIC(78,0) — integer by construction, scale zero, no floating point
-- anywhere. BIGINT would have been the obvious choice and it is wrong: its
-- ceiling is ~9.2e18, and ten units of an 18-decimal token is 1e19 atomic units.
-- A column that silently cannot represent a legal amount is a column that will
-- one day reject or truncate a real payment. 78 digits covers a full uint256.
--
-- TENANCY IS A COLUMN, NOT A CONVENTION. `organization_id` is NOT NULL on every
-- table that holds tenant data, and every lookup index leads with it. The
-- audit's largest unverified category was cross-tenant access; making the tenant
-- part of the primary access path is what lets the API layer be checked for it.
--
-- EVIDENCE IS APPEND-ONLY BY TRIGGER, matching ledger_postings (0009). A hash
-- chain that can be UPDATEd proves nothing: the whole point is that a later
-- edit is detectable, and the cheapest edit is the one the database allows.
--
-- RLS ON, ZERO POLICIES, following 0001 and 0016. The app reaches Postgres only
-- with SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS; the published anon key
-- gets nothing. A policy would be a statement that some non-service role may
-- read these rows, and none should.
--
-- ROLLBACK IS SAFE. Every table is new and nothing outside this file references
-- them, so dropping them restores the previous state exactly. The TypeScript
-- adapters degrade to null when the relations are absent, the same shape
-- paymentsDb.ts uses for 0009.
-- ---------------------------------------------------------------------------

-- ── Tenancy and identity ───────────────────────────────────────────────────

create table if not exists cp_organizations (
  id            text primary key,
  name          text not null,
  -- THE TENANCY ANCHOR. An authenticated API key carries a `userId`; this is
  -- what maps it to exactly one organization. Unique, so a credential can never
  -- resolve to two tenants and a route can never have to choose between them —
  -- which is the shape most cross-tenant reads take.
  owner_user_id text not null,
  -- "sandbox" may resolve an unverified principal; "live" may not. Enforced in
  -- the application (resolveAuthority's requireVerifiedPrincipal), recorded
  -- here so an operator can see which posture a tenant is under.
  environment   text not null default 'sandbox'
                  check (environment in ('sandbox', 'live')),
  status        text not null default 'ACTIVE'
                  check (status in ('ACTIVE', 'SUSPENDED', 'REVOKED')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists cp_org_owner_uniq on cp_organizations (owner_user_id);

create table if not exists cp_principals (
  id              text primary key,
  organization_id text not null references cp_organizations(id) on delete restrict,
  -- Matches identity.ts's Principal.kind exactly. A value outside this set
  -- means a code path we did not model reached the table.
  kind            text not null check (kind in ('individual', 'entity')),
  status          text not null default 'ACTIVE'
                    check (status in ('ACTIVE', 'SUSPENDED', 'REVOKED', 'EXPIRED')),
  verification    text not null default 'unverified'
                    check (verification in ('unverified', 'pending', 'verified', 'rejected')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  revoked_at      timestamptz
);
create index if not exists cp_principals_org_idx on cp_principals (organization_id, id);

create table if not exists cp_operators (
  id              text primary key,
  organization_id text not null references cp_organizations(id) on delete restrict,
  name            text not null,
  -- A domain the operator PROVED control of. Never taken from a request.
  domain          text,
  status          text not null default 'ACTIVE'
                    check (status in ('ACTIVE', 'SUSPENDED', 'REVOKED', 'EXPIRED')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists cp_operators_org_idx on cp_operators (organization_id, id);

-- ── Delegation ─────────────────────────────────────────────────────────────
--
-- The layer corporate governance actually lives in: deprovisioning a human must
-- kill every agent beneath them. `scope` is the AuthorityScope JSON the chain
-- intersects; it is stored as jsonb rather than exploded into columns because
-- intersection semantics live in identity.ts, and splitting it would invite a
-- second, divergent implementation in SQL.

create table if not exists cp_delegations (
  id              text primary key,
  organization_id text not null references cp_organizations(id) on delete restrict,
  principal_id    text not null references cp_principals(id) on delete restrict,
  operator_id     text not null references cp_operators(id) on delete restrict,
  -- The human or system account this was granted on behalf of. The IdP subject.
  on_behalf_of    text not null,
  status          text not null default 'ACTIVE'
                    check (status in ('ACTIVE', 'SUSPENDED', 'REVOKED', 'EXPIRED')),
  scope           jsonb not null default '{}'::jsonb,
  issued_at       timestamptz not null default now(),
  expires_at      timestamptz,
  revoked_at      timestamptz,
  revoked_reason  text
);
create index if not exists cp_delegations_org_idx       on cp_delegations (organization_id, id);
create index if not exists cp_delegations_principal_idx on cp_delegations (principal_id, status);

create table if not exists cp_agents (
  id              text primary key,
  organization_id text not null references cp_organizations(id) on delete restrict,
  principal_id    text not null references cp_principals(id) on delete restrict,
  operator_id     text not null references cp_operators(id) on delete restrict,
  name            text not null,
  -- W3C DID or a cloudflare.pay handle, when the agent has one.
  did             text,
  -- SPKI fingerprint of the agent's signing key. THE KEY ID, NEVER THE KEY.
  key_id          text,
  status          text not null default 'ACTIVE'
                    check (status in ('ACTIVE', 'SUSPENDED', 'REVOKED', 'EXPIRED')),
  scope           jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  expires_at      timestamptz,
  revoked_at      timestamptz
);
create index if not exists cp_agents_org_idx    on cp_agents (organization_id, id);
create index if not exists cp_agents_keyid_idx  on cp_agents (key_id) where key_id is not null;

create table if not exists cp_agent_sessions (
  id              text primary key,
  organization_id text not null references cp_organizations(id) on delete restrict,
  agent_id        text not null references cp_agents(id) on delete restrict,
  status          text not null default 'ACTIVE'
                    check (status in ('ACTIVE', 'SUSPENDED', 'REVOKED', 'EXPIRED')),
  -- RuntimeAttestation.kind. Drives policy, not just telemetry: a scope may
  -- require 'tee' and refuse a 'key_only' session.
  attestation_kind text not null default 'key_only'
                    check (attestation_kind in ('tee', 'passkey', 'key_only', 'none')),
  -- Enclave measurement or credential id. Evidence, not a secret.
  attestation_ref text,
  scope           jsonb,
  started_at      timestamptz not null default now(),
  expires_at      timestamptz,
  revoked_at      timestamptz
);
create index if not exists cp_sessions_agent_idx on cp_agent_sessions (agent_id, status);

-- ── Mandates ───────────────────────────────────────────────────────────────
--
-- What the principal SIGNED. `payload_hash` commits to mandateSigningPayload()'s
-- exact bytes so evidence can prove which authority was relied on, and
-- `credential_token` keeps the wire form verbatim — re-serializing before
-- verification is how a signature stops checking out.

create table if not exists cp_mandates (
  id                text primary key,
  organization_id   text not null references cp_organizations(id) on delete restrict,
  principal_id      text not null references cp_principals(id) on delete restrict,
  -- Agent id or DID. Compared against the resolved chain at decision time.
  delegated_to      text not null,
  authority_scope   jsonb not null,
  -- SHA-256 of the canonical signing payload. 64 lowercase hex.
  payload_hash      text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  credential_format text check (credential_format in
                      ('internal-ed25519', 'ap2-sd-jwt', 'ap2-ed25519', 'vc-jwt')),
  credential_token  text,
  credential_key_id text,
  -- Single-use replay guard. Unique per organization so two tenants cannot
  -- collide, and so a replayed nonce is a constraint violation rather than a
  -- check somebody remembered to write.
  nonce             text not null,
  single_use        boolean not null default false,
  policy_version    text not null,
  status            text not null default 'ACTIVE'
                      check (status in ('ACTIVE', 'REVOKED', 'EXPIRED', 'CONSUMED')),
  issued_at         timestamptz not null default now(),
  not_before        timestamptz,
  expires_at        timestamptz not null,
  revoked_at        timestamptz,
  revoked_reason    text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint cp_mandates_expiry_after_issue check (expires_at > issued_at)
);
create unique index if not exists cp_mandates_nonce_uniq on cp_mandates (organization_id, nonce);
create index if not exists cp_mandates_org_idx      on cp_mandates (organization_id, id);
create index if not exists cp_mandates_agent_idx    on cp_mandates (delegated_to, status);
-- Revocation lookup reads live mandates by tenant; a partial index keeps it
-- small as revoked and expired rows accumulate.
create index if not exists cp_mandates_live_idx     on cp_mandates (organization_id, delegated_to)
  where status = 'ACTIVE';

-- Revocations are their own table rather than only a column, because "no record"
-- and "revoked" must be distinguishable after a cache eviction, and because the
-- cascade needs to be queryable by SUBJECT rather than by table.
create table if not exists cp_revocations (
  id              bigserial primary key,
  organization_id text not null references cp_organizations(id) on delete restrict,
  -- RevocationSubjectKind from revocation.ts. Kind + id together, never id
  -- alone: two kinds legitimately share an id namespace, and matching on the
  -- bare id would revoke an agent because a mandate with the same suffix was.
  subject_kind    text not null check (subject_kind in
                    ('organization', 'principal', 'delegation', 'operator',
                     'agent', 'session', 'mandate', 'credential', 'recipient')),
  subject_id      text not null,
  reason          text not null,
  revoked_by      text not null,
  revoked_at      timestamptz not null default now()
);
create unique index if not exists cp_revocations_subject_uniq
  on cp_revocations (organization_id, subject_kind, subject_id);
-- The read the revocation engine performs on every authorization.
create index if not exists cp_revocations_org_idx on cp_revocations (organization_id, revoked_at desc);

-- ── Decisions ──────────────────────────────────────────────────────────────
--
-- One row per authorization DECISION, separate from execution. The audit's
-- architecture insists these are different concerns: an agent proposes, the
-- control plane decides, and only an already-decided payment may execute.

create table if not exists cp_authorizations (
  id                    text primary key,
  organization_id       text not null references cp_organizations(id) on delete restrict,
  mandate_id            text not null references cp_mandates(id) on delete restrict,
  principal_id          text not null,
  delegation_id         text not null,
  operator_id           text not null,
  agent_id              text not null,
  session_id            text,

  -- PaymentPhase from lifecycle.ts. The FSM is the authority on legal
  -- transitions; this constraint only refuses a value it never produces.
  phase                 text not null check (phase in
                          ('AUTHORIZED', 'PENDING_APPROVAL', 'APPROVED', 'DENIED',
                           'EXPIRED', 'HOLD', 'EXECUTING', 'SETTLED', 'FAILED', 'REVERSED')),
  verdict               text not null check (verdict in ('ALLOW', 'HOLD', 'DENY')),
  approval_required     boolean not null default false,

  -- Money: integer atomic units, asset named explicitly. See the header for why
  -- this is NUMERIC(78,0) and not BIGINT.
  amount_atomic         numeric(78,0) not null check (amount_atomic > 0),
  asset                 text not null,
  currency              text not null,
  network_id            text not null,
  rail_id               text not null,

  recipient_id          text not null,
  -- Canonical destination the rail must be given, as recipient.ts resolved it.
  recipient_destination text,
  merchant_domain       text,
  -- x402/MPP only: the resource this payment is bound to (SR1).
  resource              text,

  policy_version        text not null,
  -- Every policy consulted, with its version. A later edit must not be able to
  -- make a past decision look like it followed rules that did not exist yet.
  evaluated_policies    jsonb not null default '[]'::jsonb,
  primary_reason        text,
  -- The full PolicyCheck[] — which checks ran and what each answered.
  checks                jsonb not null default '[]'::jsonb,
  drift_score           integer not null default 0,
  drift_signals         jsonb not null default '[]'::jsonb,

  -- Hash of the exact payload execution is permitted to submit. Binding
  -- execution to this is what stops the approved thing and the executed thing
  -- diverging.
  payload_hash          text check (payload_hash ~ '^[0-9a-f]{64}$'),
  idempotency_key       text,

  decided_at            timestamptz not null default now(),
  expires_at            timestamptz not null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists cp_auth_org_idx     on cp_authorizations (organization_id, id);
create index if not exists cp_auth_mandate_idx on cp_authorizations (mandate_id, decided_at desc);
-- The drift/velocity read: settled history for one agent inside a time window.
create index if not exists cp_auth_history_idx on cp_authorizations
  (organization_id, agent_id, decided_at desc);
-- Idempotency is scoped to the tenant: two organizations sending the same key
-- are unrelated requests and must never resolve to each other's payment.
create unique index if not exists cp_auth_idem_uniq on cp_authorizations
  (organization_id, idempotency_key) where idempotency_key is not null;

create table if not exists cp_approvals (
  id                text primary key,
  organization_id   text not null references cp_organizations(id) on delete restrict,
  authorization_id  text not null references cp_authorizations(id) on delete restrict,
  approver_role     text not null,
  -- Set only when a human actually acted. NULL while pending, which is what the
  -- lifecycle's record-level guard reads to refuse execution.
  approved_by       text,
  approved_at       timestamptz,
  denied_by         text,
  denied_at         timestamptz,
  -- Fail-closed by constraint as well as by type: there is no ALLOW to store.
  on_timeout        text not null default 'HOLD' check (on_timeout in ('HOLD', 'DENY')),
  timeout_seconds   integer not null check (timeout_seconds > 0),
  requested_at      timestamptz not null default now(),
  -- Hash of the step-up evidence, never the evidence itself.
  evidence_hash     text,
  constraint cp_approvals_not_both check (not (approved_at is not null and denied_at is not null))
);
create index if not exists cp_approvals_auth_idx on cp_approvals (authorization_id);
create index if not exists cp_approvals_pending_idx on cp_approvals (organization_id, requested_at)
  where approved_at is null and denied_at is null;

-- ── Execution ──────────────────────────────────────────────────────────────
--
-- One row per ATTEMPT, not per payment. A retry, a replacement transaction and
-- an indeterminate submission are all distinct facts, and collapsing them into
-- one mutable row is how "we tried twice" becomes unanswerable.

create table if not exists cp_execution_attempts (
  id                bigserial primary key,
  organization_id   text not null references cp_organizations(id) on delete restrict,
  authorization_id  text not null references cp_authorizations(id) on delete restrict,
  attempt           integer not null check (attempt > 0),
  rail_id           text not null,
  rail_quote_id     text,
  rail_ref          text,

  -- SettlementState from rails.ts. INDETERMINATE is a first-class value because
  -- "failed" and "succeeded, response lost" are different facts and treating
  -- them alike is how a recipient gets paid twice.
  state             text not null check (state in
                      ('SUBMITTED', 'PENDING', 'ESCROWED', 'SETTLED', 'FAILED', 'INDETERMINATE')),
  settlement_ref    text,
  fee_atomic        numeric(78,0) check (fee_atomic >= 0),
  confirmations     integer,
  required_confirmations integer,
  failure_reason    text,
  rail_status       text,

  -- The signing plane's answer. Reference only: no key, no signature.
  execution_token_id text,
  signing_backend    text,
  signing_key_id     text,
  hardware_backed    boolean,

  -- Set once the balanced ledger transaction exists.
  ledger_tx_id      text,

  started_at        timestamptz not null default now(),
  finished_at       timestamptz,
  constraint cp_exec_attempt_uniq unique (authorization_id, attempt)
);
create index if not exists cp_exec_org_idx  on cp_execution_attempts (organization_id, authorization_id);
-- Reconciliation reads: anything in flight, oldest first.
create index if not exists cp_exec_open_idx on cp_execution_attempts (state, started_at)
  where state in ('SUBMITTED', 'PENDING', 'ESCROWED', 'INDETERMINATE');

-- ── Evidence ───────────────────────────────────────────────────────────────
--
-- The answer to "why was this payment allowed", in a form a later edit cannot
-- quietly change. `sequence` is per-organization and contiguous;
-- `previous_leaf_hash` chains each record to the one before it. Both are needed:
-- contiguous sequence numbers with mismatched back-links means a record was
-- REPLACED, and correct back-links with a gap means the chain was re-linked
-- around a DELETION.

create table if not exists cp_evidence_records (
  id                 text primary key,
  organization_id    text not null references cp_organizations(id) on delete restrict,
  authorization_id   text not null references cp_authorizations(id) on delete restrict,
  sequence           bigint not null check (sequence > 0),
  leaf_hash          text not null check (leaf_hash ~ '^[0-9a-f]{64}$'),
  -- NULL only for the first record of an organization.
  previous_leaf_hash text check (previous_leaf_hash ~ '^[0-9a-f]{64}$'),
  -- The canonical bundle the leaf hash commits to. Recomputing the hash over
  -- this is the whole tamper check, so it is stored verbatim.
  bundle             jsonb not null,
  -- Set once a batch root has been published somewhere we cannot reach.
  merkle_root        text check (merkle_root ~ '^[0-9a-f]{64}$'),
  anchored_at        timestamptz,
  anchor_ref         text,
  created_at         timestamptz not null default now(),
  constraint cp_evidence_seq_uniq unique (organization_id, sequence)
);
create index if not exists cp_evidence_auth_idx on cp_evidence_records (authorization_id);
create index if not exists cp_evidence_chain_idx on cp_evidence_records (organization_id, sequence);

-- Evidence is append-only, enforced the same way ledger_postings is (0009). A
-- hash chain that the database permits UPDATEing proves nothing at all: the
-- cheapest tampering is the kind the schema allows.
create or replace function cp_evidence_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'cp_evidence_records is append-only (attempted % on evidence %)', tg_op, old.id;
end;
$$;

drop trigger if exists cp_evidence_no_update on cp_evidence_records;
create trigger cp_evidence_no_update
  before update or delete on cp_evidence_records
  for each row execute function cp_evidence_immutable();

-- ── Atomic decision write ──────────────────────────────────────────────────
--
-- An authorization, its approval requirement and its evidence record are ONE
-- fact. Written as three PostgREST calls they can half-land, and the states that
-- leaves are exactly the dangerous ones: an authorization with no evidence
-- (unexplainable), or evidence with no authorization (unattributable), or a
-- HOLD with no approval row (a payment waiting on nobody).
--
-- The evidence sequence is allocated INSIDE this transaction, under a
-- per-organization advisory lock, so two concurrent decisions cannot claim the
-- same position in the chain.

-- ── JSON null is not SQL NULL ──────────────────────────────────────────────
--
-- Found by executing this migration rather than reading it. A caller sending
-- `{"p_approval": null}` may deliver SQL NULL *or* the jsonb scalar `'null'`,
-- depending on how the transport converts it — and `jsonb 'null' IS NOT NULL`
-- evaluates to TRUE. A guard written as `if p_approval is not null` therefore
-- runs its body for what the caller meant as "absent", and the approval insert
-- fails on a null `id`.
--
-- That is the most common path, not an edge: every ALLOW decision passes no
-- approval. The same trap applies to `coalesce(x -> 'k', '[]'::jsonb)` — a jsonb
-- 'null' is not NULL, so coalesce does not substitute the default and the value
-- is stored into a NOT NULL jsonb column, which accepts it.
--
-- This collapses both representations onto SQL NULL so the guards mean what they
-- read as, whichever one the transport sends.
create or replace function cp_jsonb_present(v jsonb) returns jsonb
language sql immutable parallel safe as $$
  select case when v is null or jsonb_typeof(v) = 'null' then null else v end;
$$;

create or replace function cp_record_decision(
  p_authorization jsonb,
  p_approval      jsonb,     -- null when no approval is required
  p_evidence      jsonb      -- { id, leaf_hash, bundle }
) returns jsonb
language plpgsql
as $$
declare
  v_org        text := p_authorization ->> 'organization_id';
  v_auth_id    text := p_authorization ->> 'id';
  v_seq        bigint;
  v_prev_hash  text;
  v_evidence_id text := p_evidence ->> 'id';
begin
  if v_org is null or v_auth_id is null then
    raise exception 'cp_record_decision requires organization_id and id';
  end if;

  -- Serialize sequence allocation per organization. hashtext keeps the lock key
  -- inside int4 while staying stable for a given tenant.
  perform pg_advisory_xact_lock(hashtext('cp_evidence:' || v_org));

  insert into cp_authorizations (
    id, organization_id, mandate_id, principal_id, delegation_id, operator_id,
    agent_id, session_id, phase, verdict, approval_required,
    amount_atomic, asset, currency, network_id, rail_id,
    recipient_id, recipient_destination, merchant_domain, resource,
    policy_version, evaluated_policies, primary_reason, checks,
    drift_score, drift_signals, payload_hash, idempotency_key, expires_at
  )
  select
    v_auth_id, v_org,
    p_authorization ->> 'mandate_id',
    p_authorization ->> 'principal_id',
    p_authorization ->> 'delegation_id',
    p_authorization ->> 'operator_id',
    p_authorization ->> 'agent_id',
    p_authorization ->> 'session_id',
    p_authorization ->> 'phase',
    p_authorization ->> 'verdict',
    coalesce((p_authorization ->> 'approval_required')::boolean, false),
    (p_authorization ->> 'amount_atomic')::numeric,
    p_authorization ->> 'asset',
    p_authorization ->> 'currency',
    p_authorization ->> 'network_id',
    p_authorization ->> 'rail_id',
    p_authorization ->> 'recipient_id',
    p_authorization ->> 'recipient_destination',
    p_authorization ->> 'merchant_domain',
    p_authorization ->> 'resource',
    p_authorization ->> 'policy_version',
    coalesce(cp_jsonb_present(p_authorization -> 'evaluated_policies'), '[]'::jsonb),
    p_authorization ->> 'primary_reason',
    coalesce(cp_jsonb_present(p_authorization -> 'checks'), '[]'::jsonb),
    coalesce((p_authorization ->> 'drift_score')::integer, 0),
    coalesce(cp_jsonb_present(p_authorization -> 'drift_signals'), '[]'::jsonb),
    p_authorization ->> 'payload_hash',
    p_authorization ->> 'idempotency_key',
    (p_authorization ->> 'expires_at')::timestamptz;

  if cp_jsonb_present(p_approval) is not null then
    insert into cp_approvals (
      id, organization_id, authorization_id, approver_role,
      on_timeout, timeout_seconds
    )
    values (
      p_approval ->> 'id', v_org, v_auth_id,
      p_approval ->> 'approver_role',
      coalesce(p_approval ->> 'on_timeout', 'HOLD'),
      coalesce((p_approval ->> 'timeout_seconds')::integer, 900)
    );
  end if;

  select coalesce(max(sequence), 0) + 1 into v_seq
    from cp_evidence_records where organization_id = v_org;

  select leaf_hash into v_prev_hash
    from cp_evidence_records
   where organization_id = v_org and sequence = v_seq - 1;

  insert into cp_evidence_records (
    id, organization_id, authorization_id, sequence, leaf_hash,
    previous_leaf_hash, bundle
  )
  values (
    v_evidence_id, v_org, v_auth_id, v_seq,
    p_evidence ->> 'leaf_hash', v_prev_hash,
    coalesce(cp_jsonb_present(p_evidence -> 'bundle'), '{}'::jsonb)
  );

  return jsonb_build_object(
    'authorization_id', v_auth_id,
    'evidence_id', v_evidence_id,
    'sequence', v_seq,
    'previous_leaf_hash', v_prev_hash
  );
end;
$$;

-- The next evidence position for an organization, so the application can compute
-- a leaf hash that commits to its own sequence and predecessor BEFORE writing.
create or replace function cp_next_evidence_slot(p_organization_id text)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'sequence', coalesce(max(sequence), 0) + 1,
    'previous_leaf_hash', (
      select leaf_hash from cp_evidence_records
       where organization_id = p_organization_id
       order by sequence desc limit 1
    )
  )
  from cp_evidence_records
  where organization_id = p_organization_id;
$$;

-- ── Reconciliation views ───────────────────────────────────────────────────
--
-- Each one is a question an operator or an auditor actually asks, expressed once
-- in SQL rather than reassembled differently by every caller. All three are
-- expected to be EMPTY; a non-empty result is a control failure, not a report.

-- A settled payment whose authority cannot be explained.
create or replace view cp_settled_without_evidence as
  select a.id, a.organization_id, a.agent_id, a.amount_atomic, a.asset, a.decided_at
    from cp_authorizations a
    left join cp_evidence_records e on e.authorization_id = a.id
   where a.phase = 'SETTLED' and e.id is null;

-- A payment that required a human and settled anyway. Unreachable through
-- applyPhaseEvent's record-level guard, so non-empty means a direct write.
create or replace view cp_settled_without_approval as
  select a.id, a.organization_id, a.agent_id, a.amount_atomic, a.asset, a.decided_at
    from cp_authorizations a
    left join cp_approvals ap
      on ap.authorization_id = a.id and ap.approved_at is not null
   where a.phase = 'SETTLED' and a.approval_required and ap.id is null;

-- An execution whose outcome is genuinely unknown. Must reach a status poll,
-- never a retry and never a second rail.
create or replace view cp_indeterminate_executions as
  select e.id, e.organization_id, e.authorization_id, e.rail_id, e.rail_ref,
         e.state, e.started_at
    from cp_execution_attempts e
   where e.state in ('INDETERMINATE', 'SUBMITTED', 'PENDING', 'ESCROWED')
   order by e.started_at;

-- ── Row-level security ─────────────────────────────────────────────────────
-- Deny by default for every role that does not bypass RLS. See the header.

alter table if exists cp_organizations      enable row level security;
alter table if exists cp_principals         enable row level security;
alter table if exists cp_operators          enable row level security;
alter table if exists cp_delegations        enable row level security;
alter table if exists cp_agents             enable row level security;
alter table if exists cp_agent_sessions     enable row level security;
alter table if exists cp_mandates           enable row level security;
alter table if exists cp_revocations        enable row level security;
alter table if exists cp_authorizations     enable row level security;
alter table if exists cp_approvals          enable row level security;
alter table if exists cp_execution_attempts enable row level security;
alter table if exists cp_evidence_records   enable row level security;
