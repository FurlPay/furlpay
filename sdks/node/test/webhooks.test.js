"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { webhooks } = require("../dist/webhooks.js");
const { Furlpay, FurlpayError } = require("../dist/index.js");

test("sign + constructEvent roundtrip", () => {
  const body = JSON.stringify({ id: "evt_1", type: "deposit.settled", created: 1, data: {} });
  const sig = webhooks.sign(body, "whsec_test");
  const event = webhooks.constructEvent(body, sig, "whsec_test");
  assert.strictEqual(event.type, "deposit.settled");
});

test("rejects tampered body", () => {
  const body = JSON.stringify({ type: "a" });
  const sig = webhooks.sign(body, "whsec_test");
  assert.throws(() => webhooks.constructEvent(JSON.stringify({ type: "b" }), sig, "whsec_test"));
});

test("rejects wrong secret", () => {
  const body = JSON.stringify({ type: "a" });
  const sig = webhooks.sign(body, "whsec_test");
  assert.throws(() => webhooks.constructEvent(body, sig, "whsec_other"));
});

test("rejects missing header", () => {
  assert.throws(() => webhooks.constructEvent("{}", undefined, "s"));
});

test("client requires apiKey", () => {
  assert.throws(() => new Furlpay({ apiKey: "" }));
});

test("FurlpayError carries status", () => {
  const e = new FurlpayError("nope", 403, { error: "nope" });
  assert.strictEqual(e.statusCode, 403);
});
