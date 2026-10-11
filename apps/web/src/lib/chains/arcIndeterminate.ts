import { z } from "zod";
import { raiseAlert } from "@/lib/alerts";
import { sbSelect } from "@/lib/supabase";
import { hash, hex, rpc } from "@/lib/payments/merchant/rpc";
import { arcCreditableTransfers } from "@/lib/chains/arc";
import type { PaymentChainId } from "@/lib/payments/merchant/registry";

// What Arc says about agent payments whose outcome FurlPay did not observe.
//
// arcExecutionAdapter returns INDETERMINATE — keeping the transaction hash as
// rail_ref — when a submitted transfer's receipt was not seen in time. The
// execute route leaves those authorizations in EXECUTING and lists them in
// cp_indeterminate_executions, correctly: they must not be failed (a retry
// could pay twice) or settled (nobody saw it land).
//
// This pass gathers the evidence an operator needs, READ-ONLY. It changes no
// authorization or attempt: moving one to SETTLED or FAILED is a financial
// decision that stays with a human until that policy is approved. For each
// row it re-reads the receipt through the proven-endpoint reader and reports
// one of:
//   settled_evidence   success, canonical block, and exactly the authorized
//                      amount moved from the settlement address to the
//                      authorized destination (either Transfer stream)
//   settled_mismatch   success, but the movement does not match the authorization
//   reverted           the transaction failed on-chain; no value moved
//   not_found          no receipt (dropped, or not yet propagated)
//   unavailable        the network could not be read; nothing is concluded
export type ArcResolution = "settled_evidence" | "settled_mismatch" | "reverted" | "not_found" | "unavailable";
type Row = { id: number | string; organization_id: string; authorization_id: string; rail_id: string; rail_ref: string | null; started_at: string };
type Auth = { id: string; amount_atomic: string; recipient_destination: string | null; network_id: string };
const receiptSchema = z.object({ status: hex, blockNumber: hex, blockHash: hash, logs: z.array(z.unknown()) });

export async function classifyArcExecution(txHash: string, chain: PaymentChainId, auth: Auth, settlementAddress: string): Promise<{ resolution: ArcResolution; detail: string }> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return { resolution: "unavailable", detail: "rail_ref is not a transaction hash" };
  try {
    const raw = await rpc(chain, "eth_getTransactionReceipt", [txHash]);
    if (raw === null) return { resolution: "not_found", detail: "no receipt" };
    const r = receiptSchema.parse(raw);
    if (BigInt(r.status) !== 1n) return { resolution: "reverted", detail: `reverted in block ${BigInt(r.blockNumber)}` };
    const block = z.object({ hash }).parse(await rpc(chain, "eth_getBlockByNumber", [r.blockNumber, false]));
    if (block.hash.toLowerCase() !== r.blockHash.toLowerCase()) return { resolution: "not_found", detail: "receipt block is no longer canonical" };
    const to = (auth.recipient_destination ?? "").toLowerCase();
    const moved = arcCreditableTransfers(r.logs as Parameters<typeof arcCreditableTransfers>[0])
      .filter(m => m.to === to && m.from === settlementAddress.toLowerCase());
    const total = moved.reduce((s, m) => s + m.erc20Value, 0n);
    const dust = moved.some(m => m.dust !== 0n);
    if (moved.length === 1 && !dust && total === BigInt(auth.amount_atomic)) return { resolution: "settled_evidence", detail: `${total} units to ${to} in block ${BigInt(r.blockNumber)}` };
    return { resolution: "settled_mismatch", detail: `expected ${auth.amount_atomic} to ${to}; observed ${moved.length} movement(s) totalling ${total}${dust ? " with sub-unit dust" : ""}` };
  } catch (e) {
    return { resolution: "unavailable", detail: (e instanceof Error ? e.message : "error").slice(0, 120) };
  }
}

export async function reviewArcIndeterminate(env: Record<string, string | undefined> = process.env, limit = 50) {
  const rows = await sbSelect<Row>("cp_indeterminate_executions", `rail_id=eq.arc_usdc_transfer&rail_ref=not.is.null&limit=${limit}`);
  if (!rows.length) return { reviewed: 0, byResolution: {} as Record<string, number> };
  const settlement = (env.ARC_SETTLEMENT_ADDRESS ?? "").trim();
  const ids = [...new Set(rows.map(r => r.authorization_id))];
  const auths = new Map((await sbSelect<Auth>("cp_authorizations", `id=in.(${ids.map(encodeURIComponent).join(",")})&select=id,amount_atomic,recipient_destination,network_id&limit=${ids.length}`)).map(a => [a.id, a]));
  const byResolution: Record<string, number> = {};
  for (const row of rows) {
    const auth = auths.get(row.authorization_id);
    if (!auth || !row.rail_ref) continue;
    const chain: PaymentChainId = auth.network_id === "arc" ? "arc" : "arc-testnet";
    const out = /^0x[0-9a-fA-F]{40}$/.test(settlement)
      ? await classifyArcExecution(row.rail_ref, chain, auth, settlement)
      : { resolution: "unavailable" as const, detail: "ARC_SETTLEMENT_ADDRESS is not configured" };
    byResolution[out.resolution] = (byResolution[out.resolution] ?? 0) + 1;
    await raiseAlert({
      kind: `arc.indeterminate.${out.resolution}`,
      severity: out.resolution === "settled_mismatch" ? "critical" : out.resolution === "unavailable" ? "medium" : "high",
      title: `Arc payment with unobserved outcome: ${out.resolution.replace("_", " ")}`,
      detail: `Authorization ${row.authorization_id} (${row.rail_ref}) is still EXECUTING. ${out.detail}. Resolve it by hand; nothing was changed.`,
      dimensions: { authorization: row.authorization_id },
      context: { organization: row.organization_id, transaction: row.rail_ref, network: auth.network_id },
    });
  }
  return { reviewed: rows.length, byResolution };
}
