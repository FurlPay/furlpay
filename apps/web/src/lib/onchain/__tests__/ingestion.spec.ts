import { describe, expect, it } from "vitest";
import { eventKey, normalizeBeamRecord, normalizeWalletItem } from "../normalize";
import { signBeam, verifyBeam } from "../beamAuth";
import { pipelineState, toFeed, type Row } from "../live";

const HASH = "0x" + "ab".repeat(32);
const A = "0x" + "11".repeat(20);
const B = "0x" + "22".repeat(20);
const USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

const beam = (over: Record<string, unknown> = {}) => ({
  chain: "base",
  transaction_hash: HASH.toUpperCase().replace("0X", "0x"),
  log_index: 7,
  block_number: 21_000_000,
  block_hash: "0x" + "cd".repeat(32),
  block_timestamp: "2026-10-06 10:15:03",
  from_address: A,
  to_address: B,
  token_address: USDC_BASE,
  token_symbol: "USDC",
  raw_amount_str: "1250000000",
  raw_amount: 1250000000,
  amount_str: "1250",
  amount: 1250,
  usd_amount: 1249.93,
  unique_id: `${HASH}-7`,
  ...over,
});

describe("normalizeBeamRecord (documented erc20_token_transfer columns)", () => {
  it("normalizes a valid record exactly, lowercasing EVM values", () => {
    const r = normalizeBeamRecord(beam(), { zerolag: false });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const t = r.transfers[0];
    expect(t.event_key).toBe(`base:${HASH}:7`);
    expect(t.tx_hash).toBe(HASH);
    expect(t.amount_raw).toBe("1250000000");
    expect(t.amount).toBe("1250");
    expect(t.amount_usd).toBe("1249.93000000");
    // TIMESTAMP_NTZ without offset is UTC.
    expect(t.block_timestamp).toBe("2026-10-06T10:15:03.000Z");
    expect(t.confirmation_state).toBe("confirmed");
  });

  it("marks pre-finality data 'observed' only when the pipeline is zerolag", () => {
    const r = normalizeBeamRecord(beam(), { zerolag: true });
    expect(r.ok && r.transfers[0].confirmation_state).toBe("observed");
  });

  it("never takes value from the float columns", () => {
    const r = normalizeBeamRecord(beam({ raw_amount_str: undefined, amount_str: undefined }), { zerolag: false });
    expect(r).toEqual({ ok: false, reason: "no exact amount (raw_amount_str / amount_str)" });
  });

  it("rejects malformed input with a reason (-> dead letter), never defaults", () => {
    expect(normalizeBeamRecord({ hello: "world" }, { zerolag: false }).ok).toBe(false);
    expect(normalizeBeamRecord(beam({ transaction_hash: "0x123" }), { zerolag: false })).toEqual({ ok: false, reason: "invalid transaction_hash" });
    expect(normalizeBeamRecord(beam({ to_address: "not-an-address" }), { zerolag: false })).toEqual({ ok: false, reason: "invalid from/to address" });
    expect(normalizeBeamRecord(beam({ chain: undefined }), { zerolag: false })).toEqual({ ok: false, reason: "record has no valid chain" });
    expect(normalizeBeamRecord(beam({ chain: "Base Mainnet!" }), { zerolag: false }).ok).toBe(false);
    expect(normalizeBeamRecord(beam({ raw_amount_str: "-5", amount_str: "abc" }), { zerolag: false }).ok).toBe(false);
    expect(normalizeBeamRecord(beam({ block_timestamp: "2099-01-01T00:00:00Z" }), { zerolag: false })).toEqual({ ok: false, reason: "invalid block_timestamp" });
  });

  it("takes the chain from the URL hint when the record has none", () => {
    const r = normalizeBeamRecord(beam({ chain: undefined }), { chain: "polygon", zerolag: false });
    expect(r.ok && r.transfers[0].chain).toBe("polygon");
  });

  it("produces the same key for the same event however it is cased (dedupe)", () => {
    const a = normalizeBeamRecord(beam(), { zerolag: false });
    const b = normalizeBeamRecord(beam({ transaction_hash: HASH.toLowerCase(), from_address: A.toUpperCase().replace("0X", "0x") }), { zerolag: false });
    expect(a.ok && b.ok && a.transfers[0].event_key === b.transfers[0].event_key).toBe(true);
  });

  it("keeps uint256-sized amounts exact", () => {
    const max = "115792089237316195423570985008687907853269984665640564039457584007913129639935";
    const r = normalizeBeamRecord(beam({ raw_amount_str: max }), { zerolag: false });
    expect(r.ok && r.transfers[0].amount_raw).toBe(max);
  });
});

describe("normalizeWalletItem (Realtime API wallet transactions)", () => {
  const item = {
    id: "x",
    chain: "ethereum",
    hash: HASH,
    block_timestamp: "2026-10-05T08:00:00Z",
    block_number: 1,
    block_hash: "0x" + "ef".repeat(32),
    labels: ["Transfer"],
    asset_transfers: [
      { transfer_type: "received", transaction_hash: HASH, log_index: 3, from_address: A, to_address: B, asset: { type: "evm_erc20", address: USDC_BASE, symbol: "USDC", decimals: 6 }, amount: { raw_amount: "5000000", amount_str: "5" } },
      { transfer_type: "minted", operation: "mint", transaction_hash: HASH, log_index: 4, from_address: "0x" + "00".repeat(20), to_address: B, asset: { type: "evm_erc20", symbol: "USDC", decimals: 6 }, amount: { raw_amount: "1", amount_str: "0.000001" } },
      { transfer_type: "received", transaction_hash: HASH, log_index: 5, from_address: A, to_address: B, asset: { type: "evm_erc721", symbol: "NFT" }, amount: { raw_amount: "1" } },
      { transfer_type: "invalid", transaction_hash: HASH, log_index: 6, from_address: A, to_address: B, asset: { type: "evm_erc20" }, amount: { raw_amount: "9" } },
      { transfer_type: "sent", transaction_hash: HASH, log_index: null, from_address: B, to_address: A, asset: { type: "native", symbol: "ETH", decimals: 18 }, amount: { raw_amount: "1000000000000000000", amount_str: "1" } },
    ],
    activities: [{ type: "dex_trade", transaction_hash: HASH }],
  };

  it("maps fungible transfers; skips NFTs and invalid ones; native transfers get a deterministic key", () => {
    const r = normalizeWalletItem(item);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.transfers.map((t) => t.event_key)).toEqual([`ethereum:${HASH}:3`, `ethereum:${HASH}:4`, `ethereum:${HASH}:native:${B}:${A}:1000000000000000000`]);
    expect(r.transfers[0].activity_type).toBe("swap");
    expect(r.transfers[1].activity_type).toBe("mint");
    expect(r.transfers[0].asset_decimals).toBe(6);
    // Served from the chain tip: observed until reconciliation sees it past finality.
    expect(r.transfers.every((t) => t.confirmation_state === "observed")).toBe(true);
  });

  it("rejects an item that does not match the documented schema", () => {
    expect(normalizeWalletItem({ chain: "ethereum" }).ok).toBe(false);
  });

  it("eventKey is stable", () => {
    expect(eventKey("Base", "0xABC", 1)).toBe("base:0xabc:1");
  });
});

describe("verifyBeam (docs: X-Webhook-Timestamp, X-Webhook-Nonce, X-Signature-256)", () => {
  const secret = "s".repeat(40);
  const nonce = "6f1c2c1e-6a51-4d8b-9a56-3c1d7a0e9b10";
  const now = Date.UTC(2026, 9, 6, 12, 0, 0);
  const ts = String(Math.floor(now / 1000));
  const body = Buffer.from(JSON.stringify(beam()));
  const headers = (over: Record<string, string> = {}) =>
    new Headers({ "x-webhook-timestamp": ts, "x-webhook-nonce": nonce, "x-signature-256": signBeam(secret, nonce, ts, body), ...over });
  const withSecret = <T,>(fn: () => T, value: string | null = secret): T => {
    const prev = process.env.ALLIUM_BEAM_WEBHOOK_SECRET;
    if (value === null) delete process.env.ALLIUM_BEAM_WEBHOOK_SECRET;
    else process.env.ALLIUM_BEAM_WEBHOOK_SECRET = value;
    try {
      return fn();
    } finally {
      if (prev === undefined) delete process.env.ALLIUM_BEAM_WEBHOOK_SECRET;
      else process.env.ALLIUM_BEAM_WEBHOOK_SECRET = prev;
    }
  };

  it("accepts a correctly signed delivery", () => {
    expect(withSecret(() => verifyBeam(headers(), body, now))).toEqual({ ok: true, nonce, timestamp: Number(ts) });
  });
  it("signs nonce.timestamp.raw_body as sha256=<hex>", () => {
    const sig = signBeam(secret, nonce, ts, body);
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
  });
  it("rejects an invalid signature, a tampered body, missing headers, a bad nonce", () => {
    expect(withSecret(() => verifyBeam(headers({ "x-signature-256": "sha256=" + "0".repeat(64) }), body, now))).toMatchObject({ ok: false, reason: "bad_signature" });
    expect(withSecret(() => verifyBeam(headers(), Buffer.from(body.toString().replace("1250", "9999")), now))).toMatchObject({ ok: false, reason: "bad_signature" });
    expect(withSecret(() => verifyBeam(new Headers({ "x-webhook-timestamp": ts }), body, now))).toMatchObject({ ok: false, status: 401, reason: "missing_headers" });
    expect(withSecret(() => verifyBeam(headers({ "x-webhook-nonce": "not-a-uuid" }), body, now))).toMatchObject({ ok: false, reason: "bad_nonce" });
  });
  it("rejects stale and future timestamps (5-minute window)", () => {
    expect(withSecret(() => verifyBeam(headers(), body, now + 301_000))).toMatchObject({ ok: false, reason: "stale" });
    expect(withSecret(() => verifyBeam(headers(), body, now - 301_000))).toMatchObject({ ok: false, reason: "stale" });
  });
  it("fails closed with no (or a short) secret configured", () => {
    expect(withSecret(() => verifyBeam(headers(), body, now), null)).toMatchObject({ ok: false, status: 503, reason: "not_configured" });
    expect(withSecret(() => verifyBeam(headers(), body, now), "short")).toMatchObject({ ok: false, status: 503, reason: "not_configured" });
  });
});

describe("live read model", () => {
  const row = (over: Partial<Row> = {}): Row => ({
    id: 1,
    event_key: `base:${HASH}:7`,
    chain: "base",
    tx_hash: HASH,
    block_number: 1,
    block_hash: null,
    block_timestamp: "2026-10-06T10:00:00Z",
    log_index: 7,
    from_address: A,
    to_address: B,
    asset_address: USDC_BASE,
    asset_symbol: "USDC",
    amount: "1250",
    amount_usd: "1250",
    activity_type: "transfer",
    direction: "in",
    scope: "user",
    confirmation_state: "confirmed",
    reconciliation_required: true,
    observed_at: "2026-10-06T10:00:02Z",
    ...over,
  });

  it("redacts a USER wallet's event for the public: truncated, no explorer link, no reconciliation flag", () => {
    const f = toFeed(row(), false);
    expect(f.hashFull).toBeNull();
    expect(f.from).not.toBe(A);
    expect(f.to).toContain("…");
    expect(f.explorerUrl).toBeNull();
    expect(f.reconciliationRequired).toBe(false);
    expect(JSON.stringify(f)).not.toContain(HASH);
  });
  it("shows FurlPay-owned (treasury) activity in full with an official explorer link", () => {
    const f = toFeed(row({ scope: "treasury" }), false);
    expect(f.hashFull).toBe(HASH);
    expect(f.explorerUrl).toBe(`https://basescan.org/tx/${HASH}`);
  });
  it("gives no explorer link for a chain without a configured explorer", () => {
    expect(toFeed(row({ scope: "treasury", chain: "hyperevm" }), false).explorerUrl).toBeNull();
  });

  const configured = { alliumApiKey: true, beamWebhook: true, store: true };
  const health = { eventsTotal: 5, deadLetters24h: 0, deadLettersOpen: 0, reconciliationRequired: 0, reorgedTotal: 0, lastRun: null };
  const now = Date.UTC(2026, 9, 6, 12);
  it("is never 'live' without evidence", () => {
    expect(pipelineState({ configured, health, lastIngestAt: null, now }).state).toBe("stale");
    expect(pipelineState({ configured, health, lastIngestAt: new Date(now - 27 * 3600_000).toISOString(), now }).state).toBe("stale");
    expect(pipelineState({ configured, health, lastIngestAt: new Date(now - 60_000).toISOString(), now }).state).toBe("live");
  });
  it("reports degraded, offline and not-configured honestly", () => {
    expect(pipelineState({ configured, health: { ...health, deadLetters24h: 2 }, lastIngestAt: new Date(now).toISOString(), now }).state).toBe("degraded");
    expect(pipelineState({ configured, health: null, lastIngestAt: null, now }).state).toBe("offline");
    expect(pipelineState({ configured: { ...configured, store: false }, health, lastIngestAt: null, now }).state).toBe("offline");
    expect(pipelineState({ configured: { alliumApiKey: false, beamWebhook: false, store: true }, health, lastIngestAt: null, now }).state).toBe("not_configured");
    expect(
      pipelineState({ configured, health: { ...health, lastRun: { kind: "reconcile", status: "partial", finishedAt: new Date(now).toISOString(), startedAt: new Date(now).toISOString(), inserted: 0, markedReorged: 0 } }, lastIngestAt: new Date(now).toISOString(), now }).state
    ).toBe("degraded");
  });
});

import { scaleRaw, summarizeHoldings } from "../holdings";

describe("treasury holdings (Allium wallet balances)", () => {
  it("scales raw balances exactly", () => {
    expect(scaleRaw("1300000000000000000", 18)).toBe("1.3");
    expect(scaleRaw("5", 6)).toBe("0.000005");
    expect(scaleRaw("1000000", 6)).toBe("1");
    expect(scaleRaw("42", 0)).toBe("42");
  });
  const tok = (over: Record<string, unknown> = {}) => ({
    address: "0xusdc",
    decimals: 6,
    price: 1,
    info: { symbol: "USDC" },
    attributes: { total_liquidity_usd: { amount: 5e8 } },
    ...over,
  });
  it("counts only priced, liquid tokens; spam and unpriced balances are excluded, not summed", () => {
    const h = summarizeHoldings(
      [
        { chain: "base", address: "0xt", token: tok(), raw_balance_str: "2500000000", block_timestamp: "2026-10-06T10:00:00Z" },
        { chain: "base", address: "0xt", token: tok({ address: "0xspam", info: { symbol: "FREE" }, price: 50, attributes: { total_liquidity_usd: { amount: 900 } } }), raw_balance_str: "1000000000000" },
        { chain: "base", address: "0xt", token: tok({ address: "0xnoprice", price: null }), raw_balance_str: "100" },
        { chain: "base", address: "0xt", token: tok({ decimals: null }), raw_balance_str: "100" },
      ],
      1
    );
    expect(h.totalUsd).toBe(2500);
    expect(h.counted).toBe(1);
    expect(h.excluded).toBe(3);
    expect(h.byAsset[0]).toMatchObject({ symbol: "USDC", quantity: "2500", usd: 2500 });
  });
});
