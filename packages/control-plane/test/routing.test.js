"use strict";
// ---------------------------------------------------------------------------
// Routing, capability negotiation, and the one thing a router must never do.
//
// THE PROPERTY UNDER TEST:
//
//     THE ROUTER NEVER SILENTLY EXPANDS AUTHORITY.
//
// A mandate naming `allowed_rails: ["stablecoin"]` did not authorize a card
// payment. A stablecoin outage does not change what it authorized. A router that
// reaches for an available card in that situation has widened the principal's
// grant, and it looks like resilience while doing it — which is why it gets its
// own test file rather than a line in a routing test.
//
// The second property: a rail FurlPay has no commercial access to can never be
// selected for real value, whatever the capability match says.
// ---------------------------------------------------------------------------
const test = require("node:test");
const assert = require("node:assert");
const {
  eligibleRails,
  selectRoute,
  scoreRoute,
  authorizeFailover,
  assertFailoverAllowed,
  RailError,
  RailRegistry,
  evaluateRailCapability,
  selectableForLive,
  selectableForSandbox,
  liveRails,
  accessSummary,
  RAIL_MATRIX,
} = require("../dist/index.js");

const USDC = (m) => String(Math.round(m * 1e6));

function cap(railId, kind, overrides = {}) {
  return {
    railId,
    kind,
    displayName: railId,
    networks: ["arbitrum_one"],
    assets: ["USDC"],
    countries: [],
    minAmountAtomic: "1",
    maxAmountAtomic: USDC(1_000_000),
    finality: "irreversible",
    expectedSettlementSeconds: 10,
    fixedFeeAtomic: "1000",
    variableFeeBps: 10,
    supportsDeferredSettlement: false,
    supportsReversal: false,
    ...overrides,
  };
}

function quote(railId, feeAtomic, seconds = 10, finality = "irreversible") {
  return {
    railId,
    railQuoteId: `q_${railId}`,
    amountAtomic: USDC(100),
    feeAtomic,
    totalDebitAtomic: USDC(100),
    asset: "USDC",
    networkId: "arbitrum_one",
    expiresAt: "2026-09-28T12:05:00Z",
    expectedSettlementSeconds: seconds,
    finality,
  };
}

const healthy = (ids) => new Map(ids.map((id) => [id, { railId: id, state: "healthy", observedAt: "x" }]));

// ── The authority-expansion test the architecture document demands ─────────

test("allowed_rails=[stablecoin] excludes an available card rail", () => {
  const stablecoin = cap("stablecoin_cctp", "stablecoin");
  const card = cap("visa_intelligent_commerce", "card", { assets: ["USDC"], finality: "revocable" });

  const { eligible, rejected } = eligibleRails({
    capabilities: [stablecoin, card],
    constraints: {
      amountAtomic: USDC(100),
      asset: "USDC",
      networkId: "arbitrum_one",
      allowedRails: ["stablecoin_cctp"],
    },
    health: healthy(["stablecoin_cctp", "visa_intelligent_commerce"]),
  });

  assert.deepStrictEqual(eligible.map((c) => c.railId), ["stablecoin_cctp"]);
  const cardRejection = rejected.find((r) => r.railId === "visa_intelligent_commerce");
  assert.ok(cardRejection, "the card rail must be explicitly rejected, not silently absent");
  assert.strictEqual(cardRejection.reason, "not_in_policy_allowlist");
});

test("allowed_rails=[stablecoin] with the stablecoin rail DOWN selects nothing — it does not fall back to card", () => {
  // This is the exact scenario. The card is healthy and available. The answer is
  // still no route, because no route was authorized.
  const health = new Map([
    ["stablecoin_cctp", { railId: "stablecoin_cctp", state: "unavailable", observedAt: "x", detail: "RPC down" }],
    ["visa_intelligent_commerce", { railId: "visa_intelligent_commerce", state: "healthy", observedAt: "x" }],
  ]);
  const { eligible, rejected } = eligibleRails({
    capabilities: [cap("stablecoin_cctp", "stablecoin"), cap("visa_intelligent_commerce", "card")],
    constraints: {
      amountAtomic: USDC(100),
      asset: "USDC",
      networkId: "arbitrum_one",
      allowedRails: ["stablecoin_cctp"],
    },
    health,
  });
  assert.strictEqual(eligible.length, 0);
  const selection = selectRoute({ quotes: [], constraints: { amountAtomic: USDC(100), asset: "USDC", networkId: "arbitrum_one" }, health, rejected });
  assert.strictEqual(selection.selected, null, "no rail is selected");
  assert.strictEqual(selection.ranked.length, 0);
  // Both exclusions are reported with their own reason.
  assert.strictEqual(rejected.find((r) => r.railId === "stablecoin_cctp").reason, "rail_unavailable");
  assert.strictEqual(rejected.find((r) => r.railId === "visa_intelligent_commerce").reason, "not_in_policy_allowlist");
});

test("an EMPTY allowed_rails array denies every rail; an ABSENT one constrains nothing", () => {
  const caps = [cap("a", "stablecoin"), cap("b", "stablecoin")];
  const base = { amountAtomic: USDC(100), asset: "USDC", networkId: "arbitrum_one" };

  const none = eligibleRails({ capabilities: caps, constraints: { ...base, allowedRails: [] }, health: healthy(["a", "b"]) });
  assert.strictEqual(none.eligible.length, 0, "[] must allow nothing");

  const all = eligibleRails({ capabilities: caps, constraints: base, health: healthy(["a", "b"]) });
  assert.strictEqual(all.eligible.length, 2, "absent must constrain nothing");
});

// ── Failover authorization ────────────────────────────────────────────────

test("failover is DENIED by default when no policy is present", () => {
  const out = authorizeFailover({ policy: undefined, allowedRails: undefined, failedRailId: "a" });
  assert.strictEqual(out.permitted, false);
  assert.match(out.reason, /did not permit cross-rail fallback/);
});

test('failover mode "none" denies', () => {
  const out = authorizeFailover({ policy: { mode: "none" }, allowedRails: ["a", "b"], failedRailId: "a" });
  assert.strictEqual(out.permitted, false);
});

test("explicit failover is permitted only for rails the mandate ALSO allows", () => {
  // The policy offers a card fallback; the mandate never authorized a card.
  // The intersection is empty, and the intersection is what governs.
  const out = authorizeFailover({
    policy: { mode: "explicit", rails: ["stablecoin_cctp", "visa_intelligent_commerce"] },
    allowedRails: ["stablecoin_cctp", "x402_usdc_arbitrum"],
    failedRailId: "stablecoin_cctp",
  });
  assert.strictEqual(out.permitted, false, "no rail is in both sets");
  assert.match(out.reason, /both the failover policy and the mandate/);
});

test("explicit failover succeeds when policy and mandate agree", () => {
  const out = authorizeFailover({
    policy: { mode: "explicit", rails: ["x402_usdc_arbitrum", "stablecoin_cctp"] },
    allowedRails: ["x402_usdc_arbitrum", "stablecoin_cctp"],
    failedRailId: "stablecoin_cctp",
  });
  assert.strictEqual(out.permitted, true);
  assert.deepStrictEqual(out.candidates, ["x402_usdc_arbitrum"], "the failed rail is excluded");
});

test("failover never returns the rail that just failed", () => {
  const out = authorizeFailover({
    policy: { mode: "explicit", rails: ["a"] },
    allowedRails: ["a"],
    failedRailId: "a",
  });
  assert.strictEqual(out.permitted, false);
});

// ── Failover vs settlement state ──────────────────────────────────────────

test("failover is refused on any state where value may be committed", () => {
  for (const state of ["SUBMITTED", "PENDING", "ESCROWED", "SETTLED"]) {
    assert.throws(
      () => assertFailoverAllowed(state),
      (e) => e instanceof RailError && /value may already be committed/.test(e.message),
      `${state} must refuse failover`
    );
  }
});

test("INDETERMINATE refuses failover and says it must reach a status poll", () => {
  assert.throws(
    () => assertFailoverAllowed("INDETERMINATE"),
    (e) => e instanceof RailError && /status poll, never a retry/.test(e.message)
  );
});

test("FAILED is the only state that permits trying another rail", () => {
  assert.doesNotThrow(() => assertFailoverAllowed("FAILED"));
});

// ── Selection determinism ────────────────────────────────────────────────

test("selection is stable: identical inputs pick the same rail every time", () => {
  const args = {
    quotes: [quote("b", "2000"), quote("a", "2000")],
    constraints: { amountAtomic: USDC(100), asset: "USDC", networkId: "arbitrum_one" },
    health: healthy(["a", "b"]),
    rejected: [],
  };
  const first = selectRoute(args);
  const second = selectRoute(args);
  assert.strictEqual(first.selected.railId, second.selected.railId);
  // Equal scores tie-break on railId, so the winner is "a" and not input order.
  assert.strictEqual(first.selected.railId, "a");
});

test("a cheaper rail beats a dearer one when everything else is equal", () => {
  const sel = selectRoute({
    quotes: [quote("cheap", "500"), quote("dear", "50000")],
    constraints: { amountAtomic: USDC(100), asset: "USDC", networkId: "arbitrum_one" },
    health: healthy(["cheap", "dear"]),
    rejected: [],
  });
  assert.strictEqual(sel.selected.railId, "cheap");
});

test("health outranks price — a cheap degraded rail loses to a healthy dearer one", () => {
  const health = new Map([
    ["cheap", { railId: "cheap", state: "degraded", observedAt: "x" }],
    ["dear", { railId: "dear", state: "healthy", observedAt: "x" }],
  ]);
  const sel = selectRoute({
    quotes: [quote("cheap", "500"), quote("dear", "5000")],
    constraints: { amountAtomic: USDC(100), asset: "USDC", networkId: "arbitrum_one" },
    health,
    rejected: [],
  });
  assert.strictEqual(sel.selected.railId, "dear", "a failed execution costs more than a fee difference");
});

test("an operator-paused rail is never selected, however healthy it reports", () => {
  const health = new Map([
    ["paused", { railId: "paused", state: "healthy", observedAt: "x", operatorPaused: true, detail: "incident" }],
  ]);
  const { eligible, rejected } = eligibleRails({
    capabilities: [cap("paused", "stablecoin")],
    constraints: { amountAtomic: USDC(100), asset: "USDC", networkId: "arbitrum_one" },
    health,
  });
  assert.strictEqual(eligible.length, 0);
  assert.strictEqual(rejected[0].reason, "rail_paused");
});

test("every rejection carries a reason an operator can act on", () => {
  const { rejected } = eligibleRails({
    capabilities: [
      cap("wrong_asset", "stablecoin", { assets: ["DAI"] }),
      cap("wrong_network", "stablecoin", { networks: ["solana"] }),
      cap("too_small", "stablecoin", { minAmountAtomic: USDC(1000) }),
      cap("too_big", "stablecoin", { maxAmountAtomic: USDC(1) }),
      cap("wrong_country", "stablecoin", { countries: ["DE"] }),
      cap("weak_finality", "stablecoin", { finality: "revocable" }),
      cap("no_escrow", "stablecoin", { supportsDeferredSettlement: false }),
    ],
    constraints: {
      amountAtomic: USDC(100),
      asset: "USDC",
      networkId: "arbitrum_one",
      destinationCountry: "US",
      requiredFinality: "irreversible",
      requireEscrow: true,
    },
    health: new Map(),
  });
  const byRail = Object.fromEntries(rejected.map((r) => [r.railId, r.reason]));
  assert.strictEqual(byRail.wrong_asset, "asset_unsupported");
  assert.strictEqual(byRail.wrong_network, "network_unsupported");
  assert.strictEqual(byRail.too_small, "below_minimum");
  assert.strictEqual(byRail.too_big, "above_maximum");
  assert.strictEqual(byRail.wrong_country, "country_unsupported");
  assert.strictEqual(byRail.weak_finality, "finality_insufficient");
  assert.strictEqual(byRail.no_escrow, "escrow_required_unsupported");
  for (const r of rejected) assert.ok(r.detail && r.detail.length > 5, `${r.railId} explains itself`);
});

test("the score breakdown is reconstructible from its parts", () => {
  const s = scoreRoute({
    quote: quote("a", "1000"),
    worstFeeAtomic: "1000",
    slowestSeconds: 10,
    health: "healthy",
    preferenceIndex: 0,
    preferenceCount: 1,
  });
  const recomputed =
    s.healthScore * 4 + s.costScore * 3 + s.latencyScore * 2 + s.finalityScore * 2 + s.preferenceScore * 3;
  assert.strictEqual(s.total, recomputed, "an operator can reconstruct the score");
});

// ── Registry ─────────────────────────────────────────────────────────────

test("registering two rails under one id throws", () => {
  const reg = new RailRegistry();
  const rail = { capability: cap("dup", "stablecoin"), quote: async () => {}, authorize: async () => {}, execute: async () => {}, getStatus: async () => {} };
  reg.register(rail);
  assert.throws(() => reg.register(rail), /already registered/);
});

// ── The production-access gate ───────────────────────────────────────────

test("Visa is partner_required and can never be selected for live value", () => {
  const visa = RAIL_MATRIX.find((r) => r.railId === "visa_intelligent_commerce");
  assert.ok(visa, "the Visa row exists so the gap is visible");
  assert.strictEqual(visa.access, "partner_required");
  assert.strictEqual(selectableForLive(visa), false);
  assert.strictEqual(selectableForSandbox(visa), false);
  assert.deepStrictEqual(visa.verifiedBy, ["official_docs"], "documentation only — not an integration");
  assert.ok(visa.blocker && visa.blocker.length > 20, "the blocker names what is actually missing");
  assert.ok(visa.notAbstractable.length > 0, "what cannot be abstracted is stated");
});

test("Mastercard is partner_required and can never be selected for live value", () => {
  const mc = RAIL_MATRIX.find((r) => r.railId === "mastercard_agent_pay");
  assert.strictEqual(mc.access, "partner_required");
  assert.strictEqual(selectableForLive(mc), false);
  assert.deepStrictEqual(mc.verifiedBy, ["official_docs"]);
});

test("Cloudflare Wallets is not_implemented — there is nothing to integrate with yet", () => {
  const cf = RAIL_MATRIX.find((r) => r.railId === "cloudflare_wallets");
  assert.strictEqual(cf.access, "not_implemented");
  assert.strictEqual(selectableForLive(cf), false);
  assert.strictEqual(selectableForSandbox(cf), false);
  assert.match(cf.blocker, /does not yet let you send, receive, or hold funds/);
});

test("NO rail in the matrix is live — an empty live set is the honest answer today", () => {
  assert.deepStrictEqual(
    liveRails().map((r) => r.railId),
    [],
    "claiming a live rail requires observing a real settlement first"
  );
});

test("a partner_required rail is refused for the right reason, before capability matching", () => {
  // A rail we cannot use must not answer "asset_unsupported" — that invites a
  // retry with a different asset on a rail that was never available.
  const d = evaluateRailCapability(RAIL_MATRIX, {
    railId: "visa_intelligent_commerce",
    asset: "DOGE",
    networkId: "nonexistent",
    currency: "XYZ",
    amountAtomic: USDC(100),
    environment: "live",
    presentCredentials: [],
  });
  assert.strictEqual(d.eligible, false);
  assert.strictEqual(d.reason, "not_selectable_in_environment");
  assert.match(d.detail, /partner_required/);
});

test("a sandbox rail is eligible in sandbox and refused in live", () => {
  const q = {
    railId: "x402_usdc_arbitrum",
    asset: "USDC",
    networkId: "arbitrum_one",
    currency: "USD",
    amountAtomic: USDC(10),
    presentCredentials: ["FACILITATOR_EVM_ADDRESS", "FURLPAY_KMS_PROVIDER"],
  };
  assert.strictEqual(evaluateRailCapability(RAIL_MATRIX, { ...q, environment: "sandbox" }).eligible, true);
  const live = evaluateRailCapability(RAIL_MATRIX, { ...q, environment: "live" });
  assert.strictEqual(live.eligible, false);
  assert.strictEqual(live.reason, "not_selectable_in_environment");
});

test("missing credentials are named precisely rather than reported as generic ineligibility", () => {
  const d = evaluateRailCapability(RAIL_MATRIX, {
    railId: "x402_usdc_arbitrum",
    asset: "USDC",
    networkId: "arbitrum_one",
    currency: "USD",
    amountAtomic: USDC(10),
    environment: "sandbox",
    presentCredentials: [],
  });
  assert.strictEqual(d.eligible, false);
  assert.strictEqual(d.reason, "credentials_missing");
  assert.match(d.detail, /FACILITATOR_EVM_ADDRESS/);
  assert.match(d.detail, /FURLPAY_KMS_PROVIDER/);
});

test("an agent-initiated payment cannot use a rail with no native agent support", () => {
  const d = evaluateRailCapability(RAIL_MATRIX, {
    railId: "stablecoin_cctp",
    asset: "USDC",
    networkId: "arbitrum_one",
    currency: "USD",
    amountAtomic: USDC(10),
    environment: "sandbox",
    presentCredentials: ["FACILITATOR_EVM_ADDRESS"],
    requiresAgentSupport: true,
  });
  assert.strictEqual(d.eligible, false);
  assert.strictEqual(d.reason, "agent_support_required");
});

test("an unknown rail is refused, not defaulted", () => {
  const d = evaluateRailCapability(RAIL_MATRIX, {
    railId: "made_up_rail",
    asset: "USDC",
    networkId: "arbitrum_one",
    currency: "USD",
    amountAtomic: USDC(10),
    environment: "sandbox",
    presentCredentials: [],
  });
  assert.strictEqual(d.eligible, false);
  assert.strictEqual(d.reason, "rail_unknown");
});

test("every matrix row states its evidence, and a docs claim carries a URL", () => {
  for (const row of RAIL_MATRIX) {
    assert.ok(row.verifiedBy.length > 0, `${row.railId} states how it was verified`);
    if (row.verifiedBy.includes("official_docs")) {
      assert.ok(row.evidenceUrl, `${row.railId} claims official_docs so it must cite one`);
      assert.match(row.evidenceUrl, /^https:\/\//);
    }
    if (row.access !== "live") {
      assert.ok(row.blocker, `${row.railId} is not live so it must name its blocker`);
    }
  }
});

test("accessSummary partitions the matrix with no row lost", () => {
  const summary = accessSummary();
  const total = Object.values(summary).reduce((n, ids) => n + ids.length, 0);
  assert.strictEqual(total, RAIL_MATRIX.length);
  assert.deepStrictEqual(summary.live, []);
  assert.ok(summary.partner_required.includes("visa_intelligent_commerce"));
  assert.ok(summary.partner_required.includes("mastercard_agent_pay"));
  assert.ok(summary.not_implemented.includes("cloudflare_wallets"));
  assert.ok(summary.regulatory_required.includes("bank_ach"));
});
