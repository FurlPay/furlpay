export const DEFAULT_BOUNDS = {
  SOL_USD: [1, 2000] as const,
  BTC_USD: [1000, 500000] as const,
};

export function assertPriceInBounds(price: number, lower: number, upper: number): void {
  if (price < lower || price > upper) {
    throw new Error(`Price ${price} is outside sanity bounds [${lower}, ${upper}]`);
  }
}

export function isPriceStale(timestamp: number, maxAgeMs: number): boolean {
  return Date.now() - timestamp > maxAgeMs;
}
