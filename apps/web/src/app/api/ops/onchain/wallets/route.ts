import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { PublicKey } from "@solana/web3.js";
import { requireOpsAdmin, opsError, opsOk } from "@/lib/ops/respond";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { sbInsert, sbSelect, sbUpdate, supabaseBackend } from "@/lib/supabase";
import { resetRegisteredCache } from "@/lib/onchain/ingest";

export const dynamic = "force-dynamic";

// /api/ops/onchain/wallets (ADMIN_ONLY) — the chain-agnostic tracked-wallet
// registry (migration 0034). One wallet (a treasury, or a watched party) with
// addresses on any supported chain; every indexer picks it up through
// trackedAddresses(). User wallets are NOT managed here: they are linked by
// the user with a signature proof (linked_wallets).
//
//   GET                          -> wallets with their addresses
//   POST { action: "add", label, scope, addresses: [{ chain, address }] }
//   POST { action: "deactivate", id }

const CHAINS = ["ethereum", "base", "arbitrum", "polygon", "solana"] as const;

/** EVM -> lowercase hex; Solana -> a real public key (AGENTS rule 9). Null when invalid. */
function normalize(chain: (typeof CHAINS)[number], address: string): string | null {
  const a = address.trim();
  if (chain === "solana") {
    try {
      return new PublicKey(a).toBase58() === a ? a : null;
    } catch {
      return null;
    }
  }
  return /^0x[0-9a-fA-F]{40}$/.test(a) && !/^0x0{40}$/.test(a) ? a.toLowerCase() : null;
}

const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("add"),
    label: z.string().trim().min(1).max(80),
    scope: z.enum(["treasury", "watch"]),
    addresses: z.array(z.object({ chain: z.enum(CHAINS), address: z.string().min(32).max(64) })).min(1).max(10),
  }),
  z.object({ action: z.literal("deactivate"), id: z.string().uuid() }),
]);

export async function GET(req: NextRequest) {
  const auth = await requireOpsAdmin(req);
  if (!auth.ok) return auth.res;
  if (supabaseBackend !== "supabase") return opsError("not_configured", "No durable store (SUPABASE_URL).", 503);
  const [wallets, addresses] = await Promise.all([
    sbSelect<{ id: string; label: string; scope: string; active: boolean; created_at: string }>("onchain_tracked_wallets", "select=id,label,scope,active,created_at&order=created_at.desc&limit=500"),
    sbSelect<{ wallet_id: string; chain: string; address: string }>("onchain_tracked_addresses", "select=wallet_id,chain,address&limit=5000"),
  ]);
  return opsOk({ wallets: wallets.map((w) => ({ ...w, addresses: addresses.filter((a) => a.wallet_id === w.id).map(({ chain, address }) => ({ chain, address })) })) });
}

export async function POST(req: NextRequest) {
  const auth = await requireOpsAdmin(req);
  if (!auth.ok) return auth.res;
  const limited = await rateLimitOr429(req, "ops-onchain-wallets", { limit: 20, windowMs: 60_000 }, auth.account.user.id);
  if (limited) return limited;
  if (supabaseBackend !== "supabase") return opsError("not_configured", "No durable store (SUPABASE_URL).", 503);
  const body = await validateBody(req, Body);
  if (body instanceof NextResponse) return body;

  if (body.action === "deactivate") {
    const rows = await sbUpdate("onchain_tracked_wallets", `id=eq.${body.id}`, { active: false });
    resetRegisteredCache();
    return rows.length ? opsOk({ id: body.id, active: false }) : opsError("not_found", "No such wallet.", 404);
  }

  const addrs: { chain: string; address: string }[] = [];
  for (const a of body.addresses) {
    const n = normalize(a.chain, a.address);
    if (!n) return opsError("invalid_address", `Not a valid ${a.chain} address: ${a.address.slice(0, 12)}…`, 400);
    addrs.push({ chain: a.chain, address: n });
  }
  // Explicit whitelist of stored fields (AGENTS rule 4): nothing else from the body is persisted.
  const [w] = await sbInsert<{ id?: string; label: string; scope: string }>("onchain_tracked_wallets", { label: body.label, scope: body.scope });
  try {
    await sbInsert("onchain_tracked_addresses", addrs.map((a) => ({ wallet_id: w.id, chain: a.chain, address: a.address })));
  } catch (e) {
    await sbUpdate("onchain_tracked_wallets", `id=eq.${w.id}`, { active: false }); // leave no half-registered wallet active
    const dup = /duplicate|23505|conflict/i.test((e as Error).message);
    return opsError(dup ? "already_tracked" : "store_error", dup ? "One of these addresses is already tracked on that chain." : "Could not save the addresses.", dup ? 409 : 502);
  }
  resetRegisteredCache();
  return opsOk({ id: w.id, label: body.label, scope: body.scope, addresses: addrs });
}
