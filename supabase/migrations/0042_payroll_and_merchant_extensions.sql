-- Payroll rosters and batches, merchant pricing tiers, operator review notes and
-- reconciliation alerts. Apply after 0041. Service-role access only.
--
-- Payroll is NON-CUSTODIAL: a submitted batch becomes one payment intent per line
-- (lib/services/payments.createPayment), each signed by the employer's own wallet
-- and settled by FurlPayRouter. FurlPay holds no employer funds, so nothing here
-- posts to the ledger; settlement of each intent does that when it actually moves.
-- Batch and seat fees are QUOTES recorded with the batch; billing is not connected.
-- Amounts are USDC micro-units (6 dp) as bigint.
begin;

create table payroll_contractors (
  id uuid primary key, merchant_id uuid not null,
  name text not null check (char_length(name) between 1 and 120),
  email text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 200),
  role text not null default '' check (char_length(role) <= 80),
  country text not null check (country ~ '^[A-Z]{2}$'),
  payout_chain text not null check (payout_chain in ('arbitrum','base','polygon')),
  payout_address text not null check (payout_address ~ '^0x[0-9a-fA-F]{40}$' and payout_address !~* '^0x0{40}$'),
  default_amount_units bigint not null check (default_amount_units > 0 and default_amount_units <= 1000000000000),
  tax_status text not null default 'unsubmitted' check (tax_status in ('unsubmitted','w8ben_signed','w9_signed','exempt')),
  active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index payroll_contractors_merchant on payroll_contractors(merchant_id, created_at desc);

create table payroll_batches (
  id uuid primary key, merchant_id uuid not null,
  cycle text not null check (cycle ~ '^[0-9]{4}-[0-9]{2}$'),
  chain text not null check (chain in ('arbitrum','base','polygon')),
  status text not null check (status in ('draft','blocked','submitting','submitted','cancelled')),
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
  payment_id text, created_at timestamptz not null default now()
);
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
    values(p_id,p_merchant,p_cycle,p_chain,case when blocked then 'blocked' else 'draft' end,n,gross,fee,0,gross+fee) returning * into b;
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

-- Operator notes on intents held in `review`. Notes never change money or status.
create table merchant_review_notes (
  id bigserial primary key, intent_id uuid not null references merchant_payment_intents(id),
  author text not null, decision text not null check (decision in ('note','confirmed_hold','escalated','cleared_for_release')),
  note text not null check (char_length(note) between 5 and 2000), created_at timestamptz not null default now()
);

-- Three-way reconciliation findings (chain receipt vs intent vs ledger).
create table merchant_reconciliation_alerts (
  id bigserial primary key, intent_id uuid not null references merchant_payment_intents(id),
  kind text not null check (kind in ('missing_receipt','amount_mismatch','receipt_failed','missing_ledger','unbalanced_ledger','rpc_unavailable')),
  detail text not null, severity text not null check (severity in ('high','medium')),
  resolved_at timestamptz, created_at timestamptz not null default now()
);
create unique index merchant_reconciliation_open on merchant_reconciliation_alerts(intent_id, kind) where resolved_at is null;

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
commit;
