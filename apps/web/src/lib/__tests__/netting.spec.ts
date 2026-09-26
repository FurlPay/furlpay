import { describe, expect, it } from "vitest";
import {
  computeNetPositions,
  deriveTransfers,
  netBatch,
  NettingError,
  verifySettlement,
  type Obligation,
} from "@/lib/money/netting";

describe("computeNetPositions", () => {
  it("nets a simple two-party pair to a single net position", () => {
    const positions = computeNetPositions([
      { from: "a", to: "b", amountMinor: 1000 },
      { from: "b", to: "a", amountMinor: 400 },
    ]);
    expect(positions).toEqual([
      { party: "a", netMinor: -600 },
      { party: "b", netMinor: 600 },
    ]);
  });

  it("collapses a fully circular debt to zero for everyone", () => {
    // a owes b owes c owes a, all the same amount: nothing needs to move.
    const positions = computeNetPositions([
      { from: "a", to: "b", amountMinor: 500 },
      { from: "b", to: "c", amountMinor: 500 },
      { from: "c", to: "a", amountMinor: 500 },
    ]);
    expect(positions.every((p) => p.netMinor === 0)).toBe(true);
    expect(deriveTransfers(positions)).toEqual([]);
  });

  it("is deterministic regardless of obligation ordering", () => {
    const obligations: Obligation[] = [
      { from: "c", to: "a", amountMinor: 300 },
      { from: "a", to: "b", amountMinor: 1000 },
      { from: "b", to: "c", amountMinor: 250 },
    ];
    const forward = computeNetPositions(obligations);
    const reversed = computeNetPositions([...obligations].reverse());
    expect(forward).toEqual(reversed);
  });

  it("rejects non-integer, zero, and negative amounts", () => {
    for (const bad of [0, -100, 10.5, NaN, Infinity]) {
      expect(() => computeNetPositions([{ from: "a", to: "b", amountMinor: bad }])).toThrow(NettingError);
    }
  });

  it("rejects a self-obligation instead of silently dropping it", () => {
    expect(() => computeNetPositions([{ from: "a", to: "a", amountMinor: 100 }])).toThrow(/to itself/);
  });
});

describe("deriveTransfers", () => {
  it("emits at most N-1 transfers", () => {
    const parties = ["a", "b", "c", "d", "e", "f"];
    const obligations: Obligation[] = [];
    // Dense graph: everyone owes everyone a varying amount.
    for (const from of parties) {
      for (const to of parties) {
        if (from !== to) {
          obligations.push({ from, to, amountMinor: 100 + from.charCodeAt(0) + to.charCodeAt(0) });
        }
      }
    }
    const result = netBatch(obligations);
    expect(result.transfers.length).toBeLessThanOrEqual(parties.length - 1);
    expect(result.reduction.grossTransferCount).toBe(30);
  });

  it("refuses to derive transfers from a non-conserving net vector", () => {
    // Hand-built vector that does not sum to zero — value would be created.
    expect(() =>
      deriveTransfers([
        { party: "a", netMinor: -100 },
        { party: "b", netMinor: 150 },
      ]),
    ).toThrow(/do not conserve value/);
  });

  it("never emits a transfer with a non-positive amount", () => {
    const result = netBatch([
      { from: "a", to: "b", amountMinor: 1 },
      { from: "b", to: "c", amountMinor: 1 },
      { from: "c", to: "a", amountMinor: 2 },
    ]);
    for (const t of result.transfers) {
      expect(t.amountMinor).toBeGreaterThan(0);
      expect(Number.isSafeInteger(t.amountMinor)).toBe(true);
      expect(t.from).not.toBe(t.to);
    }
  });
});

describe("netBatch conservation", () => {
  it("moves no more value than was owed", () => {
    const result = netBatch([
      { from: "a", to: "b", amountMinor: 10_000 },
      { from: "b", to: "a", amountMinor: 9_500 },
      { from: "b", to: "c", amountMinor: 2_000 },
      { from: "c", to: "a", amountMinor: 1_200 },
    ]);
    expect(result.reduction.nettedValueMinor).toBeLessThanOrEqual(result.reduction.grossValueMinor);
    expect(verifySettlement(
      [
        { from: "a", to: "b", amountMinor: 10_000 },
        { from: "b", to: "a", amountMinor: 9_500 },
        { from: "b", to: "c", amountMinor: 2_000 },
        { from: "c", to: "a", amountMinor: 1_200 },
      ],
      result.transfers,
    )).toEqual({ ok: true });
  });

  it("holds over randomised batches — the property that matters", () => {
    // Netting that loses a cent is worse than no netting at all. This sweeps
    // many shapes, checking the independent post-condition each time.
    const parties = ["w", "x", "y", "z", "p", "q"];
    let seed = 42;
    const rand = (n: number) => {
      // Deterministic LCG so a failure is reproducible from the seed.
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };

    for (let trial = 0; trial < 300; trial += 1) {
      const count = 1 + rand(20);
      const obligations: Obligation[] = [];
      for (let i = 0; i < count; i += 1) {
        const from = parties[rand(parties.length)];
        let to = parties[rand(parties.length)];
        if (from === to) to = parties[(parties.indexOf(from) + 1) % parties.length];
        obligations.push({ from, to, amountMinor: 1 + rand(100_000) });
      }

      const result = netBatch(obligations);
      expect(verifySettlement(obligations, result.transfers)).toEqual({ ok: true });
      expect(result.positions.reduce((s, p) => s + p.netMinor, 0)).toBe(0);
      expect(result.transfers.length).toBeLessThanOrEqual(
        Math.max(0, new Set(obligations.flatMap((o) => [o.from, o.to])).size - 1),
      );
    }
  });

  it("reports a measured reduction, and zero when netting saves nothing", () => {
    // One obligation between two parties: netting cannot improve on it.
    const single = netBatch([{ from: "a", to: "b", amountMinor: 100 }]);
    expect(single.reduction.nettedTransferCount).toBe(1);
    expect(single.reduction.ratio).toBe(0);

    // Dense batch: real, computed saving.
    const dense = netBatch([
      { from: "a", to: "b", amountMinor: 100 },
      { from: "b", to: "a", amountMinor: 90 },
      { from: "a", to: "b", amountMinor: 50 },
      { from: "b", to: "a", amountMinor: 40 },
    ]);
    expect(dense.transfers).toHaveLength(1);
    expect(dense.reduction.ratio).toBeCloseTo(0.75, 10);
  });

  it("handles an empty batch without inventing work", () => {
    const result = netBatch([]);
    expect(result.transfers).toEqual([]);
    expect(result.reduction.ratio).toBe(0);
  });
});

describe("verifySettlement", () => {
  it("catches a tampered transfer set", () => {
    const obligations: Obligation[] = [
      { from: "a", to: "b", amountMinor: 1000 },
      { from: "b", to: "c", amountMinor: 400 },
    ];
    const result = netBatch(obligations);
    const tampered = result.transfers.map((t) => ({ ...t, amountMinor: t.amountMinor + 1 }));
    const check = verifySettlement(obligations, tampered);
    expect(check.ok).toBe(false);
  });
});
