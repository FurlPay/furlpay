import { encodeStake, encodeUnstake, StakingError, STAKING_SELECTORS } from "../onchain";
import { computeRewards, isStakable, stakableProtocols, type StakingPosition, type StakingProtocol } from "../types";

// ---------------------------------------------------------------------------
// Staking.
//
// Two classes of failure are under test, and both are silent:
//
//   1. A transaction encoded against the wrong interface. ETH sent as `value`
//      to a non-payable ERC-4626 deposit reverts; an ERC-4626 deposit sent with
//      no allowance reverts; a stake amount that never reaches the calldata
//      stakes nothing. None of these throws in JS.
//
//   2. A protocol reaching the UI without a verified address. That one does not
//      revert — it succeeds, and the user's ETH is gone.
// ---------------------------------------------------------------------------

const OWNER = "0x1111111111111111111111111111111111111111";
const CONTRACT = "0x2222222222222222222222222222222222222222";
const RECEIPT = "0x3333333333333333333333333333333333333333";

const word = (hex: string) => hex.padStart(64, "0");
const addr = (a: string) => a.slice(2).toLowerCase().padStart(64, "0");

function protocol(over: Partial<StakingProtocol> = {}): StakingProtocol {
  return {
    id: "p1",
    name: "Test LST",
    chain: "ethereum",
    assetSymbol: "ETH",
    receiptSymbol: "tLST",
    accounting: "exchange_rate",
    exit: "withdrawal_queue",
    contract: CONTRACT,
    receiptToken: RECEIPT,
    sourceUrl: "https://protocol.example/docs/contracts",
    verified: true,
    unbondingDays: 3,
    aprPercent: null,
    aprAsOf: null,
    risks: [],
    ...over,
  };
}

describe("isStakable — the gate that stops funds reaching an unverified address", () => {
  it("allows a fully verified protocol", () => {
    expect(isStakable(protocol())).toEqual({ ok: true });
  });

  it("refuses one that is not marked verified", () => {
    expect(isStakable(protocol({ verified: false })).ok).toBe(false);
  });

  it("refuses one with no contract address", () => {
    expect(isStakable(protocol({ contract: null })).ok).toBe(false);
  });

  it("refuses one with no receipt token", () => {
    expect(isStakable(protocol({ receiptToken: null })).ok).toBe(false);
  });

  // Provenance is not decoration: it is the only way anyone re-checks the
  // address later, and an address nobody can re-check is unverified in fact
  // whatever the flag says.
  it("refuses one with no recorded source for its address", () => {
    expect(isStakable(protocol({ sourceUrl: null })).ok).toBe(false);
  });

  it("refuses a malformed address even when marked verified", () => {
    expect(isStakable(protocol({ contract: "0xnope" })).ok).toBe(false);
    expect(isStakable(protocol({ receiptToken: "0x123" })).ok).toBe(false);
  });

  // A missing APR must NOT block staking: a vendor rate API being down is not a
  // reason to freeze a user out of their own funds.
  it("still allows staking when the APR is unknown", () => {
    expect(isStakable(protocol({ aprPercent: null })).ok).toBe(true);
  });

  it("filters a mixed list down to what is safe", () => {
    const list = [protocol({ id: "good" }), protocol({ id: "bad", contract: null })];
    expect(stakableProtocols(list).map((p) => p.id)).toEqual(["good"]);
  });
});

describe("encodeStake", () => {
  it("encodes an ERC-4626 deposit with no value attached", () => {
    const { data, value } = encodeStake({ interface: "erc4626", amount: 10n ** 18n, receiver: OWNER });
    expect(data).toBe(`${STAKING_SELECTORS.deposit4626}${word((10n ** 18n).toString(16))}${addr(OWNER)}`);
    // A non-zero value would send ETH to a non-payable function and revert.
    expect(value).toBe(0n);
  });

  it("encodes a native submit that carries the stake as value", () => {
    const amount = 5n * 10n ** 17n;
    const { data, value } = encodeStake({ interface: "native_submit", amount, receiver: OWNER });
    expect(data).toBe(`${STAKING_SELECTORS.submitNative}${"0".repeat(64)}`);
    // On this interface the stake IS the value; a zero here stakes nothing
    // while still costing gas.
    expect(value).toBe(amount);
  });

  // Passing a referral address would enrol the user's deposit in a fee-sharing
  // programme they were never told about.
  it("passes the zero address as referral, taking no fee", () => {
    const { data } = encodeStake({ interface: "native_submit", amount: 1n, receiver: OWNER });
    expect(data.slice(10)).toBe("0".repeat(64));
  });

  it("refuses a zero or negative amount", () => {
    for (const amount of [0n, -1n]) {
      expect(() => encodeStake({ interface: "erc4626", amount, receiver: OWNER })).toThrow(StakingError);
    }
  });

  it("refuses a malformed receiver", () => {
    expect(() => encodeStake({ interface: "erc4626", amount: 1n, receiver: "0xnope" })).toThrow(StakingError);
  });

  it("refuses an unknown interface rather than guessing", () => {
    expect(() =>
      encodeStake({ interface: "something_else" as never, amount: 1n, receiver: OWNER }),
    ).toThrow(StakingError);
  });

  it("produces different calldata for the two interfaces", () => {
    const a = encodeStake({ interface: "erc4626", amount: 1n, receiver: OWNER });
    const b = encodeStake({ interface: "native_submit", amount: 1n, receiver: OWNER });
    expect(a.data.slice(0, 10)).not.toBe(b.data.slice(0, 10));
  });
});

describe("encodeUnstake", () => {
  it("encodes an ERC-4626 redeem", () => {
    const { data } = encodeUnstake({ interface: "erc4626", shares: 42n, receiver: OWNER, owner: OWNER });
    expect(data).toBe(`${STAKING_SELECTORS.redeem4626}${word("2a")}${addr(OWNER)}${addr(OWNER)}`);
  });

  // Withdrawal-queue ABIs are protocol-specific and not standardised. Guessing
  // one produces a plausible call that reverts — or hits a different function.
  it("refuses to guess a non-standard withdrawal queue", () => {
    expect(() =>
      encodeUnstake({ interface: "native_submit", shares: 1n, receiver: OWNER, owner: OWNER }),
    ).toThrow(/withdrawal page/i);
  });

  it("refuses a zero amount", () => {
    expect(() =>
      encodeUnstake({ interface: "erc4626", shares: 0n, receiver: OWNER, owner: OWNER }),
    ).toThrow(StakingError);
  });
});

describe("computeRewards", () => {
  function position(over: Partial<StakingPosition> = {}): StakingPosition {
    return {
      protocolId: "p1",
      receiptBalance: 0n,
      receiptDecimals: 18,
      underlyingValue: null,
      underlyingDecimals: 18,
      readAt: Date.now(),
      ...over,
    };
  }

  it("reads rewards from balance growth on a rebasing token", () => {
    const p = position({ receiptBalance: 105n });
    expect(computeRewards(p, "rebasing", 100n)).toBe(5n);
  });

  // The distinction the accounting field exists for: an exchange-rate token's
  // balance never grows, so reading it as rebasing reports zero rewards forever.
  it("reads rewards from redemption value on an exchange-rate token", () => {
    const p = position({ receiptBalance: 100n, underlyingValue: 108n });
    expect(computeRewards(p, "exchange_rate", 100n)).toBe(8n);
  });

  // "You earned nothing" and "we could not read what you earned" are different
  // statements, and only one is a reason to distrust the screen.
  it("returns null when the underlying value could not be read", () => {
    const p = position({ receiptBalance: 100n, underlyingValue: null });
    expect(computeRewards(p, "exchange_rate", 100n)).toBeNull();
  });

  it("returns null when the principal is unknown", () => {
    expect(computeRewards(position({ receiptBalance: 105n }), "rebasing", null)).toBeNull();
  });

  // A position briefly under water (slashing, a rate dip) must not render as a
  // negative reward.
  it("floors a loss at zero rather than showing a negative reward", () => {
    expect(computeRewards(position({ receiptBalance: 95n }), "rebasing", 100n)).toBe(0n);
  });

  it("stays exact far above 2^53", () => {
    const principal = 10n ** 24n;
    const p = position({ receiptBalance: principal + 7n });
    expect(computeRewards(p, "rebasing", principal)).toBe(7n);
  });
});

describe("selectors are computed from signatures", () => {
  // Pinned against the published four-byte values for the ERC-4626 standard.
  // Computed at runtime from the signature, so a typo in the SIGNATURE fails
  // here — something a hand-pasted constant could never reveal.
  it("match the ERC-4626 standard", () => {
    expect(STAKING_SELECTORS.deposit4626).toBe("0x6e553f65");
    expect(STAKING_SELECTORS.redeem4626).toBe("0xba087652");
    expect(STAKING_SELECTORS.convertToAssets).toBe("0x07a2d13a");
    expect(STAKING_SELECTORS.previewRedeem).toBe("0x4cdad506");
    expect(STAKING_SELECTORS.maxRedeem).toBe("0xd905777e");
  });
});
