import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateKeypair,
  signMandate,
  authorizeCart,
  toX402Settlement,
  memoryNonceStore,
  Ap2Error,
  type IntentMandate,
  type CartMandate,
} from "./index.js";

async function fixtures(overrides: { maxAmount?: number; total?: number; merchant?: string } = {}) {
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
      expiresAt: Date.now() + 60_000,
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
    items: [{ name: "Widget", amount: total, quantity: 1 }],
    total,
    currency: "USDC",
    createdAt: Date.now(),
    nonce: "n_cart_1",
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
