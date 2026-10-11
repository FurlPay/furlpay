import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateKeypair,
  signMandate,
  authorizeCart,
  toX402Settlement,
  memoryNonceStore,
  toAtomicUnits,
  Ap2Error,
  type IntentMandate,
  type CartMandate,
  type NonceStore,
} from "./index.js";

async function fixtures(
  overrides: {
    maxAmount?: number;
    total?: number;
    merchant?: string;
    items?: CartMandate["items"];
    cartNonce?: string;
    expiresAt?: number;
  } = {},
) {
  const user = await generateKeypair();
  const merchant = await generateKeypair();

  const intent: IntentMandate = {
    type: "IntentMandate",
    id: "im_1",
    user: "did:furlpay:user1",
    agent: "did:furlpay:agent1",
    constraints: {
      maxAmount: overrides.maxAmount ?? 500,
      currency: "USDC",
      merchants: ["shop.example"],
      expiresAt: overrides.expiresAt ?? Date.now() + 60_000,
      singleUse: true,
    },
    issuedAt: Date.now(),
    nonce: "n_intent_1",
  };
  const total = overrides.total ?? 120;
  const cart: CartMandate = {
    type: "CartMandate",
    id: "cm_1",
    intentMandateId: "im_1",
    merchant: overrides.merchant ?? "shop.example",
    items: overrides.items ?? [{ name: "Widget", amount: total, quantity: 1 }],
    total,
    currency: "USDC",
    createdAt: Date.now(),
    nonce: overrides.cartNonce ?? "n_cart_1",
  };

  return {
    userPublicKey: user.publicKey,
    cartSignerPublicKey: merchant.publicKey,
    signedIntent: await signMandate(intent, user.privateKey, "user-key"),
    signedCart: await signMandate(cart, merchant.privateKey, "merchant-key"),
  };
}

test("authorizes a valid cart and bridges to x402", async () => {
  const f = await fixtures();
  const authorized = await authorizeCart({
    cart: f.signedCart,
    intent: f.signedIntent,
    userPublicKey: f.userPublicKey,
    cartSignerPublicKey: f.cartSignerPublicKey,
    nonceStore: memoryNonceStore(),
  });
  assert.equal(authorized.amount, 120);
  const settlement = toX402Settlement(authorized, { payTo: "0xabc" });
  assert.equal(settlement.maxAmountRequired, "120000000"); // 120 * 1e6
  assert.equal(settlement.extra.ap2CartId, "cm_1");
});

test("rejects a cart over the intent limit", async () => {
  const f = await fixtures({ maxAmount: 100, total: 250 });
  await assert.rejects(
    authorizeCart({
      cart: f.signedCart,
      intent: f.signedIntent,
      userPublicKey: f.userPublicKey,
      cartSignerPublicKey: f.cartSignerPublicKey,
    }),
    (e) => e instanceof Ap2Error && e.code === "over_limit",
  );
});

test("rejects a merchant not on the allowlist", async () => {
  const f = await fixtures({ merchant: "evil.example" });
  await assert.rejects(
    authorizeCart({
      cart: f.signedCart,
      intent: f.signedIntent,
      userPublicKey: f.userPublicKey,
      cartSignerPublicKey: f.cartSignerPublicKey,
    }),
    (e) => e instanceof Ap2Error && e.code === "merchant_not_allowed",
  );
});

test("rejects a replayed cart nonce", async () => {
  const f = await fixtures();
  const store = memoryNonceStore();
  const args = {
    cart: f.signedCart,
    intent: f.signedIntent,
    userPublicKey: f.userPublicKey,
    cartSignerPublicKey: f.cartSignerPublicKey,
    nonceStore: store,
  };
  await authorizeCart(args);
  await assert.rejects(authorizeCart(args), (e) => e instanceof Ap2Error && e.code === "replayed");
});

// ---- F-13: replay across instances, F-14: exact amounts --------------------

const argsOf = (f: Awaited<ReturnType<typeof fixtures>>, extra: Record<string, unknown> = {}) => ({
  cart: f.signedCart,
  intent: f.signedIntent,
  userPublicKey: f.userPublicKey,
  cartSignerPublicKey: f.cartSignerPublicKey,
  ...extra,
});

/** Two "instances" sharing one backing map, as two lambdas share one Redis.
 *  Each instance only ever calls claim(); has/add would be per-instance. */
function sharedClaimStores() {
  const shared = new Map<string, number>();
  const make = (): NonceStore => {
    const local = new Set<string>();
    return {
      has: (n) => local.has(n),
      add: (n) => void local.add(n),
      claim: async (kind, n, expiresAt) => {
        await new Promise((r) => setImmediate(r)); // a network hop
        const key = `${kind}:${n}`;
        if (shared.has(key)) return false;
        shared.set(key, expiresAt);
        return true;
      },
    };
  };
  return { a: make(), b: make(), shared };
}

test("F-13: a single-use mandate is refused on a second instance that shares the claim store", async () => {
  const f = await fixtures();
  const { a, b } = sharedClaimStores();
  await authorizeCart(argsOf(f, { nonceStore: a }));
  await assert.rejects(authorizeCart(argsOf(f, { nonceStore: b })), (e) => e instanceof Ap2Error && e.code === "replayed");
});

test("F-13: concurrent presentations of one mandate authorize exactly once", async () => {
  const f = await fixtures();
  const { a, b } = sharedClaimStores();
  const results = await Promise.allSettled(
    Array.from({ length: 10 }, (_, i) => authorizeCart(argsOf(f, { nonceStore: i % 2 ? a : b }))),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
});

test("F-13: the old per-instance has/add store is what let the replay through", async () => {
  // Documents the vulnerable shape: two separate memory stores, no shared claim.
  const f = await fixtures();
  const legacy = (): NonceStore => {
    const s = new Set<string>();
    return { has: (n) => s.has(n), add: (n) => void s.add(n) };
  };
  await authorizeCart(argsOf(f, { nonceStore: legacy() }));
  await authorizeCart(argsOf(f, { nonceStore: legacy() })); // accepted: per-instance memory
});

test("F-13: a refused cart does not consume its nonce", async () => {
  const over = await fixtures({ maxAmount: 100, total: 250 });
  const { a, shared } = sharedClaimStores();
  await assert.rejects(authorizeCart(argsOf(over, { nonceStore: a })), (e) => e instanceof Ap2Error && e.code === "over_limit");
  assert.equal(shared.size, 0);
});

test("F-13: the claim is kept until the intent expires", async () => {
  const expiresAt = Date.now() + 120_000;
  const f = await fixtures({ expiresAt });
  const { a, shared } = sharedClaimStores();
  await authorizeCart(argsOf(f, { nonceStore: a }));
  assert.equal(shared.get("cart:n_cart_1"), expiresAt);
  assert.equal(shared.get("intent:n_intent_1"), expiresAt);
});

test("F-13: an intent valid for longer than the verifier's retention is refused", async () => {
  const f = await fixtures({ expiresAt: Date.now() + 40 * 86_400_000 });
  await assert.rejects(
    authorizeCart(argsOf(f, { maxValidityMs: 30 * 86_400_000 })),
    (e) => e instanceof Ap2Error && e.code === "validity_too_long",
  );
});

test("F-13: a cart without a well-formed nonce is refused", async () => {
  const f = await fixtures({ cartNonce: "x" });
  await assert.rejects(authorizeCart(argsOf(f)), (e) => e instanceof Ap2Error && e.code === "invalid_nonce");
});

test("F-14: line items 0.1 + 0.2 equal a total of 0.3 exactly", async () => {
  const f = await fixtures({
    total: 0.3,
    items: [
      { name: "a", amount: 0.1, quantity: 1 },
      { name: "b", amount: 0.2, quantity: 1 },
    ],
  });
  const ok = await authorizeCart(argsOf(f));
  assert.equal(toX402Settlement(ok, { payTo: "0x" + "1".repeat(40) }).maxAmountRequired, "300000");
});

test("F-14: a total one atomic unit over the limit is refused (no epsilon)", async () => {
  const f = await fixtures({ maxAmount: 100, total: 100.000001 });
  await assert.rejects(authorizeCart(argsOf(f)), (e) => e instanceof Ap2Error && e.code === "over_limit");
});

test("F-14: a total half a cent above its own line items is refused", async () => {
  const f = await fixtures({ total: 10.005, items: [{ name: "a", amount: 10, quantity: 1 }] });
  await assert.rejects(authorizeCart(argsOf(f)), (e) => e instanceof Ap2Error && e.code === "total_mismatch");
});

test("F-14: amounts finer than six decimal places are refused, not rounded", async () => {
  assert.throws(() => toAtomicUnits(1.0000005), (e) => e instanceof Ap2Error && e.code === "invalid_amount");
  assert.equal(toAtomicUnits(1.000001), 1_000_001n);
  assert.equal(toAtomicUnits(0), 0n);
});

test("F-14: negative, non-finite and out-of-range amounts are refused", async () => {
  for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, 1e12, "5"]) {
    assert.throws(() => toAtomicUnits(bad), (e) => e instanceof Ap2Error && e.code === "invalid_amount");
  }
});

test("F-14: a negative line item cannot offset another", async () => {
  const f = await fixtures({
    total: 10,
    items: [
      { name: "a", amount: 20, quantity: 1 },
      { name: "refund?", amount: -10, quantity: 1 },
    ],
  });
  await assert.rejects(authorizeCart(argsOf(f)), (e) => e instanceof Ap2Error && e.code === "invalid_amount");
});

test("F-14: a zero-total cart is refused", async () => {
  const f = await fixtures({ total: 0, items: [{ name: "free", amount: 0, quantity: 1 }] });
  await assert.rejects(authorizeCart(argsOf(f)), (e) => e instanceof Ap2Error && e.code === "invalid_amount");
});
