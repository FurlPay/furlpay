import {
  attributed,
  unknownAttribute,
  type Attributed,
  type PaymentCapability,
} from "@/lib/hotels/provenance";

// ---------------------------------------------------------------------------
// FurlPay's verified payment-capability store, keyed by Google place id.
//
// WHY THIS IS A SEAM AND NOT A TABLE OF HOTELS
// ============================================
// The "Pay with USDC" collection is the one filter on the map that Google
// cannot answer and must not be asked. It is a commercial fact about a
// merchant relationship FurlPay either has or does not have.
//
// Right now FurlPay has verified none, so this returns `unknown` for every
// place. That is the correct output, not a stub to be replaced by plausible
// values: a map that shows "Pay with USDC" badges nobody verified is worse
// than a map that shows none, because a reader would act on it.
//
// When the settlement layer can answer, replace `lookupCapabilities` with a
// real read (Postgres, or the merchant service) and nothing above this line
// changes — the route, the collection rule and the UI already handle every
// state including `verified_usdc`.
//
// The place id is the join key because it is the ONE Google field their
// policy permits persisting, which makes it the only durable way to line up
// their data with ours.
// ---------------------------------------------------------------------------

export interface CapabilityRecord {
  placeId: string;
  capability: PaymentCapability;
  /** ISO timestamp of when the settlement layer last confirmed this. */
  observedAt: string;
}

/**
 * Resolve capabilities for a batch of place ids.
 *
 * Returns a map containing ONLY the places FurlPay has a record for. A caller
 * must treat an absent key as `unknown` — see the route, which does exactly
 * that rather than defaulting to false.
 */
export async function lookupCapabilities(
  placeIds: readonly string[]
): Promise<Map<string, Attributed<PaymentCapability>>> {
  const out = new Map<string, Attributed<PaymentCapability>>();
  if (placeIds.length === 0) return out;

  const records = await readVerifiedCapabilities(placeIds);

  for (const rec of records) {
    out.set(
      rec.placeId,
      attributed<PaymentCapability>(rec.capability, "furlpay_settlement", 1, rec.observedAt)
    );
  }
  return out;
}

/**
 * The data-source seam.
 *
 * Deliberately returns nothing today. FurlPay has not verified USDC
 * acceptance for any Google place, and inventing entries here would put
 * fabricated merchant claims on a live map — the precise failure this module
 * exists to prevent.
 *
 * Implement against the merchant/settlement store when it can answer. The
 * contract is: return a record ONLY for a place whose capability has actually
 * been established.
 */
async function readVerifiedCapabilities(
  _placeIds: readonly string[]
): Promise<CapabilityRecord[]> {
  return [];
}

/** True when FurlPay can answer at all for this place. */
export function isResolved(a: Attributed<PaymentCapability> | undefined): boolean {
  return a !== undefined && a.value !== "unknown";
}

export function unknownCapability(): Attributed<PaymentCapability> {
  return unknownAttribute<PaymentCapability>() as Attributed<PaymentCapability>;
}
