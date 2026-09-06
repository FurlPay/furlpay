import { describeTransaction, SELECTORS, UndescribableTransaction } from "../signing/intentDescription";
import type { Eip1559Transaction } from "../evm/transaction";

// ---------------------------------------------------------------------------
// What this transaction MEANS, derived from its own bytes.
//
// A wrong description here cannot produce a wrong signature — the server
// decodes the same calldata and refuses if the two disagree. What it CAN
// produce is a wrong sentence in front of the user at the moment they approve,
// and their approval then attaches to the sentence rather than to the
// transaction. So the rule under test is: describe it exactly, or refuse.
// ---------------------------------------------------------------------------

const USDC_ARBITRUM = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const ALICE = "0x1111111111111111111111111111111111111111";
const SPENDER = "0x3333333333333333333333333333333333333333";

function call(sel: string, address: string, amount: bigint): string {
  return (
    sel + address.replace(/^0x/, "").toLowerCase().padStart(64, "0") + amount.toString(16).padStart(64, "0")
  );
}

function tx(over: Partial<Eip1559Transaction> = {}): Eip1559Transaction {
  return {
    chainId: 42161,
    nonce: 1n,
    maxPriorityFeePerGas: 1n,
    maxFeePerGas: 100n,
    gasLimit: 120000n,
    to: USDC_ARBITRUM,
    value: 0n,
    data: call(SELECTORS.transfer, ALICE, 10_000_000n),
    ...over,
  };
}

describe("selectors are computed, not pasted", () => {
  it("matches the published ERC-20 selectors", () => {
    // `0xa9059cbb` carries no meaning a reviewer can check, and a transposed
    // digit is a call to a different function.
    expect(SELECTORS.transfer).toBe("0xa9059cbb");
    expect(SELECTORS.approve).toBe("0x095ea7b3");
  });
});

describe("describes what it can justify", () => {
  it("reads a USDC transfer off the calldata", () => {
    expect(describeTransaction(tx())).toEqual({
      action: "transfer",
      chain: "arbitrum",
      assetId: "USDC.arbitrum",
      amountMinor: "10000000",
      destination: ALICE,
    });
  });

  it("reads an approval, and names the SPENDER separately", () => {
    // An approval's danger is the spender, not the token contract it is
    // addressed to. Folding them together would let an unlimited approval to an
    // attacker look like an ordinary interaction with USDC.
    const described = describeTransaction(
      tx({ data: call(SELECTORS.approve, SPENDER, 5n) })
    );
    expect(described.action).toBe("approve");
    expect(described.spender).toBe(SPENDER);
    expect(described.destination).toBe(USDC_ARBITRUM.toLowerCase());
  });

  it("describes each pinned chain's USDC", () => {
    const chains: [number, string][] = [
      [1, "USDC.ethereum"],
      [137, "USDC.polygon"],
      [8453, "USDC.base"],
      [42161, "USDC.arbitrum"],
    ];
    const contracts: Record<number, string> = {
      1: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      137: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
      8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      42161: USDC_ARBITRUM,
    };
    for (const [chainId, assetId] of chains) {
      expect(describeTransaction(tx({ chainId, to: contracts[chainId] })).assetId).toBe(assetId);
    }
  });

  it("is case-insensitive about the contract address", () => {
    expect(describeTransaction(tx({ to: USDC_ARBITRUM.toLowerCase() })).assetId).toBe(
      "USDC.arbitrum"
    );
  });
});

describe("REFUSES rather than guessing", () => {
  const cases: [string, Partial<Eip1559Transaction>, RegExp][] = [
    ["an unpinned chain", { chainId: 999 }, /not one this app can describe/i],
    [
      "an unrecognised contract",
      { to: "0x2222222222222222222222222222222222222222" },
      /does not recognise/i,
    ],
    ["unknown calldata", { data: "0xdeadbeef" }, /not a plain transfer or approval/i],
    ["a native transfer", { data: "0x", to: ALICE }, /not supported/i],
    [
      "native value alongside a token transfer",
      { value: 1n },
      /native currency alongside a token transfer/i,
    ],
  ];

  for (const [name, over, expected] of cases) {
    it(`refuses ${name}`, () => {
      expect(() => describeTransaction(tx(over))).toThrow(expected);
      expect(() => describeTransaction(tx(over))).toThrow(UndescribableTransaction);
    });
  }

  it("refuses trailing calldata", () => {
    // Solidity ignores trailing bytes, so a lenient decoder and the EVM would
    // disagree about what the transaction is.
    expect(() =>
      describeTransaction(tx({ data: call(SELECTORS.transfer, ALICE, 1n) + "deadbeef" }))
    ).toThrow(UndescribableTransaction);
  });

  it("refuses non-zero address padding", () => {
    // The EVM masks the top 12 bytes off, so dirty padding changes nothing
    // on-chain while changing what a naive decoder reads — a free way to show
    // one recipient and use another.
    const dirty =
      SELECTORS.transfer + "01" + "0".repeat(22) + ALICE.slice(2) + "0".repeat(64);
    expect(() => describeTransaction(tx({ data: dirty }))).toThrow(UndescribableTransaction);
  });

  it("refuses truncated calldata", () => {
    expect(() =>
      describeTransaction(tx({ data: SELECTORS.transfer + "0".repeat(64) }))
    ).toThrow(UndescribableTransaction);
  });
});
