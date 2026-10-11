-- Payroll rosters and batches, merchant pricing tiers, operator review notes and
-- reconciliation alerts. Apply after 0041. Service-role access only.
--
-- Payroll is NON-CUSTODIAL: a submitted batch becomes one payment intent per line
-- (lib/services/payments.createPayment), each signed by the employer's own wallet
-- and settled by FurlPayRouter. FurlPay holds no employer funds, so nothing here
-- posts to the ledger; settlement of each intent does that when it actually moves.
-- Batch and seat fees are QUOTES recorded with the batch; billing is not connected.
-- A batch settles on ONE chain through that chain's FurlPayRouter: the EIP-712
-- domain (chainId + verifyingContract) is per chain, and the contractor
-- receives on the batch's chain. Router chains: arbitrum, arc, base, polygon.
-- The per-line platform fee is added ON TOP (router debits line + fee, the
-- contractor receives exactly the line amount).
-- Amounts are USDC micro-units (6 dp) as bigint.
begin;

create table payroll_contractors (
  id uuid primary key, merchant_id uuid not null,
  name text not null check (char_length(name) between 1 and 120),
  email text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 200),
  role text not null default '' check (char_length(role) <= 80),
  country text not null check (country ~ '^[A-Z]{2}$'),
  payout_chain text not null check (payout_chain in ('arbitrum','arc','base','polygon')),
  payout_address text not null check (payout_address ~ '^0x[0-9a-fA-F]{40}$' and payout_address !~* '^0x0{40}$'),
  default_amount_units bigint not null check (default_amount_units > 0 and default_amount_units <= 1000000000000),
  tax_status text not null default 'unsubmitted' check (tax_status in ('unsubmitted','w8ben_signed','w9_signed','exempt')),
  -- Signed form ON FILE (the employer holds the payee-signed W-9/W-8BEN); this
  -- is not an e-signature system. TIN and address are sealed (AES-256-GCM,
  -- FURLPAY_TAX_ENCRYPTION_KEY, AAD tax:<contractor id>); only the last 4 of the TIN are readable.
  tax_form text check (tax_form in ('w9','w8ben')),
  tax_sealed text check (tax_sealed ~ '^v1:'),
  tin_last4 text check (tin_last4 ~ '^[0-9A-Za-z]{4}$'),
  tax_signed_on date, tax_expires_on date, tax_recorded_by text, tax_recorded_at timestamptz,
  check ((tax_form is null) = (tax_sealed is null) and (tax_form is null) = (tax_signed_on is null)),
  check (tax_status not in ('w9_signed','w8ben_signed') or tax_form is not null),
  active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index payroll_contractors_merchant on payroll_contractors(merchant_id, created_at desc);

create table payroll_batches (
  id uuid primary key, merchant_id uuid not null,
  cycle text not null check (cycle ~ '^[0-9]{4}-[0-9]{2}$'),
  chain text not null check (chain in ('arbitrum','arc','base','polygon')),
  status text not null check (status in ('draft','blocked','submitting','submitted','completed','cancelled')),
  -- The employer wallet that signed the first authorization; every line must match it.
  payer_address text check (payer_address ~ '^0x[0-9a-fA-F]{40}$'),
  headcount integer not null check (headcount between 1 and 100),
  gross_units bigint not null check (gross_units > 0),
  batch_fee_units bigint not null check (batch_fee_units >= 0),
  seat_fee_units bigint not null check (seat_fee_units >= 0),
  total_quote_units bigint not null,
  created_at timestamptz not null default now(), submitted_at timestamptz,
  check (total_quote_units = gross_units + batch_fee_units + seat_fee_units)
);
create index payroll_batches_merchant on payroll_batches(merchant_id, created_at desc);

create table payroll_batch_lines (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references payroll_batches(id),
  contractor_id uuid references payroll_contractors(id) on delete set null,
  name text not null, recipient text not null check (recipient ~ '^0x[0-9a-fA-F]{40}$'),
  amount_units bigint not null check (amount_units > 0 and amount_units <= 1000000000000),
  screening text not null check (screening in ('clear','blocked','unavailable')),
  payment_id text, created_at timestamptz not null default now(),
  -- Durable signing: the exact EIP-712 payload issued at submission, so the
  -- employer can resume after a refresh. A payload past its deadline is dead
  -- on-chain (FurlPayRouter rejects it) and must be re-issued with a new nonce.
  sign_data jsonb, sign_deadline timestamptz, issue_count integer not null default 0 check (issue_count between 0 and 50),
  signature text check (signature ~ '^0x[0-9a-fA-F]{130}$'), signer text check (signer ~ '^0x[0-9a-fA-F]{40}$'), signed_at timestamptz,
  check ((sign_data is null) = (sign_deadline is null)),
  check ((signature is null) = (signer is null) and (signature is null) = (signed_at is null)),
  check (signature is null or sign_data is not null),
  -- Execution evidence, written only after the server re-read the receipt from
  -- the chain and matched this line's PaymentExecuted event (never from a
  -- client-supplied hash alone).
  executed_tx text check (executed_tx ~ '^0x[0-9a-fA-F]{64}$'), executed_block bigint, executed_at timestamptz,
  check ((executed_tx is null) = (executed_at is null) and (executed_tx is null) = (executed_block is null)),
  check (executed_tx is null or signature is not null)
);
create unique index payroll_batch_lines_payment on payroll_batch_lines(payment_id) where payment_id is not null;
create index payroll_batch_lines_batch on payroll_batch_lines(batch_id);

-- One seat charge per merchant per calendar month, whichever batch comes first.
create table payroll_seat_charges (
  merchant_id uuid not null, cycle text not null, seats integer not null check (seats >= 0),
  units bigint not null check (units >= 0), batch_id uuid not null references payroll_batches(id),
  created_at timestamptz not null default now(), primary key (merchant_id, cycle)
);

-- Atomic, idempotent batch creation. Fees are computed here from the caller's
-- pricing constants (bounded) so a concurrent request cannot double-charge seats.
create function payroll_batch_create(p_id uuid, p_merchant uuid, p_cycle text, p_chain text, p_lines jsonb,
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
    -- A concurrent retry of the same request committed first: return its batch.
    select * into b from payroll_batches where id=p_id;
    if b.merchant_id<>p_merchant then raise exception 'request_conflict'; end if;
    return b;
  end if;
  insert into payroll_batch_lines(batch_id,contractor_id,name,recipient,amount_units,screening)
    select p_id, nullif(l->>'contractor_id','')::uuid, l->>'name', l->>'recipient', (l->>'amount_units')::bigint, l->>'screening'
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

-- Merchant processing tier. Set by FurlPay operations only; links read it at creation.
create table merchant_pricing (
  merchant_id uuid primary key,
  tier text not null check (tier in ('starter','growth','scale','enterprise')),
  processing_bps integer not null check (processing_bps between 0 and 1000),
  set_by text not null, set_at timestamptz not null default now(), note text not null default ''
);

-- Operator notes on intents held in `review` (or any intent). Notes never change
-- money or status: `refund_requested` records the request for the custody
-- provider; refunds themselves are not implemented.
create table merchant_review_notes (
  id bigserial primary key, intent_id uuid not null references merchant_payment_intents(id),
  author text not null, decision text not null check (decision in ('note','confirmed_hold','escalated','refund_requested')),
  note text not null check (char_length(note) between 5 and 2000), created_at timestamptz not null default now()
);

-- Three-way reconciliation findings (chain receipt vs intent vs ledger).
create table merchant_reconciliation_alerts (
  id bigserial primary key, intent_id uuid not null references merchant_payment_intents(id),
  kind text not null check (kind in ('missing_receipt','amount_mismatch','receipt_failed','missing_ledger','unbalanced_ledger','rpc_unavailable')),
  detail text not null, severity text not null check (severity in ('high','medium')),
  resolved_at timestamptz, resolved_by text, resolution text check (char_length(resolution) <= 500),
  created_at timestamptz not null default now(),
  check ((resolved_at is null) = (resolved_by is null) and (resolved_at is null) = (resolution is null))
);
create unique index merchant_reconciliation_open on merchant_reconciliation_alerts(intent_id, kind) where resolved_at is null;

-- Database legs of the reconciliation (intent vs receipts vs ledger). Read-only
-- over money tables: it only records alerts, it never edits an intent or posts.
-- The chain leg (is each receipt still in a successful, canonical transaction?)
-- runs in the cron (lib/payments/merchant/reconcile.ts) and records through
-- merchant_reconciliation_alert().
create function merchant_reconciliation_alert(p_intent uuid, p_kind text, p_detail text, p_severity text)
returns boolean language plpgsql security definer set search_path=public as $$
declare got integer;
begin
  insert into merchant_reconciliation_alerts(intent_id,kind,detail,severity) values(p_intent,p_kind,left(p_detail,500),p_severity)
    on conflict (intent_id,kind) where resolved_at is null do nothing;
  get diagnostics got = row_count;
  return got = 1;
end $$;

create function merchant_reconcile(p_since timestamptz)
returns integer language plpgsql security definer set search_path=public as $$
declare r record; n integer := 0;
begin
  for r in
    select i.id, i.status, i.received_units::numeric received, coalesce(sum(x.amount_units::numeric),0) receipts, count(x.tx_hash) k
    from merchant_payment_intents i left join merchant_payment_receipts x on x.intent_id=i.id
    where i.created_at >= p_since and i.status in ('underpaid','paid','overpaid')
    group by i.id
  loop
    if r.k = 0 then
      if merchant_reconciliation_alert(r.id,'missing_receipt','Intent is '||r.status||' but has no recorded chain receipt','high') then n:=n+1; end if;
    elsif r.receipts <> r.received then
      if merchant_reconciliation_alert(r.id,'amount_mismatch','Receipts total '||r.receipts||' units; intent records '||r.received,'high') then n:=n+1; end if;
    end if;
  end loop;
  for r in
    select x.intent_id, 'mp:'||x.chain||':'||x.tx_hash||':'||x.log_index txn, t.id found,
      coalesce(sum(p.amount) filter (where p.side='debit'),0) d, coalesce(sum(p.amount) filter (where p.side='credit'),0) c,
      coalesce(sum(p.amount) filter (where p.side='debit' and p.account_id='mp:treasury:'||x.chain),0) treasury, x.amount_units::numeric amount
    from merchant_payment_receipts x
    left join ledger_transactions t on t.id='mp:'||x.chain||':'||x.tx_hash||':'||x.log_index
    left join ledger_postings p on p.transaction_id=t.id
    where x.created_at >= p_since
    group by x.intent_id, x.chain, x.tx_hash, x.log_index, x.amount_units, t.id
  loop
    if r.found is null then
      if merchant_reconciliation_alert(r.intent_id,'missing_ledger','No journal '||r.txn,'high') then n:=n+1; end if;
    elsif r.d <> r.c then
      if merchant_reconciliation_alert(r.intent_id,'unbalanced_ledger','Journal '||r.txn||' debits '||r.d||' credits '||r.c,'high') then n:=n+1; end if;
    elsif r.treasury <> r.amount then
      if merchant_reconciliation_alert(r.intent_id,'amount_mismatch','Journal '||r.txn||' moved '||r.treasury||' into treasury; receipt is '||r.amount,'high') then n:=n+1; end if;
    end if;
  end loop;
  return n;
end $$;

alter table payroll_contractors enable row level security;
alter table payroll_batches enable row level security;
alter table payroll_batch_lines enable row level security;
alter table payroll_seat_charges enable row level security;
alter table merchant_pricing enable row level security;
alter table merchant_review_notes enable row level security;
alter table merchant_reconciliation_alerts enable row level security;
revoke all on payroll_contractors,payroll_batches,payroll_batch_lines,payroll_seat_charges,merchant_pricing,merchant_review_notes,merchant_reconciliation_alerts from anon,authenticated;
grant all on payroll_contractors,payroll_batches,payroll_batch_lines,payroll_seat_charges,merchant_pricing,merchant_review_notes,merchant_reconciliation_alerts to service_role;
grant usage,select on sequence merchant_review_notes_id_seq, merchant_reconciliation_alerts_id_seq to service_role;
revoke all on function payroll_batch_create(uuid,uuid,text,text,jsonb,integer,integer,bigint,bigint) from public,anon,authenticated;
grant execute on function payroll_batch_create(uuid,uuid,text,text,jsonb,integer,integer,bigint,bigint) to service_role;
revoke all on function merchant_reconciliation_alert(uuid,text,text,text), merchant_reconcile(timestamptz) from public,anon,authenticated;
grant execute on function merchant_reconciliation_alert(uuid,text,text,text), merchant_reconcile(timestamptz) to service_role;
commit;
