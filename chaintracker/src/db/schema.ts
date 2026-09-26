// Schema and migrations.
//
// Migrations are an ordered list of SQL steps recorded in `_migrations`, so a
// restart is always safe and adding a step later never re-runs the earlier
// ones. SQLite is the default because it needs nothing installed; the repo
// layer is narrow enough that swapping in Postgres means rewriting one file.

export interface Migration {
  id: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    id: "0001_core",
    sql: `
    CREATE TABLE IF NOT EXISTS chains (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      slug                TEXT NOT NULL UNIQUE,
      name                TEXT NOT NULL,
      symbol              TEXT,
      chain_type          TEXT NOT NULL,
      layer               TEXT NOT NULL,
      parent_chain        TEXT,
      evm_chain_id        INTEGER,
      alchemy_subdomain   TEXT,
      public_rpc          TEXT NOT NULL DEFAULT '[]',
      websocket_url       TEXT,
      explorer_url        TEXT NOT NULL,
      explorer_name       TEXT NOT NULL,
      etherscan_chain_id  INTEGER,
      coingecko_id        TEXT,
      defillama_slug      TEXT,
      native_token        TEXT NOT NULL,
      native_decimals     INTEGER NOT NULL DEFAULT 18,
      logo                TEXT,
      coin_logo           TEXT,
      categories          TEXT NOT NULL DEFAULT '[]',
      block_time_sec      REAL,
      tier                INTEGER NOT NULL DEFAULT 3,
      scan_native         INTEGER NOT NULL DEFAULT 0,
      whale_thresholds    TEXT NOT NULL DEFAULT '[]',
      color               INTEGER NOT NULL DEFAULT 5793266,
      enabled             INTEGER NOT NULL DEFAULT 1,
      is_testnet          INTEGER NOT NULL DEFAULT 0,
      metadata            TEXT NOT NULL DEFAULT '{}',
      created_at          INTEGER NOT NULL,
      updated_at          INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chains_enabled ON chains(enabled, tier);

    CREATE TABLE IF NOT EXISTS tokens (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      chain_slug    TEXT,
      address       TEXT,
      symbol        TEXT NOT NULL,
      name          TEXT,
      decimals      INTEGER NOT NULL DEFAULT 18,
      coingecko_id  TEXT,
      logo          TEXT,
      is_stablecoin INTEGER NOT NULL DEFAULT 0,
      is_native     INTEGER NOT NULL DEFAULT 0,
      created_at    INTEGER NOT NULL,
      UNIQUE(chain_slug, address)
    );
    CREATE INDEX IF NOT EXISTS idx_tokens_symbol ON tokens(symbol);

    -- Market data keyed by CoinGecko id: it describes a token, never a chain.
    CREATE TABLE IF NOT EXISTS prices (
      coingecko_id  TEXT PRIMARY KEY,
      symbol        TEXT NOT NULL,
      price_usd     REAL,
      market_cap    REAL,
      fdv           REAL,
      volume_24h    REAL,
      change_24h    REAL,
      change_7d     REAL,
      change_30d    REAL,
      circulating   REAL,
      total_supply  REAL,
      max_supply    REAL,
      ath           REAL,
      atl           REAL,
      sparkline_7d  TEXT,
      fetched_at    INTEGER NOT NULL,
      source        TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS price_history (
      coingecko_id  TEXT NOT NULL,
      ts            INTEGER NOT NULL,
      price_usd     REAL NOT NULL,
      PRIMARY KEY (coingecko_id, ts)
    );

    -- DeFi metrics keyed by chain: TVL is a chain property, not a token one.
    CREATE TABLE IF NOT EXISTS chain_metrics (
      chain_slug        TEXT PRIMARY KEY,
      tvl_usd           REAL,
      tvl_change_24h    REAL,
      stablecoin_mcap   REAL,
      dex_volume_24h    REAL,
      fees_24h          REAL,
      revenue_24h       REAL,
      rwa_tvl           REAL,
      protocol_count    INTEGER,
      fetched_at        INTEGER NOT NULL,
      source            TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tvl_history (
      chain_slug  TEXT NOT NULL,
      ts          INTEGER NOT NULL,
      tvl_usd     REAL NOT NULL,
      PRIMARY KEY (chain_slug, ts)
    );

    -- Chain activity read from the node itself.
    CREATE TABLE IF NOT EXISTS chain_head (
      chain_slug        TEXT PRIMARY KEY,
      block_height      INTEGER,
      block_timestamp   INTEGER,
      observed_bt_sec   REAL,
      gas_price_gwei    REAL,
      tx_count_24h      INTEGER,
      healthy           INTEGER NOT NULL DEFAULT 0,
      latency_ms        INTEGER,
      error             TEXT,
      fetched_at        INTEGER NOT NULL,
      source            TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stablecoins (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      chain_slug    TEXT NOT NULL,
      symbol        TEXT NOT NULL,
      name          TEXT,
      circulating   REAL,
      fetched_at    INTEGER NOT NULL,
      UNIQUE(chain_slug, symbol)
    );

    CREATE TABLE IF NOT EXISTS rwa_assets (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      chain_slug    TEXT,
      protocol      TEXT NOT NULL,
      tvl_usd       REAL,
      category      TEXT,
      fetched_at    INTEGER NOT NULL,
      UNIQUE(chain_slug, protocol)
    );

    CREATE TABLE IF NOT EXISTS protocols (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      slug          TEXT NOT NULL UNIQUE,
      name          TEXT NOT NULL,
      category      TEXT,
      tvl_usd       REAL,
      chains        TEXT NOT NULL DEFAULT '[]',
      url           TEXT,
      logo          TEXT,
      fetched_at    INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_protocols_tvl ON protocols(tvl_usd DESC);
    `,
  },
  {
    id: "0002_addresses_and_whales",
    sql: `
    CREATE TABLE IF NOT EXISTS wallets (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      chain_slug     TEXT NOT NULL,
      address        TEXT NOT NULL,
      label          TEXT,
      entity         TEXT,
      category       TEXT NOT NULL DEFAULT 'unknown',
      balance_native REAL,
      balance_usd    REAL,
      tx_count       INTEGER,
      first_seen     INTEGER,
      last_seen      INTEGER,
      whale_score    REAL,
      tags           TEXT NOT NULL DEFAULT '[]',
      confidence     REAL NOT NULL DEFAULT 0.5,
      source         TEXT,
      UNIQUE(chain_slug, address)
    );
    CREATE INDEX IF NOT EXISTS idx_wallets_cat ON wallets(chain_slug, category);
    CREATE INDEX IF NOT EXISTS idx_wallets_score ON wallets(chain_slug, whale_score DESC);
    CREATE INDEX IF NOT EXISTS idx_wallets_bal ON wallets(chain_slug, balance_usd DESC);

    CREATE TABLE IF NOT EXISTS whale_transactions (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      chain_slug     TEXT NOT NULL,
      tx_hash        TEXT NOT NULL,
      log_index      INTEGER,
      block_number   INTEGER,
      ts             INTEGER NOT NULL,
      token_symbol   TEXT NOT NULL,
      token_address  TEXT,
      amount         REAL NOT NULL,
      amount_usd     REAL NOT NULL,
      price_usd      REAL,
      from_address   TEXT NOT NULL,
      to_address     TEXT NOT NULL,
      from_label     TEXT,
      to_label       TEXT,
      from_category  TEXT NOT NULL DEFAULT 'unknown',
      to_category    TEXT NOT NULL DEFAULT 'unknown',
      event_type     TEXT NOT NULL,
      tier           TEXT NOT NULL,
      confidence     REAL NOT NULL DEFAULT 1.0,
      source         TEXT NOT NULL,
      explorer_url   TEXT,
      alerted        INTEGER NOT NULL DEFAULT 0,
      -- The idempotency key. A replayed block can never double-insert.
      UNIQUE(chain_slug, tx_hash, log_index)
    );
    CREATE INDEX IF NOT EXISTS idx_whale_chain_ts ON whale_transactions(chain_slug, ts DESC);
    CREATE INDEX IF NOT EXISTS idx_whale_usd ON whale_transactions(amount_usd DESC);
    CREATE INDEX IF NOT EXISTS idx_whale_pending ON whale_transactions(alerted, ts DESC);

    -- Cursor per chain so a restart resumes instead of rescanning from zero.
    CREATE TABLE IF NOT EXISTS scan_cursors (
      chain_slug    TEXT NOT NULL,
      scanner       TEXT NOT NULL,
      last_block    INTEGER,
      last_value    TEXT,
      updated_at    INTEGER NOT NULL,
      PRIMARY KEY (chain_slug, scanner)
    );
    `,
  },
  {
    id: "0003_discord_and_ops",
    sql: `
    CREATE TABLE IF NOT EXISTS guilds (
      guild_id      TEXT PRIMARY KEY,
      name          TEXT,
      joined_at     INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id        TEXT PRIMARY KEY,
      category_prefix TEXT NOT NULL DEFAULT 'CHAINTRACKER',
      channels        TEXT NOT NULL DEFAULT '{}',
      whale_min_usd   REAL NOT NULL DEFAULT 1000000,
      enabled_chains  TEXT,
      setup_at        INTEGER
    );

    CREATE TABLE IF NOT EXISTS users (
      user_id     TEXT PRIMARY KEY,
      first_seen  INTEGER NOT NULL,
      commands    INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id      TEXT NOT NULL,
      channel_id    TEXT,
      user_id       TEXT,
      kind          TEXT NOT NULL,
      chain_slug    TEXT,
      target        TEXT,
      comparator    TEXT NOT NULL,
      threshold     REAL NOT NULL,
      cooldown_sec  INTEGER NOT NULL DEFAULT 900,
      enabled       INTEGER NOT NULL DEFAULT 1,
      last_fired_at INTEGER,
      created_at    INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_alerts_guild ON alerts(guild_id, enabled);
    CREATE INDEX IF NOT EXISTS idx_alerts_kind ON alerts(kind, enabled);

    -- Dedupe ledger: one row per (rule, fingerprint) inside a cooldown window.
    CREATE TABLE IF NOT EXISTS alert_dedupe (
      fingerprint  TEXT PRIMARY KEY,
      fired_at     INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_dedupe_ts ON alert_dedupe(fired_at);

    CREATE TABLE IF NOT EXISTS watchlists (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id    TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      kind        TEXT NOT NULL,
      value       TEXT NOT NULL,
      chain_slug  TEXT,
      created_at  INTEGER NOT NULL,
      UNIQUE(guild_id, user_id, kind, value, chain_slug)
    );

    CREATE TABLE IF NOT EXISTS api_usage (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      provider    TEXT NOT NULL,
      day         TEXT NOT NULL,
      calls       INTEGER NOT NULL DEFAULT 0,
      failures    INTEGER NOT NULL DEFAULT 0,
      units       REAL NOT NULL DEFAULT 0,
      latency_sum REAL NOT NULL DEFAULT 0,
      UNIQUE(provider, day)
    );

    CREATE TABLE IF NOT EXISTS provider_health (
      name          TEXT PRIMARY KEY,
      kind          TEXT NOT NULL,
      configured    INTEGER NOT NULL DEFAULT 0,
      state         TEXT NOT NULL DEFAULT 'closed',
      last_ok_at    INTEGER,
      last_error_at INTEGER,
      last_error    TEXT,
      updated_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS news (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      guid        TEXT NOT NULL UNIQUE,
      title       TEXT NOT NULL,
      url         TEXT NOT NULL,
      source      TEXT,
      published   INTEGER,
      chains      TEXT NOT NULL DEFAULT '[]',
      posted      INTEGER NOT NULL DEFAULT 0
    );
    `,
  },
  {
    id: "0004_signals_and_outcomes",
    sql: `
    -- A signal is a CLASSIFICATION of observed behaviour, never a prediction.
    -- Every row stores the features it was computed from, so a score can always
    -- be explained after the fact and re-derived if the weights change.
    CREATE TABLE IF NOT EXISTS signals (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      ts             INTEGER NOT NULL,
      chain_slug     TEXT NOT NULL,
      asset          TEXT NOT NULL,
      coingecko_id   TEXT,
      kind           TEXT NOT NULL,      -- accumulation | distribution | exchange_inflow | exchange_outflow | neutral
      direction      TEXT NOT NULL,      -- inflow | outflow | none
      impact_score   REAL NOT NULL,      -- 0..100, measurable components only
      confidence     REAL NOT NULL,      -- 0..100, how well-evidenced the classification is
      usd_value      REAL NOT NULL,
      features       TEXT NOT NULL DEFAULT '{}',
      evidence       TEXT NOT NULL DEFAULT '[]',
      -- Price of the asset at signal time. Without this an outcome cannot be
      -- measured later, so a signal with no price is not recorded at all.
      price_at       REAL NOT NULL,
      tx_hash        TEXT,
      UNIQUE(chain_slug, asset, kind, ts)
    );
    CREATE INDEX IF NOT EXISTS idx_signals_ts ON signals(ts DESC);
    CREATE INDEX IF NOT EXISTS idx_signals_asset ON signals(coingecko_id, ts DESC);

    -- Forward outcomes, filled in later by the outcome collector. Kept in its
    -- own table so a signal row is written once and never mutated by hindsight.
    CREATE TABLE IF NOT EXISTS signal_outcomes (
      signal_id      INTEGER NOT NULL,
      horizon_hours  INTEGER NOT NULL,
      price_then     REAL NOT NULL,
      return_pct     REAL NOT NULL,
      measured_at    INTEGER NOT NULL,
      PRIMARY KEY (signal_id, horizon_hours)
    );
    CREATE INDEX IF NOT EXISTS idx_outcomes_h ON signal_outcomes(horizon_hours);

    -- Per-wallet rolling behaviour, recomputed from observed transfers.
    CREATE TABLE IF NOT EXISTS wallet_behavior (
      chain_slug     TEXT NOT NULL,
      address        TEXT NOT NULL,
      window_days    INTEGER NOT NULL,
      inflow_usd     REAL NOT NULL DEFAULT 0,
      outflow_usd    REAL NOT NULL DEFAULT 0,
      net_usd        REAL NOT NULL DEFAULT 0,
      transfers      INTEGER NOT NULL DEFAULT 0,
      counterparties INTEGER NOT NULL DEFAULT 0,
      classification TEXT NOT NULL DEFAULT 'unknown',
      updated_at     INTEGER NOT NULL,
      PRIMARY KEY (chain_slug, address, window_days)
    );
    CREATE INDEX IF NOT EXISTS idx_behavior_net ON wallet_behavior(window_days, net_usd DESC);
    `,
  },
  {
    id: "0005_mempool_and_threats",
    sql: `
    -- Bitcoin network observations. One row per reading, so congestion and fee
    -- pressure can be charted rather than only shown as "right now".
    CREATE TABLE IF NOT EXISTS btc_network (
      ts                  INTEGER PRIMARY KEY,
      tip_height          INTEGER,
      mempool_count       INTEGER,
      mempool_vsize       INTEGER,
      mempool_total_fee   INTEGER,
      fastest_fee         REAL,
      half_hour_fee       REAL,
      hour_fee            REAL,
      economy_fee         REAL,
      minimum_fee         REAL,
      projected_blocks    INTEGER,
      difficulty_change   REAL,
      difficulty_progress REAL,
      retarget_eta        INTEGER,
      hashrate            REAL,
      price_usd           REAL,
      source              TEXT NOT NULL
    );

    -- Bitcoin whale transactions.
    --
    -- \`discovery\` is load-bearing and must never be flattened away:
    --   'block'   — found by walking EVERY transaction in a block. Complete.
    --   'mempool' — sampled from /mempool/recent, which exposes only the 10
    --               most recent entries. Partial by construction, and the
    --               misses are not random: they are whatever arrived earliest
    --               inside a refresh window. A mempool-discovered count is a
    --               floor, never a total.
    --
    -- Bitcoin is UTXO, so there is no single from/to. The largest input and
    -- output are recorded as the best single-address summary available, with
    -- the true fan-in/fan-out kept alongside as counts.
    CREATE TABLE IF NOT EXISTS btc_whale_txs (
      txid            TEXT PRIMARY KEY,
      first_seen      INTEGER NOT NULL,
      value_sats      INTEGER NOT NULL,
      fee_sats        INTEGER,
      vsize           INTEGER,
      n_in            INTEGER,
      n_out           INTEGER,
      top_in_addr     TEXT,
      top_in_sats     INTEGER,
      top_out_addr    TEXT,
      top_out_sats    INTEGER,
      self_spend      INTEGER NOT NULL DEFAULT 0,
      block_height    INTEGER,
      block_time      INTEGER,
      price_usd       REAL,
      value_usd       REAL,
      discovery       TEXT NOT NULL,
      sanctioned      INTEGER NOT NULL DEFAULT 0,
      sanctioned_addr TEXT,
      alerted         INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_btc_whale_seen ON btc_whale_txs(first_seen DESC);
    CREATE INDEX IF NOT EXISTS idx_btc_whale_value ON btc_whale_txs(value_sats DESC);
    CREATE INDEX IF NOT EXISTS idx_btc_whale_pending ON btc_whale_txs(alerted, value_sats DESC);
    CREATE INDEX IF NOT EXISTS idx_btc_whale_sanctioned ON btc_whale_txs(sanctioned, first_seen DESC);

    -- Which blocks were actually enumerated. A height absent from this table is
    -- the only thing that means "this block's whales were never counted", so a
    -- coverage gap is visible in the digest instead of silently reading as zero.
    CREATE TABLE IF NOT EXISTS btc_block_scans (
      height        INTEGER PRIMARY KEY,
      hash          TEXT NOT NULL,
      block_time    INTEGER NOT NULL,
      tx_count      INTEGER NOT NULL,
      txs_walked    INTEGER NOT NULL,
      whales_found  INTEGER NOT NULL,
      requests      INTEGER NOT NULL,
      duration_ms   INTEGER NOT NULL,
      complete      INTEGER NOT NULL,
      scanned_at    INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_btc_scan_time ON btc_block_scans(block_time DESC);

    -- Published security incidents. The key is the dataset's own identity
    -- (name + date); re-fetching the whole feed therefore never re-alerts.
    CREATE TABLE IF NOT EXISTS hack_incidents (
      key             TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      ts              INTEGER NOT NULL,
      amount_usd      REAL,
      classification  TEXT,
      technique       TEXT,
      chains          TEXT NOT NULL DEFAULT '[]',
      target_type     TEXT,
      bridge_hack     INTEGER NOT NULL DEFAULT 0,
      returned_funds  REAL,
      source_url      TEXT,
      first_seen      INTEGER NOT NULL,
      alerted         INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_hack_ts ON hack_incidents(ts DESC);
    CREATE INDEX IF NOT EXISTS idx_hack_pending ON hack_incidents(alerted, ts DESC);

    -- Sanctioned addresses, mirrored from the published OFAC list. Held locally
    -- so screening a block costs zero extra requests.
    CREATE TABLE IF NOT EXISTS sanctioned_addresses (
      address     TEXT NOT NULL,
      asset       TEXT NOT NULL,
      fetched_at  INTEGER NOT NULL,
      PRIMARY KEY (address, asset)
    );
    `,
  },
  {
    id: "0006_intelligence",
    sql: `
    -- Per-transaction features and the score derived from them.
    --
    -- Stored SEPARATELY from btc_whale_txs because a feature vector is a
    -- measurement of a transaction while a score is an opinion about it. The
    -- weights that turn one into the other will change; the measurements must
    -- not be rewritten when they do, or every historical score becomes
    -- unreproducible.
    CREATE TABLE IF NOT EXISTS btc_tx_features (
      txid              TEXT PRIMARY KEY,
      computed_at       INTEGER NOT NULL,
      value_sats        INTEGER NOT NULL,
      fee_sats          INTEGER,
      vsize             INTEGER,
      fee_rate          REAL,
      n_in              INTEGER NOT NULL,
      n_out             INTEGER NOT NULL,
      -- Sum of (value x age) over inputs, in satoshi-days. The classic
      -- coin-days-destroyed measure.
      coin_days         REAL,
      -- Value-weighted mean input age in days.
      mean_age_days     REAL,
      oldest_age_days   REAL,
      -- Share of input value that had been untouched for over a year.
      dormant_frac      REAL,
      -- How many inputs actually had their age resolved. A score built on two
      -- of forty inputs is not the same claim as one built on all forty.
      inputs_aged       INTEGER NOT NULL DEFAULT 0,
      -- Share of output value landing in the single largest output.
      top_out_frac      REAL,
      -- Shannon entropy of the output distribution, normalised 0..1.
      out_entropy       REAL,
      dust_outs         INTEGER NOT NULL DEFAULT 0,
      -- Inputs signalling replaceability (nSequence < 0xfffffffe).
      rbf_signalled     INTEGER NOT NULL DEFAULT 0,
      -- Structural read of the transaction: consolidation, distribution,
      -- transfer, sweep, unknown.
      shape             TEXT NOT NULL DEFAULT 'unknown',
      shape_confidence  REAL NOT NULL DEFAULT 0,
      shape_evidence    TEXT NOT NULL DEFAULT '[]',
      entity_in         TEXT,
      entity_out        TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_feat_time ON btc_tx_features(computed_at DESC);

    -- Scores, with the contribution of every component kept alongside the
    -- total. A score nobody can decompose is a number nobody should act on.
    CREATE TABLE IF NOT EXISTS btc_tx_scores (
      txid          TEXT PRIMARY KEY,
      scored_at     INTEGER NOT NULL,
      score         REAL NOT NULL,
      severity      TEXT NOT NULL,
      -- [{key,label,points,detail}] summing to the score column.
      contributions TEXT NOT NULL DEFAULT '[]',
      -- Plain-language reasons shown under "why it matters".
      reasons       TEXT NOT NULL DEFAULT '[]',
      -- Version of the weight table, so a re-score is distinguishable from a
      -- change in the underlying transaction.
      model         TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_score_value ON btc_tx_scores(score DESC);
    CREATE INDEX IF NOT EXISTS idx_score_time ON btc_tx_scores(scored_at DESC);

    -- Rolling population statistics, so "unusual" is measured against what this
    -- chain has actually been doing rather than against a hardcoded constant.
    -- Median and MAD rather than mean and standard deviation: Bitcoin value
    -- distributions are heavy-tailed and a single 2,400 BTC transaction would
    -- drag a mean far enough to hide the next one.
    CREATE TABLE IF NOT EXISTS btc_baselines (
      metric      TEXT PRIMARY KEY,
      median      REAL NOT NULL,
      mad         REAL NOT NULL,
      p95         REAL,
      p99         REAL,
      samples     INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );

    -- Cache of when a UTXO was created, so coin age costs one lookup per
    -- funding transaction rather than one per input that spends it.
    CREATE TABLE IF NOT EXISTS btc_utxo_age (
      txid          TEXT PRIMARY KEY,
      block_height  INTEGER,
      block_time    INTEGER,
      fetched_at    INTEGER NOT NULL
    );

    -- Replacement (RBF) events observed in the mempool.
    CREATE TABLE IF NOT EXISTS btc_replacements (
      txid            TEXT PRIMARY KEY,
      replaced_txid   TEXT NOT NULL,
      observed_at     INTEGER NOT NULL,
      old_fee         INTEGER,
      new_fee         INTEGER,
      old_rate        REAL,
      new_rate        REAL,
      value_sats      INTEGER,
      full_rbf        INTEGER NOT NULL DEFAULT 0,
      alerted         INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_repl_time ON btc_replacements(observed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_repl_pending ON btc_replacements(alerted, observed_at DESC);

    -- Entity labels for addresses, loaded from a data file rather than code so
    -- the list can be updated without a rebuild.
    CREATE TABLE IF NOT EXISTS btc_entities (
      address     TEXT PRIMARY KEY,
      entity      TEXT NOT NULL,
      category    TEXT,
      description TEXT,
      source      TEXT NOT NULL,
      loaded_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_entity_name ON btc_entities(entity);
    `,
  },
  {
    id: "0007_baselines_and_flows",
    sql: `
    -- A sample of OBSERVED transactions, used to decide what "unusual" means.
    --
    -- Sampled from every transaction in a walked block, NOT from the whales.
    -- That distinction is the whole point: a median computed over transactions
    -- already filtered to 50 BTC and above lands around 80 BTC, and every whale
    -- then measures as unremarkable against its own kind. The population has to
    -- be the whole block for the statistic to mean anything.
    --
    -- Bounded by pruning to the newest rows per metric, so this is a rolling
    -- window rather than an ever-growing table.
    CREATE TABLE IF NOT EXISTS btc_samples (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      metric  TEXT NOT NULL,
      value   REAL NOT NULL,
      ts      INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_samples_metric ON btc_samples(metric, id DESC);

    -- Addresses touched by transactions we kept, so movements can be linked to
    -- each other. Written only for transactions that cleared the whale
    -- threshold; indexing every address on the chain is a different product.
    CREATE TABLE IF NOT EXISTS btc_tx_addresses (
      txid        TEXT NOT NULL,
      address     TEXT NOT NULL,
      side        TEXT NOT NULL,
      value_sats  INTEGER NOT NULL,
      ts          INTEGER NOT NULL,
      PRIMARY KEY (txid, address, side)
    );
    CREATE INDEX IF NOT EXISTS idx_txaddr_addr ON btc_tx_addresses(address, ts DESC);
    CREATE INDEX IF NOT EXISTS idx_txaddr_ts ON btc_tx_addresses(ts DESC);

    -- A tracked movement of funds across more than one transaction.
    --
    -- A flow exists when value leaving one transaction is spent again by
    -- another within the tracking window. Reporting those as unrelated whale
    -- alerts is what the old behaviour did, and it turned one 1,000 BTC
    -- movement through three hops into four separate alerts that nobody could
    -- connect.
    CREATE TABLE IF NOT EXISTS btc_flows (
      id            TEXT PRIMARY KEY,
      started_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL,
      root_txid     TEXT NOT NULL,
      hops          INTEGER NOT NULL DEFAULT 1,
      tx_count      INTEGER NOT NULL DEFAULT 1,
      total_sats    INTEGER NOT NULL DEFAULT 0,
      destinations  INTEGER NOT NULL DEFAULT 0,
      -- Satoshis per minute across the life of the flow.
      velocity      REAL,
      risk          REAL NOT NULL DEFAULT 0,
      status        TEXT NOT NULL DEFAULT 'open',
      -- Discord message id, so a flow is EDITED as it grows rather than
      -- reposted at every hop.
      message_id    TEXT,
      alerted_at    INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_flows_updated ON btc_flows(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_flows_risk ON btc_flows(risk DESC);

    CREATE TABLE IF NOT EXISTS btc_flow_txs (
      flow_id     TEXT NOT NULL,
      txid        TEXT NOT NULL,
      hop         INTEGER NOT NULL,
      value_sats  INTEGER NOT NULL,
      ts          INTEGER NOT NULL,
      PRIMARY KEY (flow_id, txid)
    );
    CREATE INDEX IF NOT EXISTS idx_flowtx_flow ON btc_flow_txs(flow_id, hop);
    `,
  },
  {
    id: "0008_address_profiles",
    sql: `
    -- What one address normally does.
    --
    -- The point of this table is that "abnormal" is a statement about a
    -- specific address, not about Bitcoin. An exchange hot wallet moving 500
    -- BTC to a fresh address is Tuesday; a wallet that has spent twice in six
    -- years doing the same thing is not. Without a per-address history both
    -- score identically on every feature the transaction itself carries.
    --
    -- Everything here is accumulated from observed transactions. Nothing is
    -- seeded, so an address with no history produces LOW CONFIDENCE rather
    -- than a default that would read as "normal".
    CREATE TABLE IF NOT EXISTS btc_address_profile (
      address           TEXT PRIMARY KEY,
      first_seen        INTEGER NOT NULL,
      last_seen         INTEGER NOT NULL,
      -- Last time this address was seen SPENDING, which is what dormancy is
      -- measured from. An address receiving dust is not active in the sense
      -- that matters.
      last_spend_at     INTEGER,
      spend_count       INTEGER NOT NULL DEFAULT 0,
      receive_count     INTEGER NOT NULL DEFAULT 0,
      total_in_sats     INTEGER NOT NULL DEFAULT 0,
      total_out_sats    INTEGER NOT NULL DEFAULT 0,
      -- Running mean and sum of squares of spend size, for a variance without
      -- keeping every observation.
      spend_mean        REAL NOT NULL DEFAULT 0,
      spend_m2          REAL NOT NULL DEFAULT 0,
      max_spend_sats    INTEGER NOT NULL DEFAULT 0,
      -- Mean structural shape of this address's spends.
      mean_n_in         REAL NOT NULL DEFAULT 0,
      mean_n_out        REAL NOT NULL DEFAULT 0,
      mean_fee_rate     REAL,
      -- Distinct addresses this one has ever paid, capped by pruning.
      counterparties    INTEGER NOT NULL DEFAULT 0,
      -- Mean share of balance removed per spend, for drain comparison.
      mean_drain_ratio  REAL,
      drain_samples     INTEGER NOT NULL DEFAULT 0,
      updated_at        INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_profile_seen ON btc_address_profile(last_seen DESC);

    -- Who an address has paid before, so a destination can be called new.
    CREATE TABLE IF NOT EXISTS btc_counterparties (
      address       TEXT NOT NULL,
      counterparty  TEXT NOT NULL,
      first_seen    INTEGER NOT NULL,
      last_seen     INTEGER NOT NULL,
      times         INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (address, counterparty)
    );
    CREATE INDEX IF NOT EXISTS idx_cp_addr ON btc_counterparties(address);

    -- Detected behavioural patterns, stored so an incident is assembled from
    -- evidence rather than recomputed at render time.
    CREATE TABLE IF NOT EXISTS btc_patterns (
      txid        TEXT NOT NULL,
      kind        TEXT NOT NULL,
      strength    REAL NOT NULL,
      confidence  REAL NOT NULL,
      evidence    TEXT NOT NULL,
      detected_at INTEGER NOT NULL,
      PRIMARY KEY (txid, kind)
    );
    CREATE INDEX IF NOT EXISTS idx_pattern_time ON btc_patterns(detected_at DESC);
    `,
  },
  {
    id: "0009_address_spend_history",
    sql: `
    -- A bounded ring of an address's recent SPENDS.
    --
    -- The profile table holds durable aggregates (Welford mean, counters, last
    -- spend time), which is enough for a mean but not for a median. Every
    -- detector that matters here compares against a median and a MAD, because
    -- Bitcoin distributions are heavy-tailed enough that a mean is dominated by
    -- whichever single observation was largest. A median needs the actual
    -- observations, so a bounded window of them is kept per address.
    --
    -- Bounded per address rather than globally: an exchange spending every
    -- block must not evict the history of a cold wallet that spends twice a
    -- year, and it is the cold wallet whose history carries the most signal.
    CREATE TABLE IF NOT EXISTS btc_address_spends (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      address     TEXT NOT NULL,
      ts          INTEGER NOT NULL,
      value_sats  INTEGER NOT NULL,
      -- Share of the address's balance removed, when the balance was readable.
      drain_ratio REAL,
      n_in        INTEGER,
      n_out       INTEGER,
      fee_rate    REAL,
      -- Gap since this address's previous observed spend, in ms. Null on the
      -- first one, because a gap needs two points.
      gap_ms      INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_spends_addr ON btc_address_spends(address, id DESC);
    `,
  },
];
