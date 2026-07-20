-- ---------------------------------------------------------------------------
-- 0008 — Reorganization settlement records.
--
-- 0007 added the HANDLERS for mergers, spin-offs and delistings, but a
-- cash-bearing reorg (cash-out merger, liquidating delisting, cash-in-lieu
-- fraction) still has nowhere to record that its money was paid. Dividends got
-- that record in 0006 (`dividend_events`); this is the exact analogue for
-- reorgs, and it exists for the same reason: the lot transformation and the
-- cash credit must happen exactly once, and a retried settlement job must be
-- able to prove what it already paid rather than paying again.
--
-- Why a SEPARATE table from dividend_events rather than one "cash_events":
-- a reorg settlement also REPLACES lots (supersedes the old, opens the new),
-- so it carries a realized gain and a link to the resulting position that a
-- dividend never has. Forcing both into one shape would blur two different
-- lifecycles.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS reorg_events (
  id                   TEXT PRIMARY KEY,
  user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  corporate_action_id  TEXT NOT NULL REFERENCES corporate_actions(id),
  symbol               TEXT NOT NULL,
  type                 TEXT NOT NULL CHECK (type IN ('merger', 'acquisition', 'spin_off', 'delisting')),
  -- Cash paid to the holder by this settlement (0 for a cash-in-lieu-only
  -- spin-off is still recorded, so the run is provably idempotent).
  cash_proceeds        NUMERIC(20, 2) NOT NULL DEFAULT 0,
  -- Gain or loss realized by the cash leg. A stock-for-stock merger that only
  -- paid a fractional cash-in-lieu still realizes on that sliver.
  realized_gain        NUMERIC(20, 2) NOT NULL DEFAULT 0,
  status               TEXT NOT NULL DEFAULT 'settled'
                         CHECK (status IN ('settled', 'reversed')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- The idempotency guarantee, identical in spirit to dividend_once_per_user:
  -- one settlement per user per action. Two concurrent runs both reading an
  -- empty settled-set will both attempt the insert; the database rejects the
  -- loser instead of paying twice.
  CONSTRAINT reorg_once_per_user UNIQUE (user_id, corporate_action_id)
);

CREATE INDEX IF NOT EXISTS reorg_events_user_idx
  ON reorg_events (user_id, created_at DESC);

ALTER TABLE reorg_events ENABLE ROW LEVEL SECURITY;
