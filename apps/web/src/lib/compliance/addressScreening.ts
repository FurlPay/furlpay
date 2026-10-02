import { screenWallet, type AmlScreenResult } from "@furlpay/compliance";
import { screenAddressCircle } from "@/lib/services/circleCompliance";

// ---------------------------------------------------------------------------
// The one wallet-address screen money routes call.
//
//   1. OFAC SDN (local, synchronous, always) — the floor that has always run.
//   2. Circle Compliance Engine, when configured and the chain is covered —
//      a second, independent opinion (sanctions, illicit behaviour, custom
//      rules set in Circle's console).
//
// The stricter verdict wins (block > review > allow). A configured Circle that
// errors returns a block (circleCompliance.ts fails closed), so an outage can
// never turn into an allow. Circle not configured, or a chain Circle does not
// cover (Base), leaves the OFAC verdict as the answer and says so in
// `categories`, so the record shows which layers actually ran.
// ---------------------------------------------------------------------------

const RANK: Record<AmlScreenResult["action"], number> = { allow: 0, review: 1, block: 2 };

export async function screenAddressRisk(address: string, chain: string): Promise<AmlScreenResult> {
  const ofac = screenWallet(address);
  if (ofac.action === "block") return ofac;

  const circle = await screenAddressCircle(address, chain);
  if (!circle) return ofac;

  if (RANK[circle.action] > RANK[ofac.action]) return circle;
  return { ...ofac, categories: [...ofac.categories, ...circle.categories] };
}
