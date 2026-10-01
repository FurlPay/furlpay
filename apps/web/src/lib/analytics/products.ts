// Product (ops rail) labels. Dependency-free so client components can import
// it without pulling server modules into the browser bundle.

export type ProductRail = "x402" | "mpp" | "lifi" | "cctp" | "transfers";

export const PRODUCT_LABELS: Record<ProductRail, string> = {
  transfers: "Wallet transfers",
  lifi: "Swaps & bridging",
  cctp: "USDC bridge (CCTP)",
  x402: "x402 API payments",
  mpp: "Machine payments (MPP)",
};
