-- ---------------------------------------------------------------------------
-- Revenue events — the append-only record of what FurlPay actually earned.
--
-- WHY A SEPARATE TABLE AND NOT THE LEDGER. 0009 gives us a double-entry ledger
-- for money MOVEMENT: debits and credits that must balance. Revenue is a
-- different question asked of overlapping facts — "of the value that moved,
-- how much did we keep, under which engine, and is it collectible yet?" A
-- posting has no concept of a take rate, a pending-vs-simulated distinction, or
-- an engine; bolting those onto ledger_entries would overload a structure whose
-- correctness rests on staying narrow. These rows are reporting facts derived
-- from real business events, and they never move money.
--
-- THE CENTRAL DISTINCTION. fee_minor is revenue. volume_minor is the gross
-- amount that moved and is NOT revenue. They are separate columns so no query
-- can accidentally report a $10,000 transfer as $10,000 of income. There is
-- deliberately no column called "amount".
--
-- IDEMPOTENCY. `id` is the deterministic key derived from the underlying
-- business event (see lib/revenue/types.ts idempotencyKey) and is the PRIMARY
-- KEY. A redelivered Stripe webhook or a retried settlement therefore collides
-- in the DATABASE rather than relying on a read-then-write in application code,
-- which has a gap two concurrent lambdas can both pass through. Callers treat
-- the unique violation as success.
--
-- APPEND-ONLY. No UPDATE, no DELETE from application code. A refund appends a
-- `reversed` row carrying a negative fee rather than editing history — books
-- that can be edited cannot be audited. The trigger below enforces that rather
-- than trusting every future caller to remember it.
--
-- MONEY IS EXACT. Amounts are NUMERIC(78,0) holding MINOR units (cents,
-- micro-USDC, wei). Never float. 78 digits covers 18-decimal assets at any
-- realistic magnitude. Minor units are only comparable within one asset, which
-- is why `asset` is on every row and every total is computed per asset.
--
-- This migration is additive: one new table, its indexes, and a trigger. It
-- touches no existing table and rewrites no historical record.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS revenue_events (
  -- Deterministic idempotency key, e.g. "subscription_charge:cs_test_abc123".
  id                text        PRIMARY KEY,
  created_at        timestamptz NOT NULL DEFAULT now(),

  user_id           text        NULL,
  organization_id   text        NULL,

  source            text        NOT NULL,
  engine            text        NOT NULL,
  status            text        NOT NULL,

  -- Asset id from lib/money (e.g. "USD", "USDC.base"), and the settlement
  -- chain for on-chain assets. Null chain means fiat.
  asset             text        NOT NULL,
  chain             text        NULL,

  -- What FurlPay keeps. Negative ONLY on a reversal.
  fee_minor         numeric(78,0) NOT NULL,
  -- Gross amount that moved. NULL when the concept does not apply (a flat
  -- subscription charge has no underlying volume, and storing 0 there would
  -- put a zero into the take-rate denominator).
  volume_minor      numeric(78,0) NULL,
  fee_bps           integer     NULL,

  external_ref      text        NULL,
  metadata          jsonb       NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT revenue_engine_known CHECK (
    engine IN ('transaction','subscription','api','protocol','card','stablecoin','custody','aum')
  ),
  CONSTRAINT revenue_status_known CHECK (
    status IN ('pending','realized','reversed','voided','simulated')
  ),
  -- A non-reversal can never carry a negative fee. This is the database
  -- refusing to hold a row that would quietly reduce reported revenue.
  CONSTRAINT revenue_sign_matches_status CHECK (
    status = 'reversed' OR fee_minor >= 0
  ),
  -- A fee larger than the volume it was taken from is a unit mix-up (major
  -- units where minor were meant) every time.
  CONSTRAINT revenue_fee_within_volume CHECK (
    volume_minor IS NULL OR volume_minor < 0 OR fee_minor <= volume_minor
  )
);

-- Reporting reads are almost always "a date range, newest first", then grouped.
CREATE INDEX IF NOT EXISTS revenue_events_created_idx
  ON revenue_events (created_at DESC);

-- Per-engine and per-source rollups over a window.
CREATE INDEX IF NOT EXISTS revenue_events_engine_created_idx
  ON revenue_events (engine, created_at DESC);
CREATE INDEX IF NOT EXISTS revenue_events_source_created_idx
  ON revenue_events (source, created_at DESC);

-- Realized-only scans (the revenue number) and paying-user counts.
CREATE INDEX IF NOT EXISTS revenue_events_status_created_idx
  ON revenue_events (status, created_at DESC);

-- Per-account revenue, ARPU denominators. Partial: rows without a user_id are
-- never selected by this access path, so they are kept out of the index.
CREATE INDEX IF NOT EXISTS revenue_events_user_idx
  ON revenue_events (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

-- Finding the row for a provider reference during reconciliation.
CREATE INDEX IF NOT EXISTS revenue_events_external_ref_idx
  ON revenue_events (external_ref)
  WHERE external_ref IS NOT NULL;

-- ── Append-only enforcement ────────────────────────────────────────────────
-- Same posture as the ledger: history is not editable. A correction is a new
-- row, so the original and the correction are both visible forever.
CREATE OR REPLACE FUNCTION revenue_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'revenue_events is append-only (attempted % on %)', TG_OP, OLD.id;
END;
$$;

DROP TRIGGER IF EXISTS revenue_events_no_update ON revenue_events;
CREATE TRIGGER revenue_events_no_update
  BEFORE UPDATE OR DELETE ON revenue_events
  FOR EACH ROW EXECUTE FUNCTION revenue_events_append_only();

-- ── Access ─────────────────────────────────────────────────────────────────
-- Deny-by-default, matching 0001_init.sql and 0016_rls_money_tables.sql: RLS
-- on, zero policies. PostgREST with the service key bypasses RLS; the anon key
-- gets nothing. These rows are company accounting data and are read only
-- through /api/ops/revenue, which is ADMIN_ONLY.
ALTER TABLE revenue_events ENABLE ROW LEVEL SECURITY;
