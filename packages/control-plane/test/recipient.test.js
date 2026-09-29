"use strict";
// ---------------------------------------------------------------------------
// Recipient verification — the last deterministic check before value leaves.
//
// Each test is one of the five ways money reaches the wrong place while every
// other control passes: wrong chain, address substitution, address poisoning,
// stale invoice, cart/payment mismatch.
//
// THE RULE UNDER TEST: an address is trusted because it was ATTESTED FOR THAT
// NETWORK — never because it was well-formed, and never because it arrived
// alongside an approved domain.
// ---------------------------------------------------------------------------
const test = require("node:test");
const assert = require("node:assert");
const {
  verifyRecipient,
  evmAddressValidator,
  networkSpec,
  looksLikePoisoning,
  cartTotalAtomic,
  NETWORKS,
} = require("../dist/index.js");

const NOW = Date.parse("2026-09-28T12:00:00Z");
const USDC = (m) => String(Math.round(m * 1e6));
const ADDR = "0x388C818CA8B9251b393131C08a73683246A16633";
const OTHER = "0x1111111111111111111111111111111111111111";

function record(overrides = {}) {
  return {
    recipientId: "rcpt_1",
    organizationId: "org_1",
    displayName: "DeepSeek API",
    verifiedDomain: "deepseek.com",
    status: "ACTIVE",
    destinations: [
      {
        networkId: "arbitrum_one",
        asset: "USDC",
        address: ADDR,
        method: "domain_signature",
        attestedAt: "2026-09-01T00:00:00Z",
      },
    ],
    firstSeenAt: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

function verify(overrides = {}) {
  return verifyRecipient({
    assertion: {
      domain: "api.deepseek.com",
      destination: ADDR,
      networkId: "arbitrum_one",
      asset: "USDC",
      ...(overrides.assertion ?? {}),
    },
    record: overrides.record === null ? null : record(overrides.record),
    invoice: overrides.invoice,
    amountAtomic: overrides.amountAtomic ?? USDC(28.5),
    validators: overrides.validators ?? [evmAddressValidator],
    nowMs: overrides.nowMs ?? NOW,
    requireMainnet: overrides.requireMainnet ?? true,
    seenBefore: overrides.seenBefore ?? true,
  });
}

test("an attested destination on the right network verifies", () => {
  const v = verify();
  assert.strictEqual(v.ok, true);
  assert.strictEqual(v.canonicalDestination, ADDR.toLowerCase());
  assert.strictEqual(v.attestation.method, "domain_signature");
});

// ── 1. Wrong chain ────────────────────────────────────────────────────────

test("WRONG CHAIN: an address attested on Ethereum is refused on Arbitrum", () => {
  // The same 20 bytes exist on every EVM chain, so nothing about the string is
  // wrong. The funds would land at an address the recipient may not control.
  const v = verify({
    record: {
      destinations: [
        { networkId: "ethereum", asset: "USDC", address: ADDR, method: "domain_signature", attestedAt: "x" },
      ],
    },
  });
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.reason, "destination_attested_on_other_network");
  assert.match(v.detail, /ethereum/);
  assert.match(v.detail, /wrong chain/);
});

test("an unregistered network is refused rather than passed through unvalidated", () => {
  const v = verify({ assertion: { networkId: "some_new_chain" } });
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.reason, "network_unknown");
});

test("a testnet is refused when the environment requires mainnet", () => {
  const v = verify({
    assertion: { networkId: "base_sepolia" },
    record: { destinations: [{ networkId: "base_sepolia", asset: "USDC", address: ADDR, method: "domain_signature", attestedAt: "x" }] },
    requireMainnet: true,
  });
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.reason, "network_not_mainnet");
});

test("the network registry knows the family and chain id of every entry", () => {
  assert.strictEqual(networkSpec("arbitrum_one").chainId, 42161);
  assert.strictEqual(networkSpec("arbitrum_one").family, "evm");
  assert.strictEqual(networkSpec("solana").family, "solana");
  assert.strictEqual(networkSpec("nope"), null);
  for (const [id, spec] of Object.entries(NETWORKS)) {
    assert.strictEqual(spec.networkId, id, "the key and the id agree");
    assert.ok(spec.family, `${id} declares an address family`);
    assert.strictEqual(typeof spec.mainnet, "boolean");
  }
});

// ── 2. Address substitution ───────────────────────────────────────────────

test("SUBSTITUTION: a well-formed address that was never attested is refused", () => {
  // The domain allowlist passed, because the DOMAIN is approved. The address
  // came from the request body.
  const v = verify({ assertion: { destination: OTHER } });
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.reason, "destination_not_attested");
});

test("no recipient record means refusal — a request-supplied address is never trusted alone", () => {
  const v = verify({ record: null });
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.reason, "recipient_unknown");
  assert.match(v.detail, /attacker-controlled/);
});

test("a malformed address is refused", () => {
  assert.strictEqual(verify({ assertion: { destination: "0xnothex" } }).reason, "address_malformed");
  assert.strictEqual(verify({ assertion: { destination: "" } }).reason, "address_malformed");
  assert.strictEqual(verify({ assertion: { destination: ADDR + "00" } }).reason, "address_malformed");
});

test("an address family with NO validator is refused, not waved through", () => {
  const v = verify({
    assertion: { networkId: "solana", destination: "SoLaNaAddress11111111111111111111111111111" },
    record: { destinations: [{ networkId: "solana", asset: "USDC", address: "x", method: "domain_signature", attestedAt: "x" }] },
    validators: [evmAddressValidator],
  });
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.reason, "no_validator_for_family");
});

test("address comparison is case-insensitive so two spellings of one address match", () => {
  const v = verify({ assertion: { destination: ADDR.toUpperCase().replace("0X", "0x") } });
  assert.strictEqual(v.ok, true, "EIP-55 case differences are the same address");
});

test("a blocked or pending recipient is refused with its own reason", () => {
  assert.strictEqual(verify({ record: { status: "BLOCKED" } }).reason, "recipient_blocked");
  assert.strictEqual(verify({ record: { status: "PENDING" } }).reason, "recipient_pending");
});

test("an expired attestation is refused", () => {
  const v = verify({
    record: {
      destinations: [
        { networkId: "arbitrum_one", asset: "USDC", address: ADDR, method: "domain_signature", attestedAt: "x", expiresAt: "2026-09-01T00:00:00Z" },
      ],
    },
  });
  assert.strictEqual(v.reason, "attestation_expired");
});

test("an asset the destination was not attested for is refused", () => {
  const v = verify({ assertion: { asset: "USDT" } });
  assert.strictEqual(v.reason, "asset_not_attested");
});

// ── Domain spoofing ──────────────────────────────────────────────────────

test("the claimed domain is checked against the VERIFIED domain, not itself", () => {
  const v = verify({ assertion: { domain: "evil.com" } });
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.reason, "domain_mismatch");
});

test("a subdomain of the verified domain is accepted; a lookalike is not", () => {
  assert.strictEqual(verify({ assertion: { domain: "api.deepseek.com" } }).ok, true);
  assert.strictEqual(verify({ assertion: { domain: "deepseek.com" } }).ok, true);
  assert.strictEqual(verify({ assertion: { domain: "deepseek.com.evil.io" } }).reason, "domain_mismatch");
  assert.strictEqual(verify({ assertion: { domain: "notdeepseek.com" } }).reason, "domain_mismatch");
});

test("a recipient with no verified domain cannot satisfy a domain claim", () => {
  const v = verify({ record: { verifiedDomain: undefined } });
  assert.strictEqual(v.reason, "domain_mismatch");
  assert.match(v.detail, /unset/);
});

// ── 3. Address poisoning (a signal, not a denial) ────────────────────────

test("POISONING: a lookalike address sharing 4+4 characters is detectable", () => {
  const real = "0xabcd000000000000000000000000000000001234";
  const fake = "0xabcdffffffffffffffffffffffffffffff001234";
  assert.strictEqual(looksLikePoisoning(real, fake), true);
  assert.strictEqual(looksLikePoisoning(real, real), false, "identical is not poisoning");
  assert.strictEqual(looksLikePoisoning(real, OTHER), false);
  assert.strictEqual(looksLikePoisoning("0xab", "0xcd"), false, "too short to judge");
});

// ── 4 & 5. Invoice and cart binding ─────────────────────────────────────

const invoice = (o = {}) => ({
  invoiceId: "inv_1",
  cartHash: "sha256:4d8a1c9e83",
  amountAtomic: USDC(28.5),
  asset: "USDC",
  expiresAt: "2026-09-28T12:05:00Z",
  ...o,
});

test("a matching invoice verifies", () => {
  assert.strictEqual(verify({ invoice: invoice() }).ok, true);
});

test("STALE INVOICE: an expired invoice is refused", () => {
  const v = verify({ invoice: invoice({ expiresAt: "2026-09-28T11:00:00Z" }) });
  assert.strictEqual(v.reason, "invoice_expired");
});

test("REPLAY: an already-settled invoice is refused", () => {
  const v = verify({ invoice: invoice({ settledPaymentId: "pay_earlier" }) });
  assert.strictEqual(v.reason, "invoice_already_settled");
  assert.match(v.detail, /pay_earlier/);
});

test("CART MISMATCH: a payment for more than the invoice is refused EXACTLY", () => {
  // The human approved $342. The payment carries $3,420.
  const v = verify({ invoice: invoice({ amountAtomic: USDC(342) }), amountAtomic: USDC(3420) });
  assert.strictEqual(v.reason, "invoice_amount_mismatch");
});

test("there is NO tolerance on the invoice amount, not even one minor unit", () => {
  // A tolerance here is a tolerance on how much more than the approved amount
  // may be taken, and there is no correct non-zero value.
  const over = verify({ invoice: invoice({ amountAtomic: "28500000" }), amountAtomic: "28500001" });
  assert.strictEqual(over.reason, "invoice_amount_mismatch");
  const under = verify({ invoice: invoice({ amountAtomic: "28500000" }), amountAtomic: "28499999" });
  assert.strictEqual(under.reason, "invoice_amount_mismatch");
});

test("an invoice with no cart hash is refused — the approval would be unbound", () => {
  const v = verify({ invoice: invoice({ cartHash: "" }) });
  assert.strictEqual(v.reason, "cart_hash_missing");
});

test("an invoice in a different asset is refused", () => {
  const v = verify({ invoice: invoice({ asset: "EURC" }) });
  assert.strictEqual(v.reason, "invoice_asset_mismatch");
});

test("a non-integer amount on either side is refused rather than coerced", () => {
  const v = verify({ invoice: invoice({ amountAtomic: "28.5" }) });
  assert.strictEqual(v.reason, "invoice_amount_mismatch");
});

test("cartTotalAtomic sums line items in integers", () => {
  assert.strictEqual(cartTotalAtomic([{ amountAtomic: "100" }, { amountAtomic: "250" }]), "350");
  assert.strictEqual(cartTotalAtomic([]), "0");
  assert.throws(() => cartTotalAtomic([{ amountAtomic: "1.5" }]));
});

// ── Ordering and first-use reporting ────────────────────────────────────

test("an unattested address is reported BEFORE an amount mismatch", () => {
  // An operator reading the denial needs the more serious incident named.
  const v = verify({
    assertion: { destination: OTHER },
    invoice: invoice({ amountAtomic: USDC(999) }),
  });
  assert.strictEqual(v.reason, "destination_not_attested");
});

test("first use is reported on both success and failure", () => {
  assert.strictEqual(verify({ seenBefore: false }).firstUse, true);
  assert.strictEqual(verify({ seenBefore: true }).firstUse, false);
  assert.strictEqual(verify({ record: null, seenBefore: false }).firstUse, true);
});
