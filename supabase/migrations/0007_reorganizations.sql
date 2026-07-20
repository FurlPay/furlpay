-- ---------------------------------------------------------------------------
-- 0007 — Reorganizations: mergers, spin-offs, delistings.
--
-- 0006 gave lots three statuses: open, closed, split_adjusted. That set cannot
-- express the two states a reorganization produces:
--
--   superseded  the lot was replaced by a merger or spin-off. 'split_adjusted'
--               is the same idea under a name that only tells the truth for
--               splits; a merger marked 'split_adjusted' is a lie in the audit
--               trail, and the audit trail is the entire reason lots are
--               append-only. 'split_adjusted' is KEPT in the CHECK so existing
--               rows stay valid and the split path is unchanged — both mean
--               "replaced by a corporate action" (see SUPERSEDED_STATUSES in
--               corporateActions/types.ts, the one place that knows both).
--
--   frozen      the issuer was delisted. The holder still owns the shares —
--               basis and holding period survive, and a liquidating
--               distribution may still arrive — but the position cannot be
--               traded and must not be priced off a stale quote. Closing the
--               lot instead would silently realize a gain that never happened.
-- ---------------------------------------------------------------------------

ALTER TABLE trade_lots DROP CONSTRAINT IF EXISTS trade_lots_status_check;

ALTER TABLE trade_lots ADD CONSTRAINT trade_lots_status_check
  CHECK (status IN ('open', 'closed', 'split_adjusted', 'superseded', 'frozen'));

-- open_lot_has_shares (0006) still applies and is deliberately NOT relaxed: a
-- frozen lot keeps its real share count, so it never needs a zero-quantity
-- 'open' row.

-- Spin-offs need the parent→child link to be reconstructable: which parent lot
-- funded this child lot, and what fraction of the parent's basis came with it.
-- source_lot_id already carries the first half; the allocation fraction is
-- recorded so a basis split can be re-derived and audited years later, when the
-- FMVs used at the time are long gone from any live feed.
ALTER TABLE trade_lots
  ADD COLUMN IF NOT EXISTS basis_allocation_pct NUMERIC(10, 8);

COMMENT ON COLUMN trade_lots.basis_allocation_pct IS
  'Spin-off only: fraction of the parent lot''s cost basis allocated to this lot, by FMV ratio on the distribution date. NULL for every other provenance.';

-- Delisted issuers, so a frozen position can explain itself in the UI and a
-- pricing job knows to stop quoting the symbol rather than serving a stale last
-- trade as if it were live.
CREATE TABLE IF NOT EXISTS delistings (
  symbol               TEXT PRIMARY KEY,
  effective_date       DATE NOT NULL,
  corporate_action_id  TEXT REFERENCES corporate_actions(id),
  -- Set when the delisting pays holders out (liquidation, cash merger).
  -- NULL means the position froze with no distribution.
  liquidation_per_share NUMERIC(20, 6),
  reason               TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE delistings ENABLE ROW LEVEL SECURITY;
