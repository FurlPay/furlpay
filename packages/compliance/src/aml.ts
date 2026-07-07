import { AmlScreenResult } from "./types";
import { OFAC_SDN_ADDRESSES } from "./data/ofacSanctionedAddresses";

// ---------------------------------------------------------------------------
// Sanctions / AML screening — REAL OFAC SDN data (no mock scoring).
//
// `screenWallet` is synchronous and screens against the OFAC SDN crypto-address
// set: a bundled snapshot (data/ofacSanctionedAddresses.ts, generated from the
// U.S. Treasury SDN list) that can be refreshed at runtime with
// `refreshSanctionsList()`. This is the off-chain mirror of the on-chain
// SanctionsRegistry the SanctionsCheck contract reads; the authoritative,
// point-of-settlement check is on-chain (PolicyManager.evaluate → Chainalysis
// oracle + registry). Deeper transaction-risk scoring (mixer exposure, etc.)
// requires a paid provider (Chainalysis/TRM) and is intentionally NOT faked
// here — we only assert what we can verify: OFAC SDN membership.
// ---------------------------------------------------------------------------

const DEFAULT_SDN_URL =
  "https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_ETH.txt";

// Live, mutable set (lowercased). Seeded from the bundled real snapshot so
// screening works offline and deterministically; `refreshSanctionsList` updates
// it from the live SDN source.
const sanctionedSet = new Set<string>(OFAC_SDN_ADDRESSES.map((a) => a.toLowerCase()));

let lastRefreshedAt: number | null = null;

const ADDRESS_RE = /0x[0-9a-fA-F]{40}/g;

/** Introspection for /api/compliance and the trust page. */
export function getSanctionsListMeta(): {
  count: number;
  lastRefreshedAt: number | null;
  source: "bundled-snapshot" | "live";
} {
  return {
    count: sanctionedSet.size,
    lastRefreshedAt,
    source: lastRefreshedAt ? "live" : "bundled-snapshot",
  };
}

/**
 * Refresh the OFAC SDN address set from the live public source. Idempotent and
 * additive (never shrinks below the bundled snapshot on a partial fetch).
 * Returns the number of addresses now loaded.
 */
export async function refreshSanctionsList(url: string = DEFAULT_SDN_URL): Promise<number> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OFAC SDN fetch failed: ${res.status} ${res.statusText}`);
  const text = await res.text();
  const matches = text.match(ADDRESS_RE) ?? [];
  for (const a of matches) sanctionedSet.add(a.toLowerCase());
  lastRefreshedAt = Date.now();
  return sanctionedSet.size;
}

/** True if `address` is on the OFAC SDN crypto-address list. */
export function isSanctioned(address: string): boolean {
  return sanctionedSet.has(address.trim().toLowerCase());
}

/**
 * Screen a wallet against the OFAC SDN list. A sanctioned hit blocks; otherwise
 * the wallet is allowed (off-chain we assert only SDN membership — we do not
 * fabricate a risk score).
 */
export function screenWallet(
  address: string,
  provider: AmlScreenResult["provider"] = "ofac-sdn"
): AmlScreenResult {
  const sanctioned = isSanctioned(address);
  return {
    address,
    provider,
    risk: sanctioned ? "severe" : "low",
    score: sanctioned ? 100 : 0,
    sanctioned,
    categories: sanctioned ? ["sanctions", "ofac"] : [],
    action: sanctioned ? "block" : "allow",
  };
}
