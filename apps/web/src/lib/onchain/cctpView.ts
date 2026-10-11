import { getChain } from "@/lib/services/chainRegistry";
import { SupabaseFunctionMissing, sbRpc, sbSelect, supabaseBackend } from "@/lib/supabase";
import { formatUnits } from "./normalize";
import { chainOfDomain, domainName } from "./cctp";

// Read model for the CCTP panel: server-side summary (cctp_summary) plus the
// newest transfers. Public chain data only. Every transfer carries its
// verification flags so the UI can never present an unverified leg as done.

export interface CctpTransferView {
  id: number;
  status: string;
  statusReason: string | null;
  sourceChain: string | null;
  sourceDomain: number;
  sourceName: string | null;
  destinationChain: string | null;
  destinationDomain: number | null;
  destinationName: string | null;
  amount: string | null;
  minted: string | null;
  fee: string | null;
  maxFee: string | null;
  recipient: string | null;
  /** Explorer link for the recipient on the destination chain, when FurlPay knows that chain. */
  recipientUrl: string | null;
  depositor: string | null;
  nonce: string | null;
  minFinalityThreshold: number | null;
  finalityThresholdExecuted: number | null;
  sourceTx: string | null;
  sourceTxUrl: string | null;
  sourceBlock: number | null;
  sourceTime: string | null;
  destinationTx: string | null;
  destinationTxUrl: string | null;
  destinationTime: string | null;
  destinationMethod: string | null;
  checks: { source: boolean; attestation: boolean; destination: boolean; finality: boolean };
}
export interface CctpView {
  available: boolean;
  reason: string | null;
  generatedAt: string;
  since: string;
  byStatus: Record<string, number>;
  outbound: { sourceChain: string; destinationDomain: number; destinationChain: string | null; transfers: number; amount: string; verified: number }[];
  inbound: { destinationChain: string; sourceDomain: number; sourceChain: string | null; transfers: number; minted: string }[];
  completionSeconds: { n: number; median: number | null };
  indexedChains: { chain: string; through: number; throughTime: string }[];
  recent: CctpTransferView[];
}

const fmt = (v: string | null | undefined) => (v === null || v === undefined ? null : formatUnits(String(v).split(".")[0], 6));
const txUrl = (chain: string | null, tx: string | null) => {
  const e = chain ? getChain(chain)?.explorer : null;
  return e && tx ? `${e.replace(/\/+$/, "").split("?")[0]}/tx/${tx}` : null;
};
const missing = (e: unknown) => e instanceof SupabaseFunctionMissing || /does not exist|PGRST20[25]|schema cache|42P01/i.test((e as Error).message);

type Row = Record<string, unknown>;
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const s = (v: unknown) => (v === null || v === undefined ? null : String(v));

export function toView(r: Row): CctpTransferView {
  const src = s(r.source_chain) ?? chainOfDomain(Number(r.source_domain));
  const dst = s(r.destination_chain) ?? (r.destination_domain === null ? null : chainOfDomain(Number(r.destination_domain)));
  return {
    id: Number(r.id),
    status: String(r.status),
    statusReason: s(r.status_reason),
    sourceChain: src,
    sourceDomain: Number(r.source_domain),
    sourceName: domainName(Number(r.source_domain)),
    destinationChain: dst,
    destinationDomain: n(r.destination_domain),
    destinationName: domainName(n(r.destination_domain)),
    amount: fmt(s(r.amount_raw)),
    minted: fmt(s(r.minted_raw)),
    fee: fmt(s(r.mint_fee_raw) ?? s(r.executed_fee_raw)),
    maxFee: fmt(s(r.max_fee_raw)),
    recipient: s(r.mint_recipient),
    recipientUrl: (() => {
      const e = dst ? getChain(dst)?.explorer : null;
      const a = s(r.mint_recipient);
      return e && a && /^0x[0-9a-f]{40}$/.test(a) ? `${e.replace(/\/+$/, "").split("?")[0]}/address/${a}` : null;
    })(),
    depositor: s(r.depositor),
    nonce: s(r.nonce),
    minFinalityThreshold: n(r.min_finality_threshold),
    finalityThresholdExecuted: n(r.finality_threshold_executed),
    sourceTx: s(r.source_tx_hash),
    sourceTxUrl: txUrl(s(r.source_chain), s(r.source_tx_hash)),
    sourceBlock: n(r.source_block_number),
    sourceTime: s(r.source_block_time),
    destinationTx: s(r.destination_tx_hash),
    destinationTxUrl: txUrl(dst, s(r.destination_tx_hash)),
    destinationTime: s(r.destination_block_time),
    destinationMethod: s(r.destination_method),
    checks: { source: Boolean(r.source_verified), attestation: Boolean(r.message_verified), destination: Boolean(r.destination_verified), finality: Boolean(r.finality_verified) },
  };
}

export async function cctpView(hours = 24, now = Date.now()): Promise<CctpView> {
  const since = new Date(now - hours * 3600_000).toISOString();
  const base: CctpView = { available: false, reason: null, generatedAt: new Date(now).toISOString(), since, byStatus: {}, outbound: [], inbound: [], completionSeconds: { n: 0, median: null }, indexedChains: [], recent: [] };
  if (supabaseBackend !== "supabase") return { ...base, reason: "No durable store configured (SUPABASE_URL)." };
  try {
    const [sum, rows] = await Promise.all([
      sbRpc<Record<string, unknown>>("cctp_summary", { p_since: since }),
      sbSelect<Row>("cctp_transfers", "select=*&status=neq.merged&order=id.desc&limit=25"),
    ]);
    const outbound = ((sum.outbound as Row[]) ?? []).map((o) => ({ sourceChain: String(o.source_chain), destinationDomain: Number(o.destination_domain), destinationChain: chainOfDomain(Number(o.destination_domain)), transfers: Number(o.n), amount: fmt(s(o.amount)) ?? "0", verified: Number(o.verified) }));
    const inbound = ((sum.inbound as Row[]) ?? []).map((i) => ({ destinationChain: String(i.destination_chain), sourceDomain: Number(i.source_domain), sourceChain: chainOfDomain(Number(i.source_domain)), transfers: Number(i.n), minted: fmt(s(i.minted)) ?? "0" }));
    const cs = (sum.completion_seconds as Row) ?? {};
    return {
      ...base,
      available: true,
      byStatus: (sum.by_status as Record<string, number>) ?? {},
      outbound,
      inbound,
      completionSeconds: { n: Number(cs.n ?? 0), median: cs.median === null || cs.median === undefined ? null : Math.round(Number(cs.median)) },
      indexedChains: ((sum.indexed_chains as Row[]) ?? []).map((c) => ({ chain: String(c.chain), through: Number(c.through), throughTime: String(c.through_time) })),
      recent: rows.map(toView),
    };
  } catch (e) {
    return { ...base, reason: missing(e) ? "CCTP tables are not migrated yet (apply migrations 0034 and 0035)." : `CCTP store unreachable: ${(e as Error).message.slice(0, 120)}` };
  }
}
