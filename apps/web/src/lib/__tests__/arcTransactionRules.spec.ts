import { describe, expect, it } from "vitest";
import {
  ARC_EVM_CONSTRAINTS,
  ARC_MIN_BASE_FEE_WEI,
  ARC_ZERO_ADDRESS_REVERT,
  ArcFeeFloorError,
  ArcForbiddenTransferError,
  assertArcFeeFloor,
  assertArcValueTransfer,
  classifyArcTransferFailure,
  isPermanentArcFailure,
  type ArcTransferFailure,
} from "../chains/arc";

// ---------------------------------------------------------------------------
// Arc's transaction rules, as opposed to its decimals (arcDecimals.spec.ts) or
// its CCTP wiring (arcCctp.spec.ts).
//
// Every constant asserted here is from https://docs.arc.io/arc/references/
// evm-differences rather than inferred from behaviour, because the behaviours
// in question CANNOT be observed locally: stock anvil has no 20 Gwei floor, no
// blocklist and no burn prohibition, so a test that "passed on a local node"
// says nothing about Arc. The docs are the only available oracle until there is
// a testnet deployment to measure, and these tests pin what they say so a later
// edit cannot quietly drift from it.
// ---------------------------------------------------------------------------

describe("the fee floor — the failure with no signal", () => {
  it("is 20 Gwei, expressed in the 18-decimal native interface", () => {
    // Arc's gas asset is USDC at 18 decimals natively, so "Gwei" here is 1e-9
    // of a USDC, not of an ETH. Getting this scale wrong by 1e12 would put the
    // floor at 0.02 USDC or at 20,000,000 USDC.
    expect(ARC_MIN_BASE_FEE_WEI).toBe(20_000_000_000n);
    expect(ARC_MIN_BASE_FEE_WEI).toBe(20n * 10n ** 9n);
  });

  it("REFUSES a fee below the floor rather than clamping it up", () => {
    // Clamping would spend the caller's money at a price they did not quote —
    // and on Arc the gas asset IS the asset being sent, so a silent clamp
    // changes how much is left to settle with.
    expect(() => assertArcFeeFloor(1_000_000_000n, "transfer")).toThrow(ArcFeeFloorError);
    expect(() => assertArcFeeFloor(ARC_MIN_BASE_FEE_WEI - 1n, "transfer")).toThrow(ArcFeeFloorError);
  });

  it("catches the default that every generic EVM adapter ships with", () => {
    // lib/chains/evmAdapter.ts falls back to 1 Gwei (0x3b9aca00) when
    // eth_gasPrice is unavailable. That default is 20x too low for Arc, and the
    // resulting transaction would vanish rather than fail.
    expect(() => assertArcFeeFloor(BigInt("0x3b9aca00"), "evmAdapter fallback")).toThrow(
      ArcFeeFloorError
    );
  });

  it("allows the floor itself and anything above it, unchanged", () => {
    // Returns the fee so it can be asserted inline in a payload builder without
    // the builder having to restate it.
    expect(assertArcFeeFloor(ARC_MIN_BASE_FEE_WEI, "transfer")).toBe(ARC_MIN_BASE_FEE_WEI);
    expect(assertArcFeeFloor(50_000_000_000n, "transfer")).toBe(50_000_000_000n);
  });

  it("explains that the transaction DISAPPEARS, not that it fails", () => {
    // The error text is the only place this distinction gets made to whoever
    // hits it at 3am, and it is the entire reason the guard is on the build
    // path: no receipt is produced, so nothing downstream can detect it.
    let err: ArcFeeFloorError | null = null;
    try {
      assertArcFeeFloor(1n, "settlement leg");
    } catch (e) {
      err = e as ArcFeeFloorError;
    }
    expect(err).toBeInstanceOf(ArcFeeFloorError);
    expect(err!.message).toMatch(/silently/i);
    expect(err!.message).toMatch(/no receipt/i);
    // Says what to do, and what NOT to do. A retry cannot fix an underpriced
    // transaction, and a retry loop is the obvious wrong reflex here.
    expect(err!.message).toMatch(/do not retry/i);
    // Carries the offending value so a caller can log it without parsing prose.
    expect(err!.maxFeePerGas).toBe(1n);
  });

  it("names the context it was called from", () => {
    // A bare "fee too low" in a log is unattributable in a system with several
    // transaction builders.
    expect(() => assertArcFeeFloor(1n, "cctp burn leg")).toThrow(/cctp burn leg/);
  });
});

describe("forbidden value transfers", () => {
  const ZERO = "0x0000000000000000000000000000000000000000";

  it("refuses a value-bearing send to the zero address", () => {
    // Burning USDC is forbidden on Arc. The transaction would still be mined
    // and still consume gas, so this is a real loss, not a no-op.
    expect(() => assertArcValueTransfer(ZERO, 1n, "sweep")).toThrow(ArcForbiddenTransferError);
  });

  it("ALLOWS a zero-value send to the zero address, which Arc permits", () => {
    // Documented explicitly: "a zero-value transfer to 0x0 succeeds". Guarding
    // on the recipient alone would refuse a legal call — which is why the guard
    // takes the value.
    expect(() => assertArcValueTransfer(ZERO, 0n, "probe")).not.toThrow();
  });

  it("tolerates checksum case and surrounding whitespace", () => {
    // The address arrives from JSON, a form field or another service; a guard
    // that only matched one spelling would be trivially bypassed by accident.
    expect(() => assertArcValueTransfer(`  ${ZERO}  `, 1n, "sweep")).toThrow(
      ArcForbiddenTransferError
    );
    expect(() => assertArcValueTransfer("0x0000000000000000000000000000000000000000".toUpperCase().replace("0X", "0x"), 1n, "sweep")).toThrow(
      ArcForbiddenTransferError
    );
  });

  it("does not refuse an ordinary recipient", () => {
    expect(() =>
      assertArcValueTransfer("0x8b1332e6414c830e823110667a6f0c10463d0f98", 1n, "transfer")
    ).not.toThrow();
  });

  it("quotes the chain's own revert reason so the two cannot drift", () => {
    expect(ARC_ZERO_ADDRESS_REVERT).toBe("Zero address not allowed");
    expect(() => assertArcValueTransfer(ZERO, 1n, "sweep")).toThrow(/Zero address not allowed/);
  });
});

describe("classifying a mined-but-failed transfer", () => {
  it("names a blocklist revert, which is the one that must not be retried", () => {
    expect(classifyArcTransferFailure("execution reverted: Blocklistable: account is blocklisted")).toBe(
      "blocklisted"
    );
    // Circle's own contracts have used both spellings over time.
    expect(classifyArcTransferFailure("Blacklistable: account is blacklisted")).toBe("blocklisted");
  });

  it("names the zero-address and burn reverts", () => {
    expect(classifyArcTransferFailure("Zero address not allowed")).toBe("zero_address");
    expect(classifyArcTransferFailure("execution reverted: forbidden burn")).toBe("forbidden_burn");
  });

  it("returns unknown rather than guessing", () => {
    // A wrong label on a compliance-relevant failure is worse than an honest
    // absence: "blocklisted" in a log is an assertion about a counterparty.
    expect(classifyArcTransferFailure("execution reverted")).toBe("unknown");
    expect(classifyArcTransferFailure("out of gas")).toBe("unknown");
    expect(classifyArcTransferFailure(null)).toBe("unknown");
    expect(classifyArcTransferFailure(undefined)).toBe("unknown");
    expect(classifyArcTransferFailure("")).toBe("unknown");
  });

  it("treats standing conditions as permanent and everything else as not", () => {
    // The point of the split. A blocklist is a decision by the issuer and a burn
    // rule is a property of the chain; neither clears on its own, so a retry is
    // pure gas. An unknown failure may well be transient and is left retryable.
    const permanent: ArcTransferFailure[] = ["blocklisted", "zero_address", "forbidden_burn"];
    for (const f of permanent) expect(isPermanentArcFailure(f), f).toBe(true);
    expect(isPermanentArcFailure("unknown")).toBe(false);
  });

  it("does not claim a precompile recipient is permanent", () => {
    // Deliberate. The docs state the rule but never enumerate Arc's precompile
    // addresses, so this classification comes from a revert string rather than
    // from a list we can check — and it is not worth asserting permanence on a
    // label we cannot corroborate.
    expect(isPermanentArcFailure("precompile_recipient")).toBe(false);
  });
});

describe("constraints that change how a contract must be written", () => {
  it("records that Arc has NO on-chain randomness", () => {
    // PREVRANDAO always returns 0, so anything derived from it is fully
    // predictable to a caller. This is the constraint most likely to be
    // violated by a contract ported from another chain and to pass every test.
    expect(ARC_EVM_CONSTRAINTS.prevrandaoIsAlwaysZero).toBe(true);
  });

  it("records the settlement-relevant fee-market differences", () => {
    // Base fee goes to the block beneficiary rather than being burned, which
    // changes fee accounting: the USDC is not destroyed, it is paid to someone.
    expect(ARC_EVM_CONSTRAINTS.baseFeeBurned).toBe(false);
    expect(ARC_EVM_CONSTRAINTS.blobTransactionsRejected).toBe(true);
  });

  it("records that inclusion IS finality, so there is no confirmation depth", () => {
    // Waiting N blocks on Arc is not caution, it is latency with no safety
    // benefit. It also means the reverse: there is no reorg window in which a
    // failed transfer might un-fail, so a failed receipt is the final word.
    expect(ARC_EVM_CONSTRAINTS.finalisesOnInclusion).toBe(true);
  });

  it("names the simulator that can actually reproduce these rules", () => {
    // Stock anvil will let a test burn USDC to 0x0 and accept a 1 Gwei fee, so
    // a green local test is not evidence about Arc. Recorded in code because
    // this is the assumption a future test author will otherwise make.
    expect(ARC_EVM_CONSTRAINTS.localSimulator).toBe("arc-anvil");
    expect(ARC_EVM_CONSTRAINTS.evmVersion).toBe("osaka");
  });
});
