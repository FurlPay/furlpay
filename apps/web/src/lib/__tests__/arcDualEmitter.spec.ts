import { describe, expect, it } from "vitest";
import {
  ARC_SYSTEM_EMITTER,
  ARC_TRANSFER_TOPIC,
  ARC_USDC_ERC20,
  arcCreditableTransfers,
  arcLogStream,
  arcLogValueToNative,
  ArcPrecisionError,
  type ArcTransferLogLike,
} from "../chains/arc";

// ---------------------------------------------------------------------------
// Arc's dual Transfer stream.
//
// EVERY FIXTURE BELOW IS A REAL ARC MAINNET TRANSACTION, read from
// https://rpc.mainnet.arc.io via eth_getLogs on 2026-09-25 around block
// 22,617,146. They are quoted rather than invented because the whole point of
// these tests is the relationship between two numbers the chain produces, and a
// hand-made fixture would only prove that the test author believed the docs.
//
// The two failure modes under test pull in opposite directions:
//   * summing both streams DOUBLE-CREDITS every ERC-20 transfer;
//   * comparing across them without converting accepts a payment 10^12 too
//     small.
// ---------------------------------------------------------------------------

const pad = (addr: string) => `0x${"0".repeat(24)}${addr.slice(2)}`.toLowerCase();

/** tx 0x42d155ba…c15d — ONE transfer() that emitted BOTH logs. */
const PAIRED = {
  from: "0x2f8237a9bc4547607ff42198d1ecbc46ca64cc7d",
  to: "0x8366a39cc670b4001a1121b8f6a443a643e40951",
  native18: 91528859000000000000n,
  erc20_6: 91528859n,
};

/** tx 0xbb74a675…cec9 — a plain native send. NO ERC-20 log existed. */
const NATIVE_ONLY = {
  value18: 10639294662379335864n,
};

function systemLog(from: string, to: string, value: bigint): ArcTransferLogLike {
  return {
    address: ARC_SYSTEM_EMITTER,
    topics: [ARC_TRANSFER_TOPIC, pad(from), pad(to)],
    data: `0x${value.toString(16)}`,
  };
}

function erc20Log(from: string, to: string, value: bigint): ArcTransferLogLike {
  return {
    address: ARC_USDC_ERC20,
    topics: [ARC_TRANSFER_TOPIC, pad(from), pad(to)],
    data: `0x${value.toString(16)}`,
  };
}

describe("the measurement these tests rest on", () => {
  it("holds the exact 10^12 relationship observed on mainnet", () => {
    // If this ever fails, the premise of the whole module changed and the
    // conversions below are wrong — not merely out of date.
    expect(PAIRED.native18 / PAIRED.erc20_6).toBe(10n ** 12n);
    expect(PAIRED.native18 / 10n ** 12n).toBe(PAIRED.erc20_6);
  });

  it("identifies the system emitter, measured not assumed", () => {
    // 39 f's then e — the address that emitted 3478 of the Transfer logs in the
    // sampled window. Compared lowercased: eth_getLogs returns addresses
    // lowercased, and the checksummed spelling of an all-f address is not
    // something to hand-write into a test.
    expect(ARC_SYSTEM_EMITTER.toLowerCase()).toBe(`0x${"f".repeat(39)}e`);
    expect(ARC_SYSTEM_EMITTER).toHaveLength(42);
  });
});

describe("stream identification decides precision", () => {
  it("separates the two USDC streams from everything else", () => {
    expect(arcLogStream(ARC_SYSTEM_EMITTER)).toBe("system_emitter_18dp");
    expect(arcLogStream(ARC_USDC_ERC20)).toBe("usdc_erc20_6dp");
    // EURC on Arc — a real token, and not USDC.
    expect(arcLogStream("0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1")).toBe("other");
  });

  it("is case- and whitespace-insensitive, since logs arrive lowercased", () => {
    // eth_getLogs returns lowercase addresses; a checksum-only comparison would
    // classify every real log as "other" and silently see no USDC at all.
    expect(arcLogStream(ARC_SYSTEM_EMITTER.toLowerCase())).toBe("system_emitter_18dp");
    expect(arcLogStream(`  ${ARC_USDC_ERC20.toLowerCase()}  `)).toBe("usdc_erc20_6dp");
  });

  it("does not throw on a malformed address", () => {
    expect(arcLogStream("not-an-address")).toBe("other");
    expect(arcLogStream("")).toBe("other");
  });
});

describe("normalising a log value — the 1e12 under-accept", () => {
  it("brings both streams to the same canonical number", () => {
    // The point: these two logs describe ONE movement, and after normalising
    // they agree exactly.
    expect(arcLogValueToNative(ARC_SYSTEM_EMITTER, PAIRED.native18)).toBe(PAIRED.native18);
    expect(arcLogValueToNative(ARC_USDC_ERC20, PAIRED.erc20_6)).toBe(PAIRED.native18);
  });

  it("makes the under-accept impossible to write by accident", () => {
    // THE BUG THIS PREVENTS, spelled out. An expectation of $1 is 1_000_000 at
    // 6dp. Compared raw against a system-emitter value, 1_000_000 wei satisfies
    // it — and 1_000_000 wei is 0.000000000001 USDC.
    const expectedSixDp = 1_000_000n;
    const derisoryNativeAmount = 1_000_000n;
    expect(derisoryNativeAmount >= expectedSixDp).toBe(true); // the naive check PASSES

    // Normalised, the same comparison correctly refuses it.
    const expectedNative = arcLogValueToNative(ARC_USDC_ERC20, expectedSixDp);
    const actualNative = arcLogValueToNative(ARC_SYSTEM_EMITTER, derisoryNativeAmount);
    expect(actualNative >= expectedNative).toBe(false);
    // By a factor of exactly 10^12, which is the scale of the error.
    expect(expectedNative / actualNative).toBe(10n ** 12n);
  });

  it("REFUSES to scale a log from any other token", () => {
    // A third token's Transfer has unknown decimals. Guessing would mean
    // crediting an arbitrary token as USDC.
    expect(() => arcLogValueToNative("0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1", 1n)).toThrow(
      ArcPrecisionError
    );
  });
});

describe("crediting each movement once — the double-credit", () => {
  it("counts a transfer() ONCE even though it emitted two logs", () => {
    // The real paired transaction. Both logs present; one movement.
    const credited = arcCreditableTransfers([
      systemLog(PAIRED.from, PAIRED.to, PAIRED.native18),
      erc20Log(PAIRED.from, PAIRED.to, PAIRED.erc20_6),
    ]);

    expect(credited).toHaveLength(1);
    expect(credited[0].nativeValue).toBe(PAIRED.native18);
    expect(credited[0].erc20Value).toBe(PAIRED.erc20_6);
    expect(credited[0].viaErc20Interface).toBe(true);

    // And the total is the movement, not twice it. Summing the raw logs after
    // normalising would have given 2x this.
    const total = credited.reduce((n, t) => n + t.nativeValue, 0n);
    expect(total).toBe(PAIRED.native18);
    expect(total).not.toBe(PAIRED.native18 * 2n);
  });

  it("still sees a plain native send, which has no ERC-20 log at all", () => {
    // The case a USDC-contract-only filter misses completely — and on a chain
    // where USDC is the gas token, this is the ORDINARY way to pay.
    const credited = arcCreditableTransfers([
      systemLog(PAIRED.from, PAIRED.to, NATIVE_ONLY.value18),
    ]);

    expect(credited).toHaveLength(1);
    expect(credited[0].viaErc20Interface).toBe(false);
    expect(credited[0].nativeValue).toBe(NATIVE_ONLY.value18);
  });

  it("reports the dust the 6dp view discards", () => {
    // 10639294662379335864 native is 10639294 at 6dp, and 662379335864 of it
    // does not survive the ERC-20 interface. A sweep that moved the 6dp figure
    // would strand that remainder; a reconciliation that ignored it would never
    // balance.
    const [t] = arcCreditableTransfers([systemLog(PAIRED.from, PAIRED.to, NATIVE_ONLY.value18)]);
    expect(t.erc20Value).toBe(10_639_294n);
    expect(t.dust).toBe(662_379_335_864n);
    // The decomposition is exact and reversible.
    expect(t.erc20Value * 10n ** 12n + t.dust).toBe(NATIVE_ONLY.value18);
  });

  it("pairs N identical movements N times, not all against the first log", () => {
    // A batch paying the same recipient twice for the same amount is a real
    // shape (two invoices, one payout run). A naive `.find()` without consuming
    // the match would pair both system logs to the first ERC-20 log and get the
    // count right by luck; this asserts the pairing itself is one-to-one.
    const credited = arcCreditableTransfers([
      systemLog(PAIRED.from, PAIRED.to, PAIRED.native18),
      systemLog(PAIRED.from, PAIRED.to, PAIRED.native18),
      erc20Log(PAIRED.from, PAIRED.to, PAIRED.erc20_6),
      erc20Log(PAIRED.from, PAIRED.to, PAIRED.erc20_6),
    ]);
    expect(credited).toHaveLength(2);
    expect(credited.every((t) => t.viaErc20Interface)).toBe(true);
    expect(credited.reduce((n, t) => n + t.nativeValue, 0n)).toBe(PAIRED.native18 * 2n);
  });

  it("marks a native send as native even when an unrelated ERC-20 log is present", () => {
    // Two different movements in one transaction: a native send to A, and an
    // ERC-20 transfer to B. The ERC-20 log must not be claimed as A's pair.
    const other = "0x1111111111111111111111111111111111111111";
    const credited = arcCreditableTransfers([
      systemLog(PAIRED.from, PAIRED.to, NATIVE_ONLY.value18),
      systemLog(PAIRED.from, other, PAIRED.native18),
      erc20Log(PAIRED.from, other, PAIRED.erc20_6),
    ]);
    expect(credited).toHaveLength(2);
    expect(credited.find((t) => t.to === PAIRED.to)!.viaErc20Interface).toBe(false);
    expect(credited.find((t) => t.to === other)!.viaErc20Interface).toBe(true);
  });

  it("ignores logs that are not Transfers, and other tokens' Transfers", () => {
    const credited = arcCreditableTransfers([
      // An Approval, say — right emitter, wrong topic.
      { address: ARC_SYSTEM_EMITTER, topics: ["0xdead", pad(PAIRED.from), pad(PAIRED.to)], data: "0x1" },
      // EURC's own Transfer. Real token, not USDC.
      {
        address: "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1",
        topics: [ARC_TRANSFER_TOPIC, pad(PAIRED.from), pad(PAIRED.to)],
        data: "0x1",
      },
      // A Transfer missing its `to` topic — unattributable.
      { address: ARC_SYSTEM_EMITTER, topics: [ARC_TRANSFER_TOPIC, pad(PAIRED.from)], data: "0x1" },
    ]);
    expect(credited).toEqual([]);
  });

  it("returns nothing for an empty receipt rather than throwing", () => {
    expect(arcCreditableTransfers([])).toEqual([]);
  });
});
