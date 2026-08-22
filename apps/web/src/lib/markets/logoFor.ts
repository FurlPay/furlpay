// Bare-ticker logo lookup for client components.
//
// Split out of catalog.ts on purpose: that module is 500 lines of asset data
// that a small client component (a news row, a ticker chip) has no reason to
// pull into the browser bundle just to resolve one icon path. This re-exports
// the one function those callers need, and the tree-shaken import stays small.
//
// Ambiguous tickers resolve the same way `bySymbol` does — towards the listed
// security — so a logo can never disagree with the row it sits next to.

import { assetLogoPath, bySymbol } from "./catalog";

/** Public logo path for a bare ticker, or null when we ship no artwork. */
export function logoForSymbol(symbol: string): string | null {
  const asset = bySymbol.get(symbol.toUpperCase());
  return asset ? assetLogoPath(asset) : null;
}
