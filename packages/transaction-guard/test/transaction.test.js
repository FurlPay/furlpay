import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertSignable,
  assertFeesSane,
  maximumCostWei,
  parseAtomic,
  parseQuantity,
  selectorOf,
  isHexData,
  hasCalldata,
  isQuantity,
  confirmationsFor,
  isBoundToChain,
} from "../dist/index.js";

const ROUTER = "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae";
const TOKEN = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";
const ARBITRUM = 42161;

function plan(overrides = {}) {
  const { transactionRequest, ...rest } = overrides;
  return {
    approvalAddress: ROUTER,
    fromTokenAddress: TOKEN,
    fromAmountAtomic: "1000000",
    expiresAt: new Date(Date.now() + 120_000).toISOString(),
    transactionRequest: {
      to: ROUTER,
      data: "0xdeadbeef",
      value: "0x0",
      chainId: ARBITRUM,
      gasLimit: "0x5208",
      ...transactionRequest,
    },
    ...rest,
  };
}

const reasonOf = (fn) => {
  try {
    fn();
  } catch (e) {
    return e.reason;
  }
  throw new Error("expected a rejection");
};

test("accepts a well-formed plan", () => {
  assert.doesNotThrow(() => assertSignable(plan(), ARBITRUM));
});

test("refuses a plan built for a different chain", () => {
  // The single most dangerous case. The same address exists on every EVM
  // chain, so this signature would be valid — on the wrong network, against
  // whatever balance the user holds there. Nothing downstream catches it.
  const wrongChain = plan({ transactionRequest: { chainId: 8453 } });
  assert.equal(reasonOf(() => assertSignable(wrongChain, ARBITRUM)), "chain_mismatch");
});

test("refuses a nonsense expected chain id", () => {
  assert.equal(reasonOf(() => assertSignable(plan(), 0)), "unsupported_chain");
  assert.equal(reasonOf(() => assertSignable(plan(), -1)), "unsupported_chain");
  assert.equal(reasonOf(() => assertSignable(plan(), 1.5)), "unsupported_chain");
});

test("refuses a malformed or zero destination", () => {
  for (const to of ["0x123", "not-an-address", "", "0x" + "0".repeat(40)]) {
    const bad = plan({ transactionRequest: { to } });
    assert.equal(reasonOf(() => assertSignable(bad, ARBITRUM)), "bad_target", to);
  }
});

test("refuses empty or malformed calldata", () => {
  // A swap or approval is always a contract call; empty calldata to a router
  // does nothing and burns the gas anyway.
  for (const data of ["0x", "0xabc", "deadbeef", "0xzz"]) {
    const bad = plan({ transactionRequest: { data } });
    assert.equal(reasonOf(() => assertSignable(bad, ARBITRUM)), "no_calldata", data);
  }
});

test("refuses a malformed value or a zero gas limit", () => {
  assert.equal(
    reasonOf(() => assertSignable(plan({ transactionRequest: { value: "100" } }), ARBITRUM)),
    "bad_value"
  );
  assert.equal(
    reasonOf(() => assertSignable(plan({ transactionRequest: { gasLimit: "0x0" } }), ARBITRUM)),
    "bad_gas_limit"
  );
});

test("validates approval fields as a group", () => {
  // A spender with no token, or a token with no amount, is a route that will
  // revert on transferFrom after the user has already paid for a signature.
  assert.equal(
    reasonOf(() => assertSignable(plan({ fromTokenAddress: null }), ARBITRUM)),
    "bad_token"
  );
  assert.equal(
    reasonOf(() => assertSignable(plan({ approvalAddress: "0xzz" }), ARBITRUM)),
    "bad_spender"
  );
  assert.equal(
    reasonOf(() => assertSignable(plan({ fromAmountAtomic: "0" }), ARBITRUM)),
    "bad_amount"
  );
  assert.equal(
    reasonOf(() => assertSignable(plan({ fromAmountAtomic: "1e6" }), ARBITRUM)),
    "bad_amount"
  );
});

test("skips approval checks entirely for a native-token send", () => {
  const native = plan({
    approvalAddress: null,
    fromTokenAddress: null,
    fromAmountAtomic: null,
  });
  assert.doesNotThrow(() => assertSignable(native, ARBITRUM));
});

test("refuses a stale quote, and a quote with no expiry at all", () => {
  const expired = plan({ expiresAt: new Date(Date.now() - 1000).toISOString() });
  assert.equal(reasonOf(() => assertSignable(expired, ARBITRUM)), "expired");

  // The absence of a freshness guarantee is not a freshness guarantee.
  const undated = plan({ expiresAt: undefined });
  assert.equal(reasonOf(() => assertSignable(undated, ARBITRUM)), "no_expiry");
});

test("freshness can be waived for flows with no price attached", () => {
  const undated = plan({ expiresAt: undefined });
  assert.doesNotThrow(() => assertSignable(undated, ARBITRUM, { requireFreshness: false }));
});

test("refuses a plan with no transaction at all", () => {
  assert.equal(reasonOf(() => assertSignable({}, ARBITRUM)), "no_transaction");
});

test("fee caps must be internally consistent", () => {
  const sane = { gasLimit: 21000n, maxFeePerGas: 100n, maxPriorityFeePerGas: 1n };
  assert.doesNotThrow(() => assertFeesSane(sane));

  // Every node rejects a tip above the cap.
  assert.equal(
    reasonOf(() => assertFeesSane({ ...sane, maxPriorityFeePerGas: 500n })),
    "bad_fees"
  );
  assert.equal(reasonOf(() => assertFeesSane({ ...sane, gasLimit: 0n })), "bad_gas_limit");
  assert.equal(reasonOf(() => assertFeesSane({ ...sane, maxFeePerGas: 0n })), "bad_fees");
});

test("maximumCostWei prices the worst case", () => {
  // Uses the fee CAP, not the expected price, so a balance check against it
  // cannot pass optimistically and revert out-of-funds afterwards.
  const cost = maximumCostWei({
    gasLimit: 21000n,
    maxFeePerGas: 100n,
    maxPriorityFeePerGas: 1n,
    value: 5n,
  });
  assert.equal(cost, 5n + 21000n * 100n);
});

test("parseAtomic never throws", () => {
  assert.equal(parseAtomic("1000000"), 1000000n);
  assert.equal(parseAtomic(0n), 0n);
  // BigInt() throws on all of these; a throw inside a validator is a crash
  // rather than a rejection the caller can render.
  for (const bad of ["1e6", "-1", "1.5", "0x10", "", " 1 ", null, undefined, 5, {}]) {
    assert.equal(parseAtomic(bad), null, String(bad));
  }
  // Above uint256 no ERC-20 can hold it and no approve() can encode it.
  assert.equal(parseAtomic("9".repeat(78)), null);
});

test("parseQuantity reads beyond 2^53 without rounding", () => {
  // Number() would silently round, and a rounded value moves a different
  // amount than the one quoted.
  assert.equal(parseQuantity("0xffffffffffffffffff"), 4722366482869645213695n);
  assert.equal(parseQuantity("0x0"), 0n);
  assert.equal(parseQuantity("100"), null);
  assert.equal(parseQuantity(null), null);
});

test("hex predicates distinguish byte strings from quantities", () => {
  // Calldata is bytes: odd length is not a byte sequence.
  assert.ok(isHexData("0x"), "empty calldata is valid data");
  assert.ok(!hasCalldata("0x"), "but not a contract call");
  assert.ok(!isHexData("0xabc"), "odd length");
  // A quantity has no evenness requirement.
  assert.ok(isQuantity("0x1"));
  assert.ok(!isQuantity("0x"));
});

test("selectorOf extracts the 4-byte function selector", () => {
  assert.equal(selectorOf("0x095ea7b3" + "0".repeat(128)), "0x095ea7b3");
  assert.equal(selectorOf("0x"), null);
  assert.equal(selectorOf("0xabcd"), null); // too short to hold one
});

test("chain helpers", () => {
  assert.ok(isBoundToChain(1, 1));
  assert.ok(!isBoundToChain(1, 8453));
  assert.ok(!isBoundToChain("1", 1), "a string chain id is not bound");
  // Suggested, not mandated — mainnet is riskier than a single-sequencer L2.
  assert.equal(confirmationsFor(1), 3);
  assert.equal(confirmationsFor(8453), 1);
  assert.equal(confirmationsFor(999999), 2, "unknown chain gets the safe default");
});
