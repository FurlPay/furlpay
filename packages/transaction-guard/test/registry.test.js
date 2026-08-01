import { test } from "node:test";
import assert from "node:assert/strict";
import { ActionRegistry } from "../dist/index.js";

// ---------------------------------------------------------------------------
// The action allowlist — the boundary between "a model proposed X" and
// "X executes".
// ---------------------------------------------------------------------------

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const RECIPIENT = "0x1111111111111111111111111111111111111111";

const registry = new ActionRegistry(
  [
    {
      id: "send_payment",
      title: "Send payment",
      endpoint: "/payments/create",
      fields: {
        amount: { type: "number", label: "Amount", currency: true, min: 0.01, max: 25000 },
        recipient: { type: "string", label: "To", pattern: EVM_ADDRESS },
        chain: { type: "string", label: "Chain", oneOf: ["arbitrum", "base"] },
        note: { type: "string", optional: true },
      },
    },
    {
      id: "execute_swap",
      title: "Swap",
      endpoint: "/swaps",
      fields: {
        quoteId: { type: "string", pattern: /^[0-9a-f-]{36}$/ },
      },
      // The discriminator that decides whether money moves.
      constants: { execute: true },
    },
    {
      id: "retired",
      title: "Retired action",
      endpoint: "/retired",
      enabled: false,
      fields: {},
    },
  ],
  { maxAmount: 25000 }
);

const valid = {
  action: "send_payment",
  endpoint: "/payments/create",
  body: { amount: 10, recipient: RECIPIENT, chain: "arbitrum" },
};

const reasonOf = (proposal) => {
  try {
    registry.resolve(proposal);
  } catch (e) {
    return e.reason;
  }
  throw new Error("expected a rejection");
};

test("rebuilds a valid proposal from the registry", () => {
  const resolved = registry.resolve(valid);
  assert.equal(resolved.endpoint, "/payments/create");
  assert.equal(resolved.method, "POST");
  assert.equal(resolved.body.amount, 10);
  assert.equal(resolved.amount, 10, "the currency field is surfaced for confirmation");
  assert.equal(resolved.details.length, 3, "note has no label, so no detail row");
});

test("drops fields the model invented — they never reach the wire", () => {
  const resolved = registry.resolve({
    ...valid,
    body: {
      ...valid.body,
      destinationOverride: "0xattacker",
      bypassLimits: true,
      __proto__: { polluted: true },
    },
  });
  assert.deepEqual(Object.keys(resolved.body).sort(), ["amount", "chain", "recipient"]);
});

test("rejects an unknown or absent action id", () => {
  assert.equal(reasonOf({ ...valid, action: "drain_wallet" }), "unknown_action");
  assert.equal(reasonOf({ ...valid, action: undefined }), "unknown_action");
});

test("never infers a spec from the proposed endpoint", () => {
  // A valid id paired with an endpoint of the model's choosing.
  assert.equal(reasonOf({ ...valid, endpoint: "/admin/withdraw" }), "endpoint_mismatch");
});

test("tolerates an /api prefix and a trailing slash, but trusts neither", () => {
  for (const endpoint of ["/api/payments/create", "payments/create", "/payments/create/"]) {
    assert.doesNotThrow(() => registry.resolve({ ...valid, endpoint }), endpoint);
  }
});

test("rejects a method that disagrees with the spec", () => {
  assert.equal(reasonOf({ ...valid, method: "DELETE" }), "method_mismatch");
});

test("rejects a disabled action even when well-formed", () => {
  assert.equal(
    reasonOf({ action: "retired", endpoint: "/retired", body: {} }),
    "action_disabled"
  );
});

test("rejects a malformed body rather than treating it as empty", () => {
  for (const body of [null, undefined, "string", [1, 2]]) {
    assert.equal(reasonOf({ ...valid, body }), "malformed_body", String(body));
  }
});

test("enforces patterns — an arbitrary string is not a recipient", () => {
  // Without a pattern this passes as a "string" and becomes a payment to
  // nothing. This is the constraint that went missing in a real port.
  for (const recipient of ["alice", "0xshort", "", "0x" + "z".repeat(40)]) {
    assert.equal(
      reasonOf({ ...valid, body: { ...valid.body, recipient } }),
      "invalid_field",
      recipient
    );
  }
});

test("enforces enums exactly, without case-folding", () => {
  assert.equal(reasonOf({ ...valid, body: { ...valid.body, chain: "solana" } }), "invalid_field");
  // Forwarding a differently-cased value than the one compared would send
  // something the server's own enum rejects.
  assert.equal(reasonOf({ ...valid, body: { ...valid.body, chain: "Arbitrum" } }), "invalid_field");
});

test("enforces bounds, including the registry-wide ceiling", () => {
  assert.equal(
    reasonOf({ ...valid, body: { ...valid.body, amount: 0.001 } }),
    "amount_out_of_range"
  );
  assert.equal(
    reasonOf({ ...valid, body: { ...valid.body, amount: 1e9 } }),
    "amount_out_of_range"
  );
  assert.equal(
    reasonOf({ ...valid, body: { ...valid.body, amount: Infinity } }),
    "invalid_field"
  );
});

test("does not coerce types", () => {
  // A quoted number is the wrong type, not a number to parse. Coercion is how
  // "1e9" becomes a billion.
  assert.equal(reasonOf({ ...valid, body: { ...valid.body, amount: "10" } }), "invalid_field");
  assert.equal(reasonOf({ ...valid, body: { ...valid.body, recipient: 42 } }), "invalid_field");
});

test("requires declared fields and allows optional ones to be absent", () => {
  const { recipient, ...withoutRecipient } = valid.body;
  assert.equal(reasonOf({ ...valid, body: withoutRecipient }), "missing_field");
  // `note` is optional.
  assert.doesNotThrow(() => registry.resolve(valid));
});

test("sets constants the proposal cannot override", () => {
  const quoteId = "3f1a2b4c-5d6e-4f70-8a91-b2c3d4e5f607";
  const settle = registry.resolve({ action: "execute_swap", endpoint: "/swaps", body: { quoteId } });
  assert.equal(settle.body.execute, true);

  // A model asking for the other branch of the same route.
  const spoof = registry.resolve({
    action: "execute_swap",
    endpoint: "/swaps",
    body: { quoteId, execute: false },
  });
  assert.equal(spoof.body.execute, true, "constants win");
});

test("anchors patterns so a partial match cannot pass", () => {
  const loose = new ActionRegistry([
    { id: "a", title: "A", endpoint: "/a", fields: { code: { type: "string", pattern: /[a-z]+/ } } },
  ]);
  assert.doesNotThrow(() => loose.resolve({ action: "a", endpoint: "/a", body: { code: "abc" } }));
  // Unanchored /[a-z]+/ would match the "abc" inside this and let it through.
  assert.throws(() => loose.resolve({ action: "a", endpoint: "/a", body: { code: "abc123" } }));
});

test("formats currency details through the supplied formatter", () => {
  const custom = new ActionRegistry(
    [
      {
        id: "pay",
        title: "Pay",
        endpoint: "/pay",
        fields: { amount: { type: "number", label: "Amount", currency: true } },
      },
    ],
    { formatAmount: (n) => `$${n.toFixed(2)}` }
  );
  const resolved = custom.resolve({ action: "pay", endpoint: "/pay", body: { amount: 12.5 } });
  assert.equal(resolved.details[0].value, "$12.50");
});
