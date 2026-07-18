-- ---------------------------------------------------------------------------
-- 0006 — Corporate actions & tax lots.
--
-- Portfolio state lives in `holdings`, a MUTABLE AGGREGATE: a buy does
-- `shares += qty; cost_basis += notional`, a sell scales the basis by a
-- fraction. That is average-cost accounting with no history, and it makes
-- corporate actions unimplementable — a 2:1 split has to rewrite both numbers
-- with no record of the before, and a dividend cannot know the record-date
-- position.
--
-- These tables add the missing history. `holdings` stays as the fast read
-- model; `trade_lots` becomes the source of truth it is projected from.
--
-- Consistent with 0001-0005: RLS enabled with ZERO policies. The anon key
-- reads nothing; the service role bypasses RLS.
-- ---------------------------------------------------------------------------

-- Immutable corporate-action events. Announcements get revised, so rows are
-- versioned and corrections SUPERSEDE rather than update: the row a position
-- was computed from must stay readable after a correction lands.
CREATE TABLE IF NOT EXISTS corporate_actions (
  id                TEXT PRIMARY KEY,
  symbol            TEXT NOT NULL,
  type              TEXT NOT NULL CHECK (type IN (
                      'cash_dividend', 'stock_dividend', 'stock_split', 'reverse_split',
                      'symbol_change', 'merger', 'acquisition', 'spin_off',
                      'rights_issue', 'delisting')),
  effective_date    DATE NOT NULL,
  announcement_date DATE,
  record_date       DATE,
  payment_date      DATE,
  -- New-for-old ratio: 2-for-1 split = 2, 1-for-10 reverse = 0.1.
  ratio             NUMERIC(20, 8),
  amount_per_share  NUMERIC(20, 6),
  new_symbol        TEXT,
  version           INTEGER NOT NULL DEFAULT 1,
  source            TEXT NOT NULL DEFAULT 'manual',
  confidence        TEXT NOT NULL DEFAULT 'confirmed'
                      CHECK (confidence IN ('announced', 'confirmed', 'corrected')),
  -- DEFERRABLE: a correction and the row it supersedes can arrive in the same
  -- ingest batch. FK triggers are AFTER-ROW and normally fire at end of
  -- statement, so a single multi-row INSERT usually works — but that is
  -- incidental behaviour, not a guarantee, and it breaks the moment the writer
  -- chunks the batch. Deferring to COMMIT makes order irrelevant by contract.
  supersedes        TEXT REFERENCES corporate_actions(id)
                      DEFERRABLE INITIALLY DEFERRED,
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- A split with no ratio, or a dividend with no amount, would silently
  -- corrupt every position it touched. Reject at the storage layer.
  CONSTRAINT split_needs_ratio CHECK (
    type NOT IN ('stock_split', 'reverse_split') OR (ratio IS NOT NULL AND ratio > 0)),
  CONSTRAINT dividend_needs_amount CHECK (
    type <> 'cash_dividend' OR (amount_per_share IS NOT NULL AND amount_per_share >= 0)),
  CONSTRAINT rename_needs_target CHECK (
    type NOT IN ('symbol_change', 'merger', 'acquisition') OR new_symbol IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS corporate_actions_symbol_date_idx
  ON corporate_actions (symbol, effective_date DESC);

-- Append-only acquisition records — the atom of tax accounting.
--
-- A corporate action NEVER edits a lot: the old row is marked
-- 'split_adjusted' and a new row is inserted with source_lot_id pointing back,
-- so any historical position can be reconstructed and any adjustment audited.
CREATE TABLE IF NOT EXISTS trade_lots (
  id                   TEXT PRIMARY KEY,
  user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol               TEXT NOT NULL,
  -- Shares REMAINING in this lot; a partial sale reduces it.
  quantity             NUMERIC(20, 8) NOT NULL CHECK (quantity >= 0),
  -- Cost of the remaining quantity, not of the original purchase.
  cost_basis           NUMERIC(20, 2) NOT NULL CHECK (cost_basis >= 0),
  -- Drives FIFO ordering AND the short/long-term holding period.
  acquired_at          TIMESTAMPTZ NOT NULL,
  status               TEXT NOT NULL DEFAULT 'open'
                         CHECK (status IN ('open', 'closed', 'split_adjusted')),
  -- WHERE THIS LOT CAME FROM. First-class column, not an id-prefix convention,
  -- because downstream systems must be able to tell a real fill from a
  -- reconstructed one:
  --   execution        a real order fill. acquired_at is observed fact.
  --   backfill         synthesised from the legacy `holdings` aggregate during
  --                    the 0006 rollout. acquired_at is an ESTIMATE and the
  --                    blended basis cannot be decomposed into the real
  --                    purchases, so holding period and FIFO order are
  --                    approximations. Must never be reported as tax fact.
  --   corporate_action created by a split/merger adjustment.
  --   seed             demo/fixture data.
  -- Tax reporting, support and audit all need this distinction; inferring it
  -- from an id prefix is fragile and unqueryable.
  provenance           TEXT NOT NULL DEFAULT 'execution'
                         CHECK (provenance IN ('execution', 'backfill', 'corporate_action', 'seed')),
  -- DEFERRABLE for the split path: applySplit() emits the superseded lot AND
  -- its replacement in one write, and the replacement references the original.
  -- See the note on corporate_actions.supersedes.
  source_lot_id        TEXT REFERENCES trade_lots(id)
                         DEFERRABLE INITIALLY DEFERRED,
  corporate_action_id  TEXT REFERENCES corporate_actions(id),
  order_id             TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- An open lot with no shares is a closed lot that forgot to say so; it would
  -- pollute FIFO ordering forever.
  CONSTRAINT open_lot_has_shares CHECK (status <> 'open' OR quantity > 0)
);

-- Finds every position still resting on reconstructed data — the query that
-- answers "can we trust this user's tax lots yet?".
CREATE INDEX IF NOT EXISTS trade_lots_provenance_idx
  ON trade_lots (provenance)
  WHERE provenance <> 'execution';

-- The hot path: open lots for one user+symbol, oldest first (FIFO).
CREATE INDEX IF NOT EXISTS trade_lots_open_idx
  ON trade_lots (user_id, symbol, acquired_at)
  WHERE status = 'open';

-- Per-user dividend ledger. Separate from `transactions` because a dividend
-- has its own lifecycle (announced → pending → paid) and must remain linked to
-- the action that produced it for tax reporting.
CREATE TABLE IF NOT EXISTS dividend_events (
  id                   TEXT PRIMARY KEY,
  user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  corporate_action_id  TEXT NOT NULL REFERENCES corporate_actions(id),
  symbol               TEXT NOT NULL,
  -- Position on the RECORD DATE, not today. Stored because today's holding
  -- cannot reproduce it after any later trade.
  shares_held          NUMERIC(20, 8) NOT NULL CHECK (shares_held >= 0),
  amount_per_share     NUMERIC(20, 6) NOT NULL,
  gross_amount         NUMERIC(20, 2) NOT NULL,
  withholding_tax      NUMERIC(20, 2) NOT NULL DEFAULT 0,
  net_amount           NUMERIC(20, 2) NOT NULL,
  reinvested           BOOLEAN NOT NULL DEFAULT false,
  drip_lot_id          TEXT REFERENCES trade_lots(id),
  status               TEXT NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('announced', 'pending', 'paid', 'reinvested')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One payout per user per action; a retried job must not double-pay.
  CONSTRAINT dividend_once_per_user UNIQUE (user_id, corporate_action_id)
);

CREATE INDEX IF NOT EXISTS dividend_events_user_idx
  ON dividend_events (user_id, created_at DESC);

-- Ticker history, so a search for "FB" still resolves a position now held
-- under "META" and historical rows stay joinable.
CREATE TABLE IF NOT EXISTS symbol_mappings (
  old_symbol           TEXT NOT NULL,
  new_symbol           TEXT NOT NULL,
  effective_date       DATE NOT NULL,
  corporate_action_id  TEXT REFERENCES corporate_actions(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (old_symbol, effective_date)
);

-- Same posture as every other table in this schema.
ALTER TABLE corporate_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_lots        ENABLE ROW LEVEL SECURITY;
ALTER TABLE dividend_events   ENABLE ROW LEVEL SECURITY;
ALTER TABLE symbol_mappings   ENABLE ROW LEVEL SECURITY;
