import { PublicKey } from "@solana/web3.js";
import { getChain } from "@/lib/services/chainRegistry";
import { CCTP_DOMAINS } from "@/lib/services/cctpExecution";
import { sbRpc, sbSelect, supabaseBackend } from "@/lib/supabase";
import { evmRpcFor } from "./balances";
import { getAsset } from "./assets";
import { indexerEvent, scrub } from "./indexerLog";
import { getLogsAdaptive, nodeChains, nodeRpc, nodeRpcBatch, usableTimestamp } from "./nodeIndexer";
import type { RpcLog } from "./normalize";

// ---------------------------------------------------------------------------
// Circle CCTP V2 — cross-chain USDC transfers as ONE indexed record each.
//
// Facts this module rests on (each verified on mainnet, 2026-10-07):
//   - TokenMessengerV2 0x28b5…cf5d and MessageTransmitterV2 0x81d4…4b64 are at
//     the same address on every EVM chain FurlPay indexes.
//   - DepositForBurn: topics [sig, burnToken, depositor, minFinalityThreshold];
//     data words [amount, mintRecipient, destinationDomain,
//     destinationTokenMessenger, destinationCaller, maxFee, hookData…].
//     V2 emits NO nonce on the source chain: Circle's Iris assigns it.
//   - Mint side: MintAndWithdraw (TokenMessenger; mintRecipient, mintToken
//     indexed; data [amount, feeCollected]) is emitted IMMEDIATELY BEFORE its
//     MessageReceived (MessageTransmitter; nonce indexed; data [sourceDomain,
//     sender, body…]) in the same transaction. MessageReceived alone is
//     generic messaging and is never treated as a mint: it must have body
//     version 1 and a paired MintAndWithdraw.
//   - minted + feeCollected = burned amount.
//   - usedNonces(bytes32) (selector 0xfeb61724) on the destination transmitter
//     returns 1 once the message is received — read at 'finalized' it proves
//     the destination leg without scanning the destination chain.
//   - Provider data at the chain TIP can differ from the sealed block (Base
//     served two different amounts for one log); FINALIZED blocks only.
//
// Pipeline (no dashboard-time scanning): finalized range -> raw events ->
// cctp_commit_range (CAS, dedup, burn/mint correlation) -> Iris attestation
// worker (exact field match, exponential backoff) -> destination verifier
// (indexed mint event, else usedNonces at finalized) -> finalized transfer.
// ---------------------------------------------------------------------------

export const TOKEN_MESSENGER_V2 = "0x28b5a0e9c621a5badaa536219b3a228c8168cf5d";
export const MESSAGE_TRANSMITTER_V2 = "0x81d40f21f12a8f0e3252bccb954d722d4c464b64";
export const TOPIC = {
  depositForBurn: "0x0c8c1cbdc5190613ebd485511d4e2812cfa45eecb79d845893331fedad5130a5",
  mintAndWithdraw: "0x50c55e915134d457debfa58eb6f4342956f8b0616d51a89a3659360178e1ab63",
  messageReceived: "0xff48c13eda96b1cceacc6b9edeedc9e9db9d6226afbc30146b720c19d3addb1c",
} as const;
const USED_NONCES = "0xfeb61724";
const IRIS = (process.env.CCTP_IRIS_API_URL || "https://iris-api.circle.com").replace(/\/+$/, "");

/** Circle domain <-> FurlPay chain, from the payment rails' verified table (cctpExecution) plus Solana (domain 5). */
export function domainOf(chain: string): number | null {
  if (chain === "solana") return 5;
  const d = (CCTP_DOMAINS as Record<string, number | undefined>)[chain];
  return d === undefined ? null : d;
}
export function chainOfDomain(domain: number): string | null {
  if (domain === 5) return "solana";
  const hit = Object.entries(CCTP_DOMAINS as Record<string, number>).find(([, d]) => d === domain);
  return hit ? hit[0] : null;
}

export { CCTP_DOMAIN_NAMES, domainName } from "./cctpDomains";

const word = (data: string, i: number) => data.slice(2 + i * 64, 2 + (i + 1) * 64);
const addrFromWord = (w: string) => (/^0{24}/.test(w) ? `0x${w.slice(24)}` : `0x${w}`); // EVM address, else the full 32 bytes (e.g. a Solana key)
const big = (w: string) => BigInt(`0x${w || "0"}`);
const lower = (s: string | null | undefined) => String(s ?? "").toLowerCase();

export interface BurnDecoded {
  burn_token: string;
  depositor: string;
  min_finality_threshold: number;
  amount: string;
  mint_recipient: string;
  destination_domain: number;
  destination_chain: string | null;
  max_fee: string;
}
/** Pure. Null for anything that is not a well-formed V2 DepositForBurn from TokenMessengerV2. */
export function decodeDepositForBurn(l: RpcLog): BurnDecoded | null {
  if (lower(l.address) !== TOKEN_MESSENGER_V2 || lower(l.topics?.[0]) !== TOPIC.depositForBurn || l.topics.length !== 4) return null;
  if (!/^0x[0-9a-f]*$/i.test(l.data ?? "") || (l.data.length - 2) / 64 < 8) return null;
  const d = l.data.toLowerCase();
  const dest = Number(big(word(d, 2)));
  if (!Number.isSafeInteger(dest) || dest > 0xffffffff) return null;
  return {
    burn_token: `0x${lower(l.topics[1]).slice(26)}`,
    depositor: `0x${lower(l.topics[2]).slice(26)}`,
    min_finality_threshold: Number(BigInt(l.topics[3])),
    amount: big(word(d, 0)).toString(),
    mint_recipient: addrFromWord(word(d, 1)),
    destination_domain: dest,
    destination_chain: chainOfDomain(dest),
    max_fee: big(word(d, 5)).toString(),
  };
}

export interface MintDecoded {
  nonce: string;
  source_domain: number;
  finality_threshold_executed: number;
  minted: string;
  fee: string;
  mint_recipient: string;
  mint_token: string;
}
/**
 * Pure. Pairs each MessageReceived (body version 1) with the MintAndWithdraw
 * immediately before it in the same transaction. Generic messages (no paired
 * mint, or another body version) are reported, never decoded as amounts.
 */
export function pairMints(txLogs: RpcLog[]): { mints: { log: RpcLog; decoded: MintDecoded }[]; generic: number } {
  const sorted = [...txLogs].sort((a, b) => Number(BigInt(a.logIndex ?? "0x0") - BigInt(b.logIndex ?? "0x0")));
  const out: { log: RpcLog; decoded: MintDecoded }[] = [];
  let generic = 0;
  let pending: RpcLog | null = null;
  for (const l of sorted) {
    const t0 = lower(l.topics?.[0]);
    if (lower(l.address) === TOKEN_MESSENGER_V2 && t0 === TOPIC.mintAndWithdraw && l.topics.length === 3) {
      pending = l;
      continue;
    }
    if (lower(l.address) === MESSAGE_TRANSMITTER_V2 && t0 === TOPIC.messageReceived && l.topics.length === 4) {
      const d = lower(l.data);
      const bodyVersion = d.length >= 2 + 5 * 64 + 8 ? d.slice(2 + 4 * 64, 2 + 4 * 64 + 8) : "";
      if (!pending || bodyVersion !== "00000001") {
        generic++;
        pending = null;
        continue;
      }
      const md = lower(pending.data);
      out.push({
        log: l,
        decoded: {
          nonce: lower(l.topics[2]),
          source_domain: Number(big(word(d, 0))),
          finality_threshold_executed: Number(BigInt(l.topics[3])),
          minted: big(word(md, 0)).toString(),
          fee: big(word(md, 1)).toString(),
          mint_recipient: `0x${lower(pending.topics[1]).slice(26)}`,
          mint_token: `0x${lower(pending.topics[2]).slice(26)}`,
        },
      });
      pending = null;
    }
  }
  return { mints: out, generic };
}

interface Block {
  number: string;
  hash: string;
  timestamp: string;
}
const hex = (n: bigint) => `0x${n.toString(16)}`;

export interface CctpScanReport {
  chain: string;
  status: "ok" | "caught_up" | "partial" | "failed" | "not_configured";
  reason?: string;
  finalized: number | null;
  cursorBefore: number | null;
  cursorAfter: number | null;
  commits: number;
  burns: number;
  mints: number;
  matched: number;
  generic: number;
  errors: string[];
}

/** One pass: commit finalized ranges of CCTP events for `chain` from its cursor. Never throws. */
export async function scanCctp(chain: string, opts: { deadline: () => boolean; rangeBlocks?: number }): Promise<CctpScanReport> {
  const r: CctpScanReport = { chain, status: "ok", finalized: null, cursorBefore: null, cursorAfter: null, commits: 0, burns: 0, mints: 0, matched: 0, generic: 0, errors: [] };
  const url = evmRpcFor(chain);
  const chainId = getChain(chain)?.chainId;
  const local = domainOf(chain);
  if (!url || !chainId || local === null) return { ...r, status: "not_configured", reason: !url ? `No RPC URL for ${chain}.` : `${chain} has no CCTP domain.` };
  if (supabaseBackend !== "supabase") return { ...r, status: "not_configured", reason: "No durable store (SUPABASE_URL)." };
  const usdc = getAsset("usdc")?.deployments[chain] ?? null;
  try {
    const id = Number(BigInt(await nodeRpc<string>(url, "eth_chainId", [])));
    if (id !== chainId) throw new Error(`endpoint answered chain id ${id}, expected ${chainId}`);
    const fin = await nodeRpc<Block | null>(url, "eth_getBlockByNumber", ["finalized", false]);
    if (!fin) throw new Error("node does not serve the 'finalized' block tag");
    const finN = BigInt(fin.number);
    r.finalized = Number(finN);
    const [cur] = await sbSelect<{ last_block: string | number }>("onchain_asset_cursors", `select=last_block&chain=eq.${encodeURIComponent(chain)}&asset=eq.cctp-v2&limit=1`);
    if (!cur) {
      await sbRpc("onchain_asset_anchor", { p_chain: chain, p_asset: "cctp-v2", p_contract: TOKEN_MESSENGER_V2, p_chain_id: chainId, p_block: Number(finN), p_hash: fin.hash.toLowerCase(), p_time: new Date(Number(BigInt(fin.timestamp)) * 1000).toISOString(), p_supply_raw: null, p_decimals: 6, p_provider: "node_rpc" });
      return { ...r, status: "caught_up", cursorAfter: Number(finN) };
    }
    let cursor = BigInt(cur.last_block);
    r.cursorBefore = Number(cursor);
    const span = BigInt(Math.max(1, opts.rangeBlocks ?? 500));
    while (cursor < finN) {
      if (opts.deadline()) {
        r.status = "partial";
        r.errors.push(`budget expired at block ${cursor + 1n}`);
        break;
      }
      const from = cursor + 1n;
      const to = from + span - 1n < finN ? from + span - 1n : finN;
      const logs = await getLogsAdaptive(url, { address: [TOKEN_MESSENGER_V2, MESSAGE_TRANSMITTER_V2], topics: [[TOPIC.depositForBurn, TOPIC.mintAndWithdraw, TOPIC.messageReceived]] }, from, to);
      const [parent, end] = await nodeRpcBatch<Block | null>(url, [cursor, to].map((n) => ({ method: "eth_getBlockByNumber", params: [hex(n), false] })));
      if (!parent || !end) throw new Error("node did not return a range header");
      // Block times: the log's own (when real), else one batched header read per event block (CCTP events are sparse).
      const needTs = [...new Set(logs.filter((l) => !usableTimestamp(l.blockTimestamp)).map((l) => BigInt(l.blockNumber!)))];
      const hdrs = needTs.length ? await nodeRpcBatch<Block | null>(url, needTs.map((n) => ({ method: "eth_getBlockByNumber", params: [hex(n), false] }))) : [];
      const ts = new Map<string, number>();
      needTs.forEach((n, i) => {
        const h = hdrs[i];
        if (!h) throw new Error(`node did not return header ${n}`);
        ts.set(hex(n), Number(BigInt(h.timestamp)));
      });
      const timeOf = (l: RpcLog) => new Date((usableTimestamp(l.blockTimestamp) ? Number(BigInt(l.blockTimestamp!)) : ts.get(hex(BigInt(l.blockNumber!)))!) * 1000).toISOString();
      const eventId = (l: RpcLog) => `${chain}:${lower(l.blockHash)}:${lower(l.transactionHash)}:${Number(BigInt(l.logIndex!))}`;
      const base = (l: RpcLog) => ({ event_id: eventId(l), block_number: Number(BigInt(l.blockNumber!)), block_hash: lower(l.blockHash), block_time: timeOf(l), tx_hash: lower(l.transactionHash), log_index: Number(BigInt(l.logIndex!)) });

      const events: Record<string, unknown>[] = [];
      const byTx = new Map<string, RpcLog[]>();
      for (const l of logs) {
        if (l.removed) continue;
        const k = lower(l.transactionHash);
        byTx.set(k, [...(byTx.get(k) ?? []), l]);
        const b = decodeDepositForBurn(l);
        // Only native USDC burns are USDC transfers (CCTP is USDC-only today; checked, not assumed).
        if (b && (!usdc || b.burn_token === usdc)) events.push({ ...base(l), kind: "deposit_for_burn", decoded: b });
      }
      for (const txLogs of byTx.values()) {
        const p = pairMints(txLogs);
        r.generic += p.generic;
        for (const m of p.mints) if (!usdc || m.decoded.mint_token === usdc) events.push({ ...base(m.log), kind: "mint_received", decoded: m.decoded });
      }
      const res = await sbRpc<{ ok: boolean; reason?: string; burns?: number; mints?: number; matched?: number }>("cctp_commit_range", {
        p_chain: chain,
        p_chain_id: chainId,
        p_local_domain: local,
        p_expected: Number(cursor),
        p_from: Number(from),
        p_to: Number(to),
        p_parent_hash: parent.hash.toLowerCase(),
        p_to_hash: end.hash.toLowerCase(),
        p_to_time: new Date(Number(BigInt(end.timestamp)) * 1000).toISOString(),
        p_events: events,
      });
      if (!res.ok) {
        if (res.reason === "stale_cursor") {
          r.status = "partial";
          r.errors.push("another worker advanced the cursor; resuming next pass");
          break;
        }
        if (res.reason === "parent_hash_mismatch") indexerEvent("indexer_reorg_detected", { indexer: "cctp", chain, block: Number(cursor) });
        throw new Error(`commit refused: ${res.reason}`);
      }
      r.commits++;
      r.burns += res.burns ?? 0;
      r.mints += res.mints ?? 0;
      r.matched += res.matched ?? 0;
      indexerEvent("block_indexed", { indexer: "cctp", chain, from: Number(from), to: Number(to), burns: res.burns, mints: res.mints, matched: res.matched });
      cursor = to;
    }
    r.cursorAfter = Number(cursor);
    if (r.status === "ok" && r.commits === 0) r.status = "caught_up";
  } catch (e) {
    r.status = "failed";
    r.errors.push(scrub((e as Error).message).slice(0, 200));
    indexerEvent("indexer_error", { indexer: "cctp", chain, error: r.errors.at(-1) });
  }
  return r;
}

// ── Attestation worker (Circle Iris) ────────────────────────────────────────

interface IrisMessage {
  status?: string;
  eventNonce?: string;
  decodedMessage?: {
    sourceDomain?: string;
    destinationDomain?: string;
    finalityThresholdExecuted?: string;
    minFinalityThreshold?: string;
    decodedMessageBody?: { mintRecipient?: string | null; amount?: string; maxFee?: string; feeExecuted?: string };
  };
}
export interface PendingTransfer {
  id: number;
  source_domain: number;
  destination_domain: number | null;
  source_tx_hash: string;
  source_log_index: number;
  amount_raw: string;
  mint_recipient: string;
  max_fee_raw: string;
  min_finality_threshold?: number | null;
}

/**
 * A mint recipient as its 32 raw bytes (hex), whatever the encoding: an EVM
 * address (left-padded), a 32-byte hex word, or base58 — Iris reports Solana
 * recipients base58 while the burn log carries the same bytes as hex
 * (verified 2026-10-07). Null when it is none of these.
 */
export function recipientBytes(v: string | null | undefined): string | null {
  const s = String(v ?? "").trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(s)) return s.slice(2).toLowerCase().padStart(64, "0");
  if (/^0x[0-9a-fA-F]{64}$/.test(s)) return s.slice(2).toLowerCase();
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)) {
    try {
      return Buffer.from(new PublicKey(s).toBytes()).toString("hex");
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Pure. Assigns Iris messages to the burns of ONE source transaction by exact
 * field equality: amount, destination domain, max fee, source domain, minimum
 * finality threshold and — when Iris reports one — the recipient compared as
 * raw bytes (Iris gives null for some non-EVM destinations, verified on
 * domain 27). Identical burns are paired in log order. A burn with no exact
 * match gets null — never "the closest" message.
 */
export function matchIris(burns: PendingTransfer[], messages: IrisMessage[]): Map<number, IrisMessage | null> {
  const used = new Set<number>();
  const out = new Map<number, IrisMessage | null>();
  for (const b of [...burns].sort((x, y) => x.source_log_index - y.source_log_index)) {
    const i = messages.findIndex((m, k) => {
      if (used.has(k)) return false;
      const body = m.decodedMessage?.decodedMessageBody;
      const irisRecipient = body?.mintRecipient ?? null;
      const recipientOk = irisRecipient === null ? true : recipientBytes(irisRecipient) !== null && recipientBytes(irisRecipient) === recipientBytes(b.mint_recipient);
      const finOk = b.min_finality_threshold == null || m.decodedMessage?.minFinalityThreshold === undefined || Number(m.decodedMessage.minFinalityThreshold) === b.min_finality_threshold;
      return (
        String(body?.amount ?? "") === String(b.amount_raw) &&
        recipientOk &&
        finOk &&
        Number(m.decodedMessage?.destinationDomain) === b.destination_domain &&
        String(body?.maxFee ?? "") === String(b.max_fee_raw) &&
        Number(m.decodedMessage?.sourceDomain) === b.source_domain
      );
    });
    if (i >= 0) used.add(i);
    out.set(b.id, i >= 0 ? messages[i] : null);
  }
  return out;
}

/** Process due attestations (oldest first, bounded). Never throws. */
export async function processAttestations(opts: { deadline: () => boolean; limit?: number }): Promise<{ checked: number; complete: number; pending: number; errors: string[] }> {
  const out = { checked: 0, complete: 0, pending: 0, errors: [] as string[] };
  if (supabaseBackend !== "supabase") return out;
  try {
    const due = await sbSelect<PendingTransfer>(
      "cctp_transfers",
      `select=id,source_domain,destination_domain,source_tx_hash,source_log_index,amount_raw,mint_recipient,max_fee_raw,min_finality_threshold&status=in.(burn_confirmed,attestation_pending)&attestation_next_at=lte.${encodeURIComponent(new Date().toISOString())}&order=attestation_next_at.asc&limit=${opts.limit ?? 20}`
    );
    const byTx = new Map<string, PendingTransfer[]>();
    for (const t of due) byTx.set(`${t.source_domain}:${t.source_tx_hash}`, [...(byTx.get(`${t.source_domain}:${t.source_tx_hash}`) ?? []), t]);
    for (const burns of byTx.values()) {
      if (opts.deadline()) break;
      const { source_domain, source_tx_hash } = burns[0];
      let messages: IrisMessage[] = [];
      let err: string | null = null;
      try {
        const res = await fetch(`${IRIS}/v2/messages/${source_domain}?transactionHash=${source_tx_hash}`, { signal: AbortSignal.timeout(8_000), cache: "no-store" });
        if (res.status === 404) err = "Iris has no message for this transaction yet";
        else if (!res.ok) err = `Iris responded ${res.status}`;
        else messages = ((await res.json()) as { messages?: IrisMessage[] }).messages ?? [];
      } catch (e) {
        err = `Iris unreachable: ${scrub((e as Error).message).slice(0, 80)}`;
      }
      const matched = matchIris(burns, messages);
      for (const b of burns) {
        out.checked++;
        const m = matched.get(b.id) ?? null;
        const nonce = m?.eventNonce && /^0x[0-9a-f]{64}$/i.test(m.eventNonce) ? m.eventNonce.toLowerCase() : null;
        const fee = m?.decodedMessage?.decodedMessageBody?.feeExecuted;
        const r = await sbRpc<string>("cctp_apply_attestation", {
          p_id: b.id,
          p_matched: Boolean(m && nonce),
          p_status: m?.status ?? null,
          p_nonce: nonce,
          p_executed_fee: fee && /^\d+$/.test(fee) ? fee : null,
          p_fin_executed: m?.decodedMessage?.finalityThresholdExecuted ? Number(m.decodedMessage.finalityThresholdExecuted) : null,
          p_error: err,
        });
        if (r === "complete") out.complete++;
        else out.pending++;
      }
    }
  } catch (e) {
    out.errors.push(scrub((e as Error).message).slice(0, 200));
  }
  return out;
}

// ── Destination verifier ────────────────────────────────────────────────────

/**
 * For attested transfers: usedNonces(nonce) on the destination
 * MessageTransmitterV2 at its FINALIZED block (one eth_call). If the
 * destination chain is also indexed, its mint event later attaches the exact
 * transaction, minted amount and fee to the same transfer. Destinations
 * without an RPC (e.g. Solana here) stay "awaiting destination". Never throws.
 */
export async function processDestinations(opts: { deadline: () => boolean; limit?: number }): Promise<{ checked: number; verified: number; waiting: number; errors: string[] }> {
  const out = { checked: 0, verified: 0, waiting: 0, errors: [] as string[] };
  if (supabaseBackend !== "supabase") return out;
  try {
    const cutoff = new Date(Date.now() - 120_000).toISOString();
    const due = await sbSelect<{ id: number; destination_domain: number; nonce: string }>(
      "cctp_transfers",
      `select=id,destination_domain,nonce&status=eq.attestation_complete&or=(destination_checked_at.is.null,destination_checked_at.lt.${encodeURIComponent(cutoff)})&order=updated_at.asc&limit=${opts.limit ?? 20}`
    );
    for (const t of due) {
      if (opts.deadline()) break;
      out.checked++;
      const dest = chainOfDomain(t.destination_domain);
      const url = dest && dest !== "solana" ? evmRpcFor(dest) : null;
      if (!dest || !url) {
        // No way to read the destination chain here: it stays unverified, never assumed — and says why.
        const reason = !dest
          ? `destination CCTP domain ${t.destination_domain} is not a chain FurlPay maps; cannot verify the mint`
          : dest === "solana"
            ? "destination is Solana; FurlPay does not verify Solana CCTP mints yet"
            : `no RPC configured for ${dest}; cannot verify the mint`;
        await sbRpc("cctp_apply_used_nonce", { p_id: t.id, p_used: false, p_chain: dest, p_reason: reason }).catch(() => {});
        out.waiting++;
        continue;
      }
      try {
        const v = await nodeRpc<string>(url, "eth_call", [{ to: MESSAGE_TRANSMITTER_V2, data: `${USED_NONCES}${t.nonce.slice(2)}` }, "finalized"]);
        const used = /^0x0*1$/i.test(v);
        const r = await sbRpc<string>("cctp_apply_used_nonce", { p_id: t.id, p_used: used, p_chain: dest });
        if (r === "finalized") out.verified++;
        else out.waiting++;
      } catch (e) {
        out.errors.push(scrub((e as Error).message).slice(0, 120));
      }
    }
  } catch (e) {
    out.errors.push(scrub((e as Error).message).slice(0, 200));
  }
  return out;
}

/** CCTP indexing for every opted-in EVM chain that has a CCTP domain, then the two workers. */
export async function runCctp(opts: { deadline: () => boolean; only?: string[] }) {
  const scans: CctpScanReport[] = [];
  for (const chain of nodeChains()) {
    if (chain === "solana" || (opts.only && !opts.only.includes(chain)) || domainOf(chain) === null) continue;
    if (opts.deadline()) break;
    scans.push(await scanCctp(chain, opts));
  }
  const attestations = await processAttestations(opts);
  const destinations = await processDestinations(opts);
  return { scans, attestations, destinations };
}
