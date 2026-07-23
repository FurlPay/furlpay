import { describe, it, expect } from "vitest";
import {
  EIP7702_FACTORY_FLAG,
  PER_EMPTY_ACCOUNT_COST,
  MAX_VERIFICATION_GAS,
  PRE_VERIFICATION_OVERHEAD_GAS,
  packAccountGasLimits,
  packGasFees,
  packInitCode,
  packPaymasterAndData,
  packUserOperation,
  encodeNonce,
  decodeNonce,
  isSequentialNonce,
  estimatePreVerificationGas,
  checkUserOperation,
  withEip7702Factory,
  type UserOperation,
} from "@/lib/erc4337";
import type { Hex } from "viem";

// ---------------------------------------------------------------------------
// The packing is asserted BYTE BY BYTE, deliberately.
//
// PackedUserOperation folds pairs of uint128 into single bytes32 words. Swap a
// pair and the result is still a well-formed bytes32 — TypeScript is happy, the
// EntryPoint decodes it, and the numbers are simply wrong. The failure surfaces
// as an out-of-gas or a mispriced operation, nowhere near the packing. Nothing
// but an explicit layout assertion catches it.
// ---------------------------------------------------------------------------

const SENDER = ("0x" + "11".repeat(20)) as Hex;
const PAYMASTER = ("0x" + "22".repeat(20)) as Hex;

function op(over: Partial<UserOperation> = {}): UserOperation {
  return {
    sender: SENDER,
    nonce: 0n,
    callData: "0xdeadbeef",
    callGasLimit: 100_000n,
    verificationGasLimit: 200_000n,
    preVerificationGas: 60_000n,
    maxFeePerGas: 2_000_000_000n,
    maxPriorityFeePerGas: 1_000_000_000n,
    signature: "0x",
    ...over,
  };
}

describe("packing — field order", () => {
  it("accountGasLimits puts VERIFICATION first, then call", () => {
    const packed = packAccountGasLimits({ verificationGasLimit: 0x11n, callGasLimit: 0x22n });
    expect(packed).toBe("0x" + "00".repeat(15) + "11" + "00".repeat(15) + "22");
    // Inverting the pair gives the account the execution budget to validate
    // with — an out-of-gas that reads as a broken account.
    expect(packed).not.toBe(
      packAccountGasLimits({ verificationGasLimit: 0x22n, callGasLimit: 0x11n })
    );
  });

  it("gasFees puts PRIORITY first, then max — the reverse of the struct order", () => {
    const packed = packGasFees({ maxPriorityFeePerGas: 0xaan, maxFeePerGas: 0xbbn });
    expect(packed).toBe("0x" + "00".repeat(15) + "aa" + "00".repeat(15) + "bb");
  });

  it("produces exactly 32 bytes for both words", () => {
    const o = op();
    expect(packAccountGasLimits(o)).toHaveLength(66); // 0x + 64 hex chars
    expect(packGasFees(o)).toHaveLength(66);
  });

  it("refuses to truncate a value that exceeds uint128", () => {
    // Silently wrapping a gas limit yields a mispriced operation, not a smaller
    // one, so this throws rather than masking.
    expect(() => packAccountGasLimits({ verificationGasLimit: 1n << 128n, callGasLimit: 1n })).toThrow(
      RangeError
    );
  });

  it("refuses a negative gas value", () => {
    expect(() => packGasFees({ maxPriorityFeePerGas: -1n, maxFeePerGas: 1n })).toThrow(RangeError);
  });
});

describe("packing — initCode", () => {
  it("is empty when there is no factory", () => {
    expect(packInitCode({})).toBe("0x");
  });

  it("concatenates factory and factoryData", () => {
    expect(packInitCode({ factory: EIP7702_FACTORY_FLAG, factoryData: "0xabcd" })).toBe(
      EIP7702_FACTORY_FLAG + "abcd"
    );
  });

  it("omits empty factoryData rather than appending '0x'", () => {
    expect(packInitCode({ factory: EIP7702_FACTORY_FLAG, factoryData: "0x" })).toBe(
      EIP7702_FACTORY_FLAG
    );
  });

  it("uses 0x7702 right-padded to a full 20-byte slot", () => {
    // Spec: "0x7702 right-padded with 18 zeros". It is a FLAG — nothing is
    // deployed there and the EntryPoint must not call it as a factory.
    expect(EIP7702_FACTORY_FLAG).toBe("0x7702" + "00".repeat(18));
    expect(EIP7702_FACTORY_FLAG).toHaveLength(42);
  });
});

describe("packing — paymasterAndData", () => {
  it("is empty with no paymaster, NOT a zero address", () => {
    // A zero address is a paymaster that is not a contract; bundlers reject it.
    expect(packPaymasterAndData(op())).toBe("0x");
  });

  it("packs address ‖ verificationGasLimit ‖ postOpGasLimit ‖ data", () => {
    const packed = packPaymasterAndData(
      op({
        paymaster: PAYMASTER,
        paymasterVerificationGasLimit: 0x33n,
        paymasterPostOpGasLimit: 0x44n,
        paymasterData: "0xfeed",
      })
    );
    expect(packed).toBe(
      PAYMASTER + "00".repeat(15) + "33" + "00".repeat(15) + "44" + "feed"
    );
    // 20 + 16 + 16 + 2 bytes.
    expect((packed.length - 2) / 2).toBe(54);
  });

  it("defaults absent paymaster gas limits to zero rather than omitting them", () => {
    // The fields are positional; omitting one would shift paymasterData into
    // the gas-limit slot.
    const packed = packPaymasterAndData(op({ paymaster: PAYMASTER, paymasterData: "0xaa" }));
    expect((packed.length - 2) / 2).toBe(53);
  });
});

describe("packUserOperation", () => {
  it("carries every field into the packed form", () => {
    const packed = packUserOperation(
      op({ nonce: 7n, factory: EIP7702_FACTORY_FLAG, paymaster: PAYMASTER })
    );
    expect(packed.sender).toBe(SENDER);
    expect(packed.nonce).toBe(7n);
    expect(packed.initCode).toBe(EIP7702_FACTORY_FLAG);
    expect(packed.callData).toBe("0xdeadbeef");
    expect(packed.preVerificationGas).toBe(60_000n);
    expect(packed.paymasterAndData.startsWith(PAYMASTER)).toBe(true);
  });
});

describe("nonce — 192-bit key + 64-bit sequence", () => {
  it("round-trips", () => {
    const n = encodeNonce(42n, 7n);
    expect(decodeNonce(n)).toEqual({ key: 42n, sequence: 7n });
  });

  it("keeps distinct keys independent", () => {
    // Different channels: an admin operation need not queue behind a normal one.
    expect(decodeNonce(encodeNonce(1n, 5n)).key).not.toBe(decodeNonce(encodeNonce(2n, 5n)).key);
  });

  it("identifies a classic sequential nonce as key 0", () => {
    expect(isSequentialNonce(encodeNonce(0n, 999n))).toBe(true);
    expect(isSequentialNonce(encodeNonce(1n, 0n))).toBe(false);
    // The spec's own rule: nonce < type(uint64).max means key == 0.
    expect(isSequentialNonce((1n << 64n) - 1n)).toBe(true);
  });

  it("rejects out-of-range key or sequence", () => {
    expect(() => encodeNonce(1n << 192n, 0n)).toThrow(RangeError);
    expect(() => encodeNonce(0n, 1n << 64n)).toThrow(RangeError);
  });
});

describe("preVerificationGas", () => {
  it("adds PER_EMPTY_ACCOUNT_COST for a 7702 operation", () => {
    // The EntryPoint cannot observe the authorization's cost and will not add
    // it. Omitted, the bundler is underpaid on every 7702 operation.
    const without = estimatePreVerificationGas({ calldataGas: 10_000n, hasAuthorization: false });
    const with7702 = estimatePreVerificationGas({ calldataGas: 10_000n, hasAuthorization: true });
    expect(with7702 - without).toBeGreaterThanOrEqual(PER_EMPTY_ACCOUNT_COST);
  });

  it("includes the fixed overhead and the bundle share", () => {
    const g = estimatePreVerificationGas({
      calldataGas: 0n,
      bundleShareGas: 0n,
      hasAuthorization: false,
      slackPct: 0,
    });
    expect(g).toBe(PRE_VERIFICATION_OVERHEAD_GAS);
  });

  it("rounds slack UP", () => {
    // Under-estimating gets the operation dropped AFTER the user signed, so
    // headroom is never rounded away.
    const g = estimatePreVerificationGas({
      calldataGas: 1n,
      bundleShareGas: 0n,
      hasAuthorization: false,
      slackPct: 10,
    });
    const base = 1n + PRE_VERIFICATION_OVERHEAD_GAS;
    expect(g).toBeGreaterThan(base);
  });
});

describe("bundler sanity checks", () => {
  it("accepts a well-formed operation", () => {
    expect(checkUserOperation(op()).ok).toBe(true);
  });

  it("rejects verification gas above the bundler ceiling", () => {
    const r = checkUserOperation(op({ verificationGasLimit: MAX_VERIFICATION_GAS + 1n }));
    expect(r.reasons).toContain("verification_gas_too_high");
  });

  it("rejects preVerificationGas below the fixed overhead", () => {
    expect(checkUserOperation(op({ preVerificationGas: 1n })).reasons).toContain(
      "pre_verification_gas_too_low"
    );
  });

  it("rejects a call gas limit below the cost of a value-bearing CALL", () => {
    expect(checkUserOperation(op({ callGasLimit: 100n })).reasons).toContain("call_gas_limit_too_low");
  });

  it("rejects non-positive fees", () => {
    expect(checkUserOperation(op({ maxFeePerGas: 0n })).reasons).toContain("fees_not_positive");
  });

  it("flags paymaster gas limits with no paymaster", () => {
    // Usually means the caller believes it is sponsored and is not.
    const r = checkUserOperation(op({ paymasterVerificationGasLimit: 50_000n }));
    expect(r.reasons).toContain("paymaster_gas_without_paymaster");
  });

  it("REQUIRES an authorization when the 7702 flag is set", () => {
    // Without the tuple the EntryPoint has no delegate to match the signature
    // against, and the bundler drops the operation silently.
    const flagged = withEip7702Factory(op());
    expect(checkUserOperation(flagged, { hasAuthorization: false }).reasons).toContain(
      "eip7702_requires_authorization"
    );
    expect(checkUserOperation(flagged, { hasAuthorization: true }).ok).toBe(true);
  });

  it("reports every violation at once, not just the first", () => {
    const r = checkUserOperation(op({ callGasLimit: 1n, maxFeePerGas: 0n, preVerificationGas: 0n }));
    expect(r.reasons.length).toBeGreaterThanOrEqual(3);
  });
});

describe("withEip7702Factory", () => {
  it("sets the flag and omits factoryData when there is no initializer", () => {
    const built = withEip7702Factory(op());
    expect(built.factory).toBe(EIP7702_FACTORY_FLAG);
    expect(built.factoryData).toBeUndefined();
  });

  it("attaches an initializer call when given one", () => {
    // Only on first use: the EntryPoint cannot tell whether a 7702 account is
    // initialised, so the initializer can be invoked repeatedly through it.
    const built = withEip7702Factory(op(), "0xc0ffee");
    expect(built.factoryData).toBe("0xc0ffee");
    expect(packInitCode(built)).toBe(EIP7702_FACTORY_FLAG + "c0ffee");
  });
});
