// Payroll pricing, in USDC micro-units (6 dp). These are QUOTES recorded with a
// batch: billing is not connected, so nothing here charges anyone. The same
// formula runs inside payroll_batch_create (migration 0042); the database value
// is the one stored, this copy exists for previews and tests.
export const PAYROLL_BATCH_BPS = 35;
export const PAYROLL_BATCH_MIN_UNITS = 1_500_000n; // 1.50 USDC
export const PAYROLL_SEAT_UNITS = 19_000_000n; // 19 USDC per active contractor per month
export const PAYROLL_MAX_LINE_UNITS = 1_000_000_000_000n; // 1,000,000 USDC

export function batchFee(grossUnits: bigint): bigint {
  if (grossUnits <= 0n) throw new RangeError("gross must be positive");
  const pct = (grossUnits * BigInt(PAYROLL_BATCH_BPS)) / 10_000n; // rounded down
  return pct > PAYROLL_BATCH_MIN_UNITS ? pct : PAYROLL_BATCH_MIN_UNITS;
}

/** The seat fee is due once per merchant per cycle: the first batch of the month carries it. */
export function seatFee(activeContractors: number, alreadyChargedThisCycle: boolean): bigint {
  if (!Number.isInteger(activeContractors) || activeContractors < 0) throw new RangeError("invalid seat count");
  return alreadyChargedThisCycle ? 0n : BigInt(activeContractors) * PAYROLL_SEAT_UNITS;
}

export function quoteBatch(lineUnits: bigint[], activeContractors: number, alreadyChargedThisCycle: boolean) {
  if (lineUnits.length < 1 || lineUnits.length > 100) throw new RangeError("1-100 lines");
  for (const u of lineUnits) if (u <= 0n || u > PAYROLL_MAX_LINE_UNITS) throw new RangeError("line amount out of range");
  const gross = lineUnits.reduce((s, u) => s + u, 0n);
  const fee = batchFee(gross);
  const seat = seatFee(activeContractors, alreadyChargedThisCycle);
  return { gross, batchFee: fee, seatFee: seat, total: gross + fee + seat };
}

/** Micro-units → the USD number createPayment takes. Exact for ≤ 1e12 units (< 2^53). */
export function unitsToUsd(units: bigint): number {
  if (units <= 0n || units > PAYROLL_MAX_LINE_UNITS) throw new RangeError("amount out of range");
  return Number(units) / 1_000_000;
}
