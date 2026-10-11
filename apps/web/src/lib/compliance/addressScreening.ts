import { screenWallet, type AmlScreenResult } from "@furlpay/compliance";
import { screenAddressCircle } from "@/lib/services/circleCompliance";
import { screenArcAddress } from "@/lib/chains/arcCompliance";
import { rpc } from "@/lib/payments/merchant/rpc";

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

  // ARC-P2-004. Circle Compliance has no Arc mapping, which left Arc screening at OFAC only.
  // Arc's USDC exposes the list that actually ENFORCES: isBlacklisted() on 0x3600. A blocked
  // address makes the transfer revert (one blocked payee reverts a whole batchPay), so it is a
  // block; an unanswerable check THROWS, and every caller treats a throw as "cannot screen".
  if (chain === "arc" || chain === "arc-testnet") {
    const arc = await screenArcAddress(address, async ({ to, data }) => String(await rpc(chain, "eth_call", [{ to, data }, "latest"])));
    if (arc.status === "blocked") return { ...ofac, risk: "severe", score: 100, sanctioned: true, action: "block", categories: [...ofac.categories, "arc_usdc_blocklist"] };
    if (arc.status !== "clear") throw new Error(`Arc blocklist unavailable: ${arc.reason ?? "unknown"}`);
    ofac.categories = [...ofac.categories, "arc_usdc_blocklist_clear"];
  }

  const circle = await screenAddressCircle(address, chain);
  if (!circle) return ofac;

  if (RANK[circle.action] > RANK[ofac.action]) return circle;
  return { ...ofac, categories: [...ofac.categories, ...circle.categories] };
}
