import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Gateway, MemoryClaimStore, canonicalNonce } from "../dist/index.js";

// ---------------------------------------------------------------------------
// One authorization, one replay key.
//
// The replay claim was keyed on the nonce STRING. The same 32 bytes can be
// written "0xAB..", "0xab.." or "ab..", so a payment replayed against a fresh
// quote with its nonce re-spelled took a key nobody had burned. These tests
// present each spelling against a NEW quote (so the per-quote claim is not what
// stops it) and assert the nonce claim does.
// ---------------------------------------------------------------------------

const SECRET = "test_secret_at_least_16_chars_long";
const PAY_TO = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";
const PAYER = "0xAbC0000000000000000000000000000000000001";
const SIG = "0x" + "ab".repeat(65);
const URL_ = "https://api.dev/weather";

function makeGateway() {
  return new Gateway({
    price: () => 0.01,
    payTo: PAY_TO,
    quoteSecret: SECRET,
    network: "base",
    claimStore: new MemoryClaimStore(),
    facilitator: {
      async verify() {
        return { isValid: true, payer: PAYER };
      },
      async settle(req) {
        return { success: true, transaction: "0x" + "de".repeat(32), network: req.paymentRequirements.network, payer: PAYER, confirmations: 12 };
      },
      async supported() {
        return [];
      },
    },
  });
}

const GET = (headers = {}) => ({ method: "GET", url: URL_, headers });
const now = () => Math.floor(Date.now() / 1000);

/** Get a fresh quote and pay it with the given authorization fields. */
async function pay(gw, auth) {
  const req = (await gw.authorize(GET())).body.accepts[0];
  const payload = {
    x402Version: 1,
    scheme: "exact",
    network: req.network,
    payload: {
      signature: SIG,
      authorization: {
        from: PAYER,
        to: PAY_TO,
        value: req.maxAmountRequired,
        validAfter: "0",
        validBefore: String(now() + 600),
        ...auth,
      },
    },
    extra: req.extra,
  };
  return gw.authorize(GET({ "x-payment": Buffer.from(JSON.stringify(payload)).toString("base64") }));
}

test("canonicalNonce reduces every EVM spelling to one string", () => {
  const hex = crypto.randomBytes(32).toString("hex");
  const want = "0x" + hex;
  for (const spelling of [hex, "0x" + hex, "0X" + hex, hex.toUpperCase(), "0x" + hex.toUpperCase()]) {
    assert.equal(canonicalNonce("base", spelling), want);
  }
});

test("canonicalNonce refuses anything that is not exactly 32 bytes of hex", () => {
  for (const bad of ["", "0x", "0x" + "ab".repeat(31), "0x" + "ab".repeat(33), "0x" + "zz".repeat(32), " 0x" + "ab".repeat(32), "0x" + "ab".repeat(32) + "\n"]) {
    assert.equal(canonicalNonce("base", bad), null);
  }
});

test("a nonce replayed in a different spelling is refused, on a fresh quote", async () => {
  const hex = crypto.randomBytes(32).toString("hex");
  const spellings = ["0x" + hex, hex, "0x" + hex.toUpperCase(), "0X" + hex, hex.toUpperCase()];
  for (const first of spellings) {
    const gw = makeGateway();
    assert.equal((await pay(gw, { nonce: first })).kind, "allow");
    for (const again of spellings) {
      const d = await pay(gw, { nonce: again });
      assert.equal(d.kind, "challenge", `${first} then ${again}`);
      assert.match(d.body.error, /already used|replay/i);
    }
  }
});

test("concurrent spellings of one nonce yield exactly one grant", async () => {
  const gw = makeGateway();
  const hex = crypto.randomBytes(32).toString("hex");
  const results = await Promise.all(
    ["0x" + hex, hex, "0x" + hex.toUpperCase(), "0X" + hex, hex.toUpperCase()].map((nonce) => pay(gw, { nonce }))
  );
  assert.equal(results.filter((r) => r.kind === "allow").length, 1);
});

test("a malformed nonce is refused before anything is claimed or settled", async () => {
  const gw = makeGateway();
  for (const nonce of ["0x" + "ab".repeat(31), "not-a-nonce", "0x" + "ab".repeat(40)]) {
    const d = await pay(gw, { nonce });
    assert.equal(d.kind, "challenge");
    assert.match(d.body.error, /malformed authorization nonce/i);
  }
});

test("a validity window that is not a plain integer is refused", async () => {
  const gw = makeGateway();
  const nonce = () => crypto.randomBytes(32).toString("hex");
  for (const auth of [{ validBefore: "abc" }, { validBefore: "1e99" }, { validAfter: "-1" }, { validBefore: "" + (now() + 600) + ".5" }]) {
    const d = await pay(gw, { nonce: nonce(), ...auth });
    assert.equal(d.kind, "challenge");
    assert.match(d.body.error, /validity window|malformed/i);
  }
});

test("an authorization that outlives the replay memory is refused", async () => {
  const gw = makeGateway();
  const d = await pay(gw, { nonce: crypto.randomBytes(32).toString("hex"), validBefore: String(now() + 7 * 86_400) });
  assert.equal(d.kind, "challenge");
  assert.match(d.body.error, /too long/i);
});
