-- Contractor self-service: invitations, account linking and wallet-proven payout
-- addresses. Apply after 0043. Service-role access only (tables inherit 0042's RLS).
--
-- Why: in 0042 the EMPLOYER types every payout address. A typo, or an insider
-- editing the roster, sends real pay to the wrong wallet. After this migration a
-- contractor can accept an invite and set their own address by signing with it;
-- from then on the employer cannot change that address.
begin;

alter table payroll_contractors
  -- sha256 of the single-use invite token (the token itself is never stored).
  add column invite_token_hash text check (invite_token_hash ~ '^[0-9a-f]{64}$'),
  add column invite_expires_at timestamptz,
  -- The FurlPay account that accepted the invite (email matched at acceptance).
  add column linked_user_id uuid,
  add column linked_at timestamptz,
  -- EIP-191 signature by payout_address over the address-registration message.
  add column address_proof text check (address_proof ~ '^0x[0-9a-fA-F]{130}$'),
  add column address_verified_at timestamptz,
  add constraint payroll_contractors_invite_pair check ((invite_token_hash is null) = (invite_expires_at is null)),
  add constraint payroll_contractors_link_pair check ((linked_user_id is null) = (linked_at is null)),
  add constraint payroll_contractors_proof_pair check ((address_proof is null) = (address_verified_at is null));

create unique index payroll_contractors_invite on payroll_contractors(invite_token_hash) where invite_token_hash is not null;
-- One roster entry per email per employer (imports and retries cannot duplicate people).
create unique index payroll_contractors_email on payroll_contractors(merchant_id, lower(email));
create index payroll_contractors_linked on payroll_contractors(linked_user_id) where linked_user_id is not null;

-- Lines record whether the paid address was proven by its owner at batch time.
alter table payroll_batch_lines add column address_verified boolean not null default false;

-- payroll_batch_create (0042) inserts lines from JSON; carry the flag through.
create or replace function payroll_batch_create(p_id uuid, p_merchant uuid, p_cycle text, p_chain text, p_lines jsonb,
  p_seats integer, p_batch_bps integer, p_batch_min_units bigint, p_seat_units bigint)
returns payroll_batches language plpgsql security definer set search_path=public as $$
declare b payroll_batches; gross bigint := 0; n integer; blocked boolean; fee bigint; seat bigint := 0; got integer;
begin
  select * into b from payroll_batches where id=p_id;
  if found then
    if b.merchant_id<>p_merchant then raise exception 'request_conflict'; end if;
    return b;
  end if;
  if p_batch_bps not between 0 and 1000 or p_batch_min_units not between 0 and 100000000 or p_seat_units not between 0 and 1000000000 or p_seats not between 0 and 10000 then raise exception 'invalid_pricing'; end if;
  n := jsonb_array_length(p_lines);
  if n < 1 or n > 100 then raise exception 'invalid_lines'; end if;
  select coalesce(sum((l->>'amount_units')::bigint),0), bool_or(l->>'screening' <> 'clear') into gross, blocked from jsonb_array_elements(p_lines) l;
  fee := greatest(gross * p_batch_bps / 10000, p_batch_min_units);
  insert into payroll_batches(id,merchant_id,cycle,chain,status,headcount,gross_units,batch_fee_units,seat_fee_units,total_quote_units)
    values(p_id,p_merchant,p_cycle,p_chain,case when blocked then 'blocked' else 'draft' end,n,gross,fee,0,gross+fee)
    on conflict (id) do nothing returning * into b;
  if not found then
    select * into b from payroll_batches where id=p_id;
    if b.merchant_id<>p_merchant then raise exception 'request_conflict'; end if;
    return b;
  end if;
  insert into payroll_batch_lines(batch_id,contractor_id,name,recipient,amount_units,screening,address_verified)
    select p_id, nullif(l->>'contractor_id','')::uuid, l->>'name', l->>'recipient', (l->>'amount_units')::bigint, l->>'screening', coalesce((l->>'address_verified')::boolean, false)
    from jsonb_array_elements(p_lines) l;
  insert into payroll_seat_charges(merchant_id,cycle,seats,units,batch_id) values(p_merchant,p_cycle,p_seats,p_seats::bigint*p_seat_units,p_id)
    on conflict (merchant_id,cycle) do nothing;
  get diagnostics got = row_count;
  if got = 1 then
    seat := p_seats::bigint * p_seat_units;
    update payroll_batches set seat_fee_units=seat, total_quote_units=gross+fee+seat where id=p_id returning * into b;
  end if;
  return b;
end $$;
revoke all on function payroll_batch_create(uuid,uuid,text,text,jsonb,integer,integer,bigint,bigint) from public,anon,authenticated;
grant execute on function payroll_batch_create(uuid,uuid,text,text,jsonb,integer,integer,bigint,bigint) to service_role;

commit;
