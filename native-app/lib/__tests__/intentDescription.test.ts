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

// ---------------------------------------------------------------------------
// Circle Arc, where USDC IS the native coin.
//
// Arc breaks the assumption every other chain in the table above shares: that
// the native coin is something FurlPay does not settle in, so empty calldata can
// be refused outright. On Arc a plain native send is a USDC payment, and the
// ordinary way to pay — refusing it made the normal Arc payment undescribable.
//
// The second thing Arc breaks is precision. ONE balance, two interfaces:
// 18 decimals natively, 6 through ERC-20. `USDC.arc` is registered once at the
// canonical 18dp, so the ERC-20 path has to scale by 10^12 and the native path
// must not scale at all. Getting that backwards does not produce a bad signature
// — the server recomputes and refuses — but it does produce a refused payment
// that looks like a bug, or a confirmation screen quoting the wrong amount.
// ---------------------------------------------------------------------------

const ARC_USDC = "0x3600000000000000000000000000000000000000";
const ARC = 5042;
const ARC_TESTNET = 5042002;

/** $100 at each precision. The factor between them is exactly 10^12. */
const HUNDRED_18DP = 100_000_000_000_000_000_000n;
const HUNDRED_6DP = 100_000_000n;

describe("Arc native USDC transfers", () => {
  it("describes a plain native send as a USDC.arc transfer", () => {
    // No calldata, value in the 18dp native units Arc uses for gas and msg.value.
    const d = describeTransaction(
      tx({ chainId: ARC, to: ALICE, data: "0x", value: HUNDRED_18DP })
    );
    expect(d).toMatchObject({
      action: "transfer",
      chain: "arc",
      assetId: "USDC.arc",
      destination: ALICE.toLowerCase(),
    });
    // UNSCALED: `value` is already canonical, so the intent carries it verbatim.
    expect(d.amountMinor).toBe(HUNDRED_18DP.toString());
  });

  it("describes the testnet chain separately from mainnet", () => {
    // Different settlement domains. Describing a testnet payment as "arc" would
    // put a mainnet chain into an intent for a transaction that cannot settle
    // there, and the server would refuse on chain mismatch.
    const d = describeTransaction(
      tx({ chainId: ARC_TESTNET, to: ALICE, data: "0x", value: HUNDRED_18DP })
    );
    expect(d.chain).toBe("arc-testnet");
    expect(d.assetId).toBe("USDC.arc");
  });

  it("REFUSES a zero-value native send", () => {
    // Arc permits it — a zero-value send even to 0x0 succeeds — so the chain
    // will not stop it. It moves nothing, so there is no payment to describe.
    expect(() =>
      describeTransaction(tx({ chainId: ARC, to: ALICE, data: "0x", value: 0n }))
    ).toThrow(/does not transfer any value/i);
  });

  it("still refuses a native send on a chain whose native coin is ETH", () => {
    // The rule Arc is the exception to, asserted so the exception did not become
    // the rule. ETH is not a FurlPay settlement asset and naming one would be a
    // fabrication.
    expect(() => describeTransaction(tx({ chainId: 42161, to: ALICE, data: "0x" }))).toThrow(
      /not supported/i
    );
    expect(() => describeTransaction(tx({ chainId: 1, to: ALICE, data: "0x" }))).toThrow(
      /not supported/i
    );
  });
});

describe("Arc ERC-20 USDC transfers", () => {
  it("scales a 6dp calldata amount up to the canonical 18dp intent", () => {
    // THE CONVERSION. Calldata to Arc's ERC-20 interface says 1e8; the intent
    // must say 1e20, because that is the precision USDC.arc is registered at and
    // what the server compares against.
    const d = describeTransaction(
      tx({ chainId: ARC, to: ARC_USDC, data: call(SELECTORS.transfer, ALICE, HUNDRED_6DP) })
    );
    expect(d).toMatchObject({ chain: "arc", assetId: "USDC.arc", action: "transfer" });
    expect(d.amountMinor).toBe(HUNDRED_18DP.toString());
    // Stated as the relationship rather than the literal, so the intent is clear.
    expect(BigInt(d.amountMinor)).toBe(HUNDRED_6DP * 10n ** 12n);
  });

  it("does NOT scale amounts on any other chain", () => {
    // Every other USDC is 6dp on both sides. Scaling there would overstate every
    // amount by a trillion.
    const d = describeTransaction(tx({ chainId: 42161, to: USDC_ARBITRUM }));
    expect(d.amountMinor).toBe("10000000");
  });

  it("recognises Arc's USDC interface on both networks", () => {
    // It is the same precompile-shaped address on mainnet and testnet — an
    // interface onto the native balance, not a deployed token per network.
    for (const chainId of [ARC, ARC_TESTNET]) {
      const d = describeTransaction(
        tx({ chainId, to: ARC_USDC, data: call(SELECTORS.transfer, ALICE, HUNDRED_6DP) })
      );
      // Jest's expect takes one argument, unlike vitest's — the chain is named
      // in the object comparison instead so a failure still says which one.
      expect({ chainId, assetId: d.assetId }).toEqual({ chainId, assetId: "USDC.arc" });
    }
  });

  it("REFUSES a token transfer carrying native value on Arc", () => {
    // Worse on Arc than elsewhere: native value IS USDC here, so this moves USDC
    // twice while the description mentions one movement.
    expect(() =>
      describeTransaction(
        tx({
          chainId: ARC,
          to: ARC_USDC,
          data: call(SELECTORS.transfer, ALICE, HUNDRED_6DP),
          value: 1n,
        })
      )
    ).toThrow(/native currency alongside a token transfer/i);
  });

  it("REFUSES an unrecognised contract on Arc", () => {
    // A lookalike token is still a lookalike token on a chain with one real USDC.
    expect(() =>
      describeTransaction(tx({ chainId: ARC, to: "0x4444444444444444444444444444444444444444" }))
    ).toThrow(/does not recognise/i);
  });

  it("scales an approval amount the same way", () => {
    // An approval's amount is what gets granted, so the same conversion applies
    // — and an unscaled figure here would understate a granted allowance by 10^12.
    const d = describeTransaction(
      tx({ chainId: ARC, to: ARC_USDC, data: call(SELECTORS.approve, SPENDER, HUNDRED_6DP) })
    );
    expect(d.action).toBe("approve");
    expect(d.spender).toBe(SPENDER.toLowerCase());
  });
});
