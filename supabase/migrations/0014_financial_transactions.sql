-- ---------------------------------------------------------------------------
-- Financial transactions: the durable envelope for every money movement.
--
-- WHY. 0009 gave payments and the ledger a home. It did not give the OTHER
-- money movements one — on-ramp orders, off-ramp orders, fiat deposits and
-- withdrawals, crypto deposits and withdrawals all still lived in `globalThis`
-- Maps, which on serverless is a per-instance store. Three consequences, each
-- of which a payments system must not have:
--
--   1. An order created on one lambda is invisible to the next, so a status
--      poll can legitimately answer "not found" for a transaction that exists.
--   2. Idempotency is per-instance, so two concurrent submissions of one
--      withdrawal both see "no existing order" and both proceed.
--   3. The state machine has nowhere to record HOW a transaction reached its
--      current state, which is exactly what a dispute or an audit asks for.
--
-- WHAT THIS IS NOT. It does not make any rail real. There is no contracted
-- on-ramp, off-ramp or banking partner, and the feature flags that would gate
-- them carry `unimplemented` reasons that no environment variable can clear.
-- This is the schema those flows will write to when they exist, and the
-- reconciliation surface for them.
--
-- MONEY REPRESENTATION. Every amount is BIGINT MINOR UNITS with its asset id
-- alongside, matching lib/money/money.ts. No NUMERIC, no float, ever: a
-- rounding difference here is a reconciliation break, not a display bug. The
-- asset id carries the settlement domain ("USDC.arbitrum"), because USDC on
-- Arbitrum cannot settle a Base obligation and a bare symbol would let it try.
--
-- Rolling back is safe: the TypeScript side degrades exactly as 0004 and 0009
-- do when the relations are absent — except in production, where lib/ledger.ts
-- refuses to post at all rather than fall back to memory.
-- ---------------------------------------------------------------------------

-- ── financial_transactions ─────────────────────────────────────────────────

create table if not exists financial_transactions (
  -- Immutable, ours, and minted before anything external is called. A provider
  -- never mints our id: if it did, a request that timed out before the response
  -- would leave us with a movement we cannot name or search for.
  id                    text primary key,

  flow_kind             text not null check (flow_kind in (
                          'onramp','offramp','crypto_deposit','crypto_withdrawal',
                          'fiat_deposit','fiat_withdrawal','internal_transfer',
                          'card_authorization','refund','chargeback'
                        )),

  -- Mirrors lib/money/lifecycle.ts. Constrained here too: an unmodelled state
  -- reaching this table means a code path nobody wrote a transition for.
  state                 text not null check (state in (
                          'CREATED','QUOTED','COMPLIANCE_REVIEW','MANUAL_REVIEW',
                          'PAYMENT_PENDING','PAYMENT_CONFIRMED','SETTLEMENT_PENDING',
                          'SETTLED','CRYPTO_PENDING','CRYPTO_CONFIRMED',
                          'PROVIDER_PENDING','BANK_PENDING','COMPLETED','FAILED',
                          'CANCELLED','REVERSED','REFUNDED','ABANDONED'
                        )),

  user_id               uuid not null,

  -- Source and destination legs. Both sides are recorded even when one is
  -- fiat and the other is on-chain, so a single row answers "what did the
  -- customer give up and what did they get".
  source_asset          text   not null,
  source_amount_minor   bigint not null check (source_amount_minor > 0),
  dest_asset            text   not null,
  -- Nullable: at CREATED the destination amount is not yet quoted, and writing
  -- a zero would be indistinguishable from a quote of nothing.
  dest_amount_minor     bigint check (dest_amount_minor is null or dest_amount_minor > 0),

  -- Fees, broken out so revenue never has to be inferred by subtraction.
  fee_platform_minor    bigint not null default 0 check (fee_platform_minor >= 0),
  fee_provider_minor    bigint not null default 0 check (fee_provider_minor >= 0),
  fee_network_minor     bigint not null default 0 check (fee_network_minor >= 0),
  -- Withheld amounts are owed to a tax authority, not to the customer.
  tds_minor             bigint not null default 0 check (tds_minor >= 0),
  gst_minor             bigint not null default 0 check (gst_minor >= 0),

  -- Routing. `provider_id` is nullable because a transaction exists before a
  -- provider is selected, and some flows (internal transfer) never have one.
  provider_id           text,
  payment_method        text,
  country_code          text,

  -- Evidence. lib/money/lifecycle.ts REQUIRED_EVIDENCE refuses a transition
  -- into a state whose evidence is absent; these are where it is kept.
  provider_ref          text,
  bank_ref              text,
  chain_tx_hash         text,
  ledger_tx_id          text,
  external_ref          text,

  -- Risk / compliance decision AT THE TIME. Stored on the row rather than
  -- looked up later, because a screening result is a point-in-time judgement
  -- and re-running it a month on answers a different question.
  compliance_decision   text check (compliance_decision in ('allow','review','block')),
  compliance_reason     text,
  risk_score            int check (risk_score is null or (risk_score between 0 and 100)),

  -- Reconciliation, driven by the jobs in lib/reconciliation.ts.
  reconciliation_status text not null default 'unreconciled'
                          check (reconciliation_status in
                            ('unreconciled','matched','mismatched','not_applicable')),
  reconciled_at         timestamptz,

  idempotency_key       text,
  -- Who caused this. A movement with no actor cannot be investigated.
  actor_id              uuid,
  actor_kind            text not null default 'user'
                          check (actor_kind in ('user','agent','operator','system','provider')),

  -- When the customer's promise expires (a quote) or the flow is abandoned.
  expires_at            timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  settled_at            timestamptz,
  completed_at          timestamptz
);

-- The idempotency guarantee, enforced by the DATABASE rather than by a Map only
-- one lambda can see. Scoped per user: two tenants supplying the same key must
-- never resolve to each other's transaction.
create unique index if not exists ftx_idempotency_uniq
  on financial_transactions (user_id, idempotency_key)
  where idempotency_key is not null;

-- One provider reference belongs to at most one of our transactions. Without
-- this, a redelivered webhook that fails to match on id can attach a provider's
-- movement to a second row, and the same money is counted twice.
create unique index if not exists ftx_provider_ref_uniq
  on financial_transactions (provider_id, provider_ref)
  where provider_ref is not null;

-- A settled on-chain movement has exactly one transaction hash. The backstop
-- against a double-credit surviving every application-level check.
create unique index if not exists ftx_chain_tx_uniq
  on financial_transactions (chain_tx_hash)
  where chain_tx_hash is not null;

create index if not exists ftx_user_created_idx on financial_transactions (user_id, created_at desc);
create index if not exists ftx_state_idx        on financial_transactions (state)
  where state not in ('COMPLETED','FAILED','CANCELLED','REVERSED','REFUNDED','ABANDONED');
create index if not exists ftx_recon_idx        on financial_transactions (reconciliation_status)
  where reconciliation_status <> 'matched';
-- Stale-transaction sweep: anything unresolved past its deadline.
create index if not exists ftx_expiry_idx       on financial_transactions (expires_at)
  where expires_at is not null;

-- ── financial_transaction_events ───────────────────────────────────────────
-- Append-only history. The row above is the CURRENT state; this is how it got
-- there, which is what a dispute, an auditor and an incident review all ask
-- for. Never edited: a correction is a new event.

create table if not exists financial_transaction_events (
  id             bigserial primary key,
  transaction_id text not null references financial_transactions(id) on delete cascade,
  from_state     text,
  to_state       text not null,
  actor_id       uuid,
  actor_kind     text not null default 'system',
  reason         text,
  -- Evidence presented FOR THIS TRANSITION, so "what did we know when we
  -- marked this settled" is answerable without reconstructing it.
  evidence       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

create index if not exists ftx_events_tx_idx on financial_transaction_events (transaction_id, created_at);

create or replace function ftx_events_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'financial_transaction_events is append-only (attempted % on event %)', tg_op, old.id;
end;
$$;

drop trigger if exists ftx_events_no_update on financial_transaction_events;
create trigger ftx_events_no_update
  before update or delete on financial_transaction_events
  for each row execute function ftx_events_immutable();

-- ── atomic state transition ────────────────────────────────────────────────
-- Claim and advance in ONE transaction.
--
-- The conditional UPDATE is what makes concurrent advancement impossible: the
-- row lock serialises the callers and the loser's WHERE no longer matches, so
-- it advances nothing. This is the durable equivalent of an in-process check
-- that today only holds within one instance.
--
-- The transition TABLE is not duplicated here. Postgres validating a state
-- machine that TypeScript also validates means two definitions that drift;
-- lib/money/lifecycle.ts is the single source, and this function enforces the
-- part a database can enforce better than an application: that exactly one
-- caller moves the row, from the state it expected.

create or replace function ftx_transition(
  p_transaction_id text,
  p_expected_state text,
  p_next_state     text,
  p_actor_id       uuid    default null,
  p_actor_kind     text    default 'system',
  p_reason         text    default null,
  p_evidence       jsonb   default '{}'::jsonb,
  p_patch          jsonb   default '{}'::jsonb
) returns table (advanced boolean, current_state text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state text;
begin
  select state into v_state from financial_transactions where id = p_transaction_id for update;

  if v_state is null then
    raise exception 'ftx_transition: unknown transaction %', p_transaction_id;
  end if;

  -- Idempotent replay: already where the caller wanted it. Reported as a
  -- no-op rather than an error, so a retried webhook is not an incident.
  if v_state = p_next_state then
    return query select false, v_state;
    return;
  end if;

  -- Lost the race, or computed from a stale read. Either way this caller must
  -- not apply its transition on top of somebody else's.
  if v_state <> p_expected_state then
    return query select false, v_state;
    return;
  end if;

  update financial_transactions
     set state                 = p_next_state,
         provider_ref          = coalesce(p_patch->>'provider_ref', provider_ref),
         bank_ref              = coalesce(p_patch->>'bank_ref', bank_ref),
         chain_tx_hash         = coalesce(p_patch->>'chain_tx_hash', chain_tx_hash),
         ledger_tx_id          = coalesce(p_patch->>'ledger_tx_id', ledger_tx_id),
         external_ref          = coalesce(p_patch->>'external_ref', external_ref),
         provider_id           = coalesce(p_patch->>'provider_id', provider_id),
         compliance_decision   = coalesce(p_patch->>'compliance_decision', compliance_decision),
         compliance_reason     = coalesce(p_patch->>'compliance_reason', compliance_reason),
         dest_amount_minor     = coalesce((p_patch->>'dest_amount_minor')::bigint, dest_amount_minor),
         settled_at            = case when p_next_state = 'SETTLED'    then now() else settled_at end,
         completed_at          = case when p_next_state = 'COMPLETED'  then now() else completed_at end,
         updated_at            = now()
   where id = p_transaction_id;

  insert into financial_transaction_events
    (transaction_id, from_state, to_state, actor_id, actor_kind, reason, evidence)
  values
    (p_transaction_id, v_state, p_next_state, p_actor_id, p_actor_kind, p_reason, coalesce(p_evidence, '{}'::jsonb));

  return query select true, p_next_state;
end;
$$;

-- ── reconciliation surfaces ────────────────────────────────────────────────
-- Meant to be alerted on, not queried by hand. /api/cron/reconcile reads them.

-- Money the customer's side considers done that our books never recorded. The
-- most serious signal available: value moved and was not written down.
create or replace view ftx_settled_without_ledger as
  select id, user_id, flow_kind, state, source_asset, source_amount_minor,
         provider_ref, chain_tx_hash, settled_at
  from financial_transactions
  where state in ('SETTLED','COMPLETED')
    and ledger_tx_id is null;

-- Terminal success with no evidence behind it. Should be empty by construction
-- (lifecycle.ts refuses the transition); non-empty means something wrote the
-- state directly, which is exactly the bypass worth paging on.
create or replace view ftx_completed_without_evidence as
  select id, user_id, flow_kind, provider_id, completed_at
  from financial_transactions
  where state = 'COMPLETED'
    and provider_ref is null
    and chain_tx_hash is null
    and bank_ref is null;

-- In flight past its deadline. Each one is a customer waiting on an answer
-- nobody is currently producing.
create or replace view ftx_stale_in_flight as
  select id, user_id, flow_kind, state, provider_id, expires_at,
         now() - expires_at as overdue_by
  from financial_transactions
  where expires_at is not null
    and expires_at < now()
    and state not in ('COMPLETED','FAILED','CANCELLED','REVERSED','REFUNDED','ABANDONED');

-- Anything held for a human. A growing queue here is an operational failure
-- even when every individual row is correct.
create or replace view ftx_awaiting_review as
  select id, user_id, flow_kind, state, compliance_decision, compliance_reason, updated_at
  from financial_transactions
  where state in ('COMPLIANCE_REVIEW','MANUAL_REVIEW');
