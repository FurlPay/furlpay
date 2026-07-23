-- ---------------------------------------------------------------------------
-- Durable payments + double-entry ledger
--
-- WHY. lib/services/payments.ts and lib/ledger.ts both keep their state in a
-- `globalThis` Map. Their own comments say so ("In-memory store (production:
-- Postgres)", "production backs this with Postgres/TigerBeetle behind the same
-- functions"). On serverless that is not a slow store, it is a PER-INSTANCE
-- store, and it breaks three things that a payments system cannot get wrong:
--
--   1. Idempotency is per-instance. Two concurrent executePayment() calls for
--      one paymentId landing on different lambdas both read `pending_signature`
--      and both settle. The x402 nonce claim (Redis, already durable) stops a
--      duplicate ON-CHAIN transfer, but the internal record and the ledger
--      posting would double — the books would disagree with the chain.
--   2. Records evaporate on instance recycle, including `pending_review`
--      compliance holds, which is the one status that must outlive a deploy.
--   3. The ledger cannot reconcile: each instance holds its own book, so
--      "debits == credits" is true per-lambda and meaningless overall.
--
-- WHAT THIS IS NOT. This migration adds the tables and the atomic entry points.
-- It does not by itself make money real — that still needs
-- FACILITATOR_EVM_PRIVATE_KEY, an RPC, and INTEGRATION_MODE=live. It removes
-- the reason those cannot safely be turned on.
--
-- MONEY REPRESENTATION. Ledger amounts are BIGINT minor units (USD cents),
-- matching @furlpay/ledger's integer-only model. No NUMERIC, no float, ever:
-- a rounding difference here is a reconciliation break, not a display bug.
-- Payment amounts keep NUMERIC(38,18) because on-chain token amounts are not
-- cents and must survive 18-decimal assets without loss.
--
-- Rolling back is safe: the TypeScript side falls back to its in-memory path
-- when these relations are absent, exactly as 0004 does.
-- ---------------------------------------------------------------------------

-- ── payments ───────────────────────────────────────────────────────────────

create table if not exists payments (
  id                    text primary key,
  created_by_user_id    uuid not null,
  -- Status is the state machine in services/payments.ts. Constrained here too:
  -- an unknown status reaching the table means a code path we did not model.
  status                text not null check (status in (
                          'pending_signature','pending_review','settled',
                          'refunded','expired','blocked'
                        )),
  amount_usdc           numeric(38,18) not null check (amount_usdc > 0),
  source_chain          text not null,
  recipient             text not null,
  payer                 text,
  memo                  text,

  -- Settlement
  transaction_hash      text,
  settlement_chain      text,
  settled_at            timestamptz,

  -- Refund
  refund_transaction_hash text,
  refunded_at           timestamptz,

  -- Compliance (HITL)
  blocked_reason        text,
  review_reason         text,
  review_requested_at   timestamptz,
  reviewed_at           timestamptz,
  reviewed_by           uuid,

  -- Link to the balanced ledger transaction that recorded this settlement.
  ledger_tx_id          text,

  idempotency_key       text,
  expires_at            timestamptz not null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- The idempotency guarantee, enforced by the DATABASE rather than by a Map that
-- only one lambda can see. Scoped per user: two tenants supplying the same key
-- must never resolve to each other's intent.
create unique index if not exists payments_idempotency_uniq
  on payments (created_by_user_id, idempotency_key)
  where idempotency_key is not null;

-- A settled payment has exactly one on-chain transaction. This is the backstop
-- against a double-settle surviving every application-level check.
create unique index if not exists payments_tx_uniq
  on payments (transaction_hash)
  where transaction_hash is not null;

create index if not exists payments_user_created_idx
  on payments (created_by_user_id, created_at desc);
create index if not exists payments_status_idx
  on payments (status) where status in ('pending_signature','pending_review');

-- ── payment_events ─────────────────────────────────────────────────────────
-- Append-only history. The payments row is the CURRENT state; this is how it
-- got there. Required for a compliance audit ("who released this hold, when,
-- and on what evidence") and for reconstructing state after an incident.

create table if not exists payment_events (
  id          bigserial primary key,
  payment_id  text not null references payments(id) on delete cascade,
  -- from_status is null for the creating event.
  from_status text,
  to_status   text not null,
  actor_id    uuid,
  reason      text,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists payment_events_payment_idx
  on payment_events (payment_id, created_at);

-- ── ledger ─────────────────────────────────────────────────────────────────

create table if not exists ledger_accounts (
  id         text primary key,
  code       text not null,
  name       text not null,
  type       text not null check (type in ('asset','liability','equity','revenue','expense')),
  currency   text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists ledger_accounts_code_uniq on ledger_accounts (code);

create table if not exists ledger_transactions (
  id         text primary key,
  ts         timestamptz not null default now(),
  memo       text not null,
  -- Set when this transaction reverses another. History is never edited; a
  -- correction is a new, compensating transaction pointing back at its target.
  reverses   text references ledger_transactions(id),
  created_at timestamptz not null default now()
);

-- A transaction may be reversed at most once. Without this, two concurrent
-- refunds of one payment each post their own reversal and the user is credited
-- twice — the exact double-spend the in-memory ledger cannot prevent.
create unique index if not exists ledger_transactions_reverses_uniq
  on ledger_transactions (reverses) where reverses is not null;

create table if not exists ledger_postings (
  id             bigserial primary key,
  transaction_id text not null references ledger_transactions(id) on delete cascade,
  account_id     text not null references ledger_accounts(id),
  side           text not null check (side in ('debit','credit')),
  -- Integer minor units, strictly positive. Direction lives in `side`, never in
  -- the sign, so a negative amount is always a bug rather than a credit.
  amount         bigint not null check (amount > 0),
  created_at     timestamptz not null default now()
);

create index if not exists ledger_postings_tx_idx      on ledger_postings (transaction_id);
create index if not exists ledger_postings_account_idx on ledger_postings (account_id, created_at);

-- Postings are immutable. Balances are DERIVED by summing them, so an UPDATE or
-- DELETE would rewrite history that an auditor may already have relied on.
create or replace function ledger_postings_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'ledger_postings is append-only (attempted % on posting %)', tg_op, old.id;
end;
$$;

drop trigger if exists ledger_postings_no_update on ledger_postings;
create trigger ledger_postings_no_update
  before update or delete on ledger_postings
  for each row execute function ledger_postings_immutable();

-- Derived balance for one account. Signed by the account's normal side, so an
-- asset with more debits than credits reads positive.
create or replace function ledger_account_balance(p_account_id text)
returns bigint
language sql
stable
as $$
  select coalesce(sum(
    case
      when a.type in ('asset','expense') then
        case when p.side = 'debit' then p.amount else -p.amount end
      else
        case when p.side = 'credit' then p.amount else -p.amount end
    end
  ), 0)::bigint
  from ledger_postings p
  join ledger_accounts a on a.id = p.account_id
  where p.account_id = p_account_id;
$$;

-- ── atomic posting ─────────────────────────────────────────────────────────
-- The ledger's core invariant (debits == credits) has to be checked INSIDE the
-- write. Posting the header and the legs as separate PostgREST calls leaves a
-- window where the transaction exists with only half its postings — and a
-- reader summing balances in that window sees a book that does not balance.

create or replace function ledger_post(
  p_transaction_id text,
  p_memo           text,
  p_postings       jsonb,
  p_reverses       text default null,
  p_ts             timestamptz default now()
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_debits  bigint;
  v_credits bigint;
  v_count   int;
begin
  -- Idempotent: re-posting the same transaction id is a no-op, so a retried
  -- settlement cannot double the books.
  if exists (select 1 from ledger_transactions where id = p_transaction_id) then
    return p_transaction_id;
  end if;

  select
    coalesce(sum(case when x.side = 'debit'  then x.amount else 0 end), 0),
    coalesce(sum(case when x.side = 'credit' then x.amount else 0 end), 0),
    count(*)
  into v_debits, v_credits, v_count
  from jsonb_to_recordset(coalesce(p_postings, '[]'::jsonb))
    as x(account_id text, side text, amount bigint);

  if v_count < 2 then
    raise exception 'ledger_post: a transaction needs at least two postings (got %)', v_count;
  end if;
  if v_debits <> v_credits then
    raise exception 'ledger_post: unbalanced — debits % <> credits %', v_debits, v_credits;
  end if;

  insert into ledger_transactions (id, ts, memo, reverses)
  values (p_transaction_id, p_ts, p_memo, p_reverses);

  insert into ledger_postings (transaction_id, account_id, side, amount)
  select p_transaction_id, x.account_id, x.side, x.amount
  from jsonb_to_recordset(p_postings)
    as x(account_id text, side text, amount bigint);

  return p_transaction_id;
end;
$$;

-- ── atomic settlement ──────────────────────────────────────────────────────
-- Claim a payment for settlement and post its ledger entry in ONE transaction.
--
-- The claim is a conditional UPDATE, which is what makes concurrent settlement
-- impossible: the row lock serialises the two callers, and the loser's WHERE no
-- longer matches, so it settles nothing. This is the durable equivalent of the
-- `status === "settled"` check that today only holds within one instance.

create or replace function settle_payment_atomic(
  p_payment_id     text,
  p_payer          text,
  p_tx_hash        text,
  p_chain          text,
  p_ledger_tx_id   text,
  p_memo           text,
  p_postings       jsonb,
  p_actor_id       uuid default null
) returns table (settled boolean, already boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev text;
begin
  -- Lock the row and read its state. FOR UPDATE is the whole point: without it
  -- two callers both read 'pending_signature' and both proceed.
  select status into v_prev from payments where id = p_payment_id for update;

  if v_prev is null then
    raise exception 'settle_payment_atomic: unknown payment %', p_payment_id;
  end if;

  -- Already settled — report it as an idempotent replay, not a failure.
  if v_prev = 'settled' then
    return query select false, true;
    return;
  end if;

  if v_prev not in ('pending_signature', 'pending_review') then
    raise exception 'settle_payment_atomic: payment % is % and cannot settle', p_payment_id, v_prev;
  end if;

  -- Books first. If this raises (unbalanced postings) the whole function rolls
  -- back and the payment stays claimable, rather than being marked settled
  -- against a ledger entry that never landed.
  perform ledger_post(p_ledger_tx_id, p_memo, p_postings);

  update payments
     set status           = 'settled',
         payer            = coalesce(p_payer, payer),
         transaction_hash = p_tx_hash,
         settlement_chain = p_chain,
         settled_at       = now(),
         ledger_tx_id     = p_ledger_tx_id,
         updated_at       = now()
   where id = p_payment_id;

  insert into payment_events (payment_id, from_status, to_status, actor_id, reason, metadata)
  values (p_payment_id, v_prev, 'settled', p_actor_id, 'settlement_confirmed',
          jsonb_build_object('txHash', p_tx_hash, 'chain', p_chain, 'ledgerTxId', p_ledger_tx_id));

  return query select true, false;
end;
$$;

-- ── reconciliation ─────────────────────────────────────────────────────────
-- The books must balance globally. Anything other than zero here is a defect
-- that has already been written down, so this is meant to be alerted on, not
-- just queried by hand.

create or replace view ledger_imbalance as
  select
    coalesce(sum(case when side = 'debit'  then amount else 0 end), 0)::bigint as total_debits,
    coalesce(sum(case when side = 'credit' then amount else 0 end), 0)::bigint as total_credits,
    coalesce(sum(case when side = 'debit'  then amount else -amount end), 0)::bigint as imbalance
  from ledger_postings;

-- Settled payments whose ledger transaction is missing. Should always be empty:
-- a non-empty result means money moved on-chain without being recorded.
create or replace view payments_missing_ledger as
  select p.id, p.created_by_user_id, p.amount_usdc, p.transaction_hash, p.settled_at
  from payments p
  left join ledger_transactions t on t.id = p.ledger_tx_id
  where p.status = 'settled' and (p.ledger_tx_id is null or t.id is null);
