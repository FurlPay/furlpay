export const MAX_UNITS = 1_000_000n * 1_000_000n;
export const PRICING = { starter: 95, growth: 75, scale: 50, enterprise: 35 } as const;
export type PricingTier = keyof typeof PRICING;
/** Merchants without an assigned tier (merchant_pricing, 0042) pay the growth rate. */
export const DEFAULT_TIER: PricingTier = "growth";
export function parseUsdc(value: string): bigint {
  if (!/^(0|[1-9]\d{0,6})(\.\d{1,6})?$/.test(value)) throw new Error("Enter an exact USDC amount with up to six decimals");
  const [whole, fraction = ""] = value.split(".");
  const units = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  if (units <= 0n || units > MAX_UNITS) throw new Error("Amount must be above zero and at most 1,000,000 USDC");
  return units;
}
export function displayUsdc(value: string | bigint, minDecimals = 2): string {
  const units = BigInt(value);
  const digits = (units < 0n ? -units : units).toString().padStart(7, "0");
  const fraction = digits.slice(-6).replace(/0+$/, "").padEnd(minDecimals, "0");
  return `${units < 0n ? "-" : ""}${digits.slice(0, -6)}${fraction ? `.${fraction}` : ""}`;
}
/** Round down to the smallest USDC unit; network gas is paid separately by the wallet. */
export function feeSplit(gross: bigint, bps = 75, feePayer: "merchant" | "customer" = "merchant") {
  if (gross <= 0n || gross > MAX_UNITS || !Number.isInteger(bps) || bps < 0 || bps > 1000) throw new Error("Invalid fee terms");
  const fee = gross * BigInt(bps) / 10_000n;
  return { gross: gross.toString(), fee: fee.toString(), charge: (feePayer === "merchant" ? gross : gross + fee).toString(), net: (feePayer === "merchant" ? gross - fee : gross).toString() };
}
