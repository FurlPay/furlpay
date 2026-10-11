import { z } from "zod";

// ---------------------------------------------------------------------------
// Allium payloads -> FurlPay's canonical onchain event. PURE: no I/O.
//
// Two documented input shapes:
//
//  1. Beam / Datastreams ERC-20 transfer records (`erc20_token_transfer`
//     entity). Field names are Allium's documented transfer columns
//     (data catalog, <chain>.assets.erc20_token_transfers): transaction_hash,
//     log_index, block_number, block_hash, block_timestamp, from_address,
//     to_address, token_address, token_symbol, raw_amount_str, amount_str,
//     usd_amount, unique_id. The chain is not a column, so the Beam pipeline's
//     v8 transform stamps `chain` into the (signed) record; see
//     docs/ALLIUM_INTEGRATION.md.
//
//  2. Realtime API wallet transactions (POST /api/v1/developer/wallet/
//     transactions): items[].asset_transfers[] with transaction_hash,
//     log_index, from_address, to_address, asset{address,symbol,decimals},
//     amount{raw_amount, amount_str}.
//
// RULES
//  - Amounts come ONLY from the exact string fields (raw_amount_str /
//    raw_amount strings, amount_str). The float columns are never used for
//    value; a record without an exact amount is rejected, not rounded.
//  - Identity is deterministic: "<chain>:<tx_hash>:<log_index>", the same
//    identity as Allium's unique_id (tx hash + log index). A native transfer
//    has no log index; its identity is "<chain>:<tx_hash>:native:<from>:<to>:<raw>".
//  - Unknown chain ids, malformed hashes/addresses, negative or absurd values
//    are rejections with a reason (-> dead letter), never defaults.
// ---------------------------------------------------------------------------

export type ConfirmationState = "observed" | "confirmed" | "finalized";
export type Source = "allium_beam" | "allium_realtime_api" | "reconcile" | "node_rpc";

/** A normalized transfer before scope (who it belongs to) is resolved. */
export interface Transfer {
  event_key: string;
  source: Source;
  chain: string;
  tx_hash: string;
  block_number: number | null;
  block_hash: string | null;
  block_timestamp: string;
  log_index: number | null;
  from_address: string;
  to_address: string;
  asset_address: string | null;
  asset_symbol: string | null;
  asset_decimals: number | null;
  amount_raw: string | null;
  amount: string | null;
  amount_usd: string | null;
  activity_type: string;
  confirmation_state: ConfirmationState;
  provider_event_id: string | null;
  metadata: Record<string, unknown>;
}

export type Normalized = { ok: true; transfers: Transfer[] } | { ok: false; reason: string };

const CHAIN = /^[a-z0-9_-]{2,32}$/;
const EVM_ADDR = /^0x[0-9a-fA-F]{40}$/;
const EVM_HASH = /^0x[0-9a-fA-F]{64}$/;
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/; // Solana address
const B58_SIG = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/; // Solana signature
const UINT = /^\d{1,78}$/;
const DEC = /^\d{1,78}(\.\d{1,78})?$/;

/** EVM values are case-insensitive and stored lowercased; base58 is case-sensitive. */
function normAddr(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (EVM_ADDR.test(s)) return s.toLowerCase();
  if (B58.test(s)) return s;
  return null;
}
function normHash(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (EVM_HASH.test(s)) return s.toLowerCase();
  if (B58_SIG.test(s)) return s;
  return null;
}
function exactUint(v: unknown): string | null {
  if (typeof v === "string" && UINT.test(v.trim())) return v.trim().replace(/^0+(?=\d)/, "");
  return null;
}
function exactDec(v: unknown): string | null {
  if (typeof v === "string" && DEC.test(v.trim())) return v.trim();
  return null;
}
/** Provider USD is a float column; kept as a bounded decimal string for analytics only. */
function usd(v: unknown): string | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 && n < 1e15 ? n.toFixed(8) : null;
}
function ts(v: unknown): string | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  // Allium TIMESTAMP_NTZ values are UTC without an offset.
  const s = typeof v === "string" && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(v) ? `${v.replace(" ", "T")}Z` : v;
  const ms = typeof s === "number" ? (s > 1e12 ? s : s * 1000) : Date.parse(s);
  if (!Number.isFinite(ms)) return null;
  // Reject timestamps before 2009 or more than 10 minutes in the future.
  if (ms < Date.UTC(2009, 0, 3) || ms > Date.now() + 10 * 60_000) return null;
  return new Date(ms).toISOString();
}
const intOrNull = (v: unknown, max = Number.MAX_SAFE_INTEGER): number | null => {
  const n = typeof v === "string" && /^\d+$/.test(v) ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isInteger(n) && n >= 0 && n <= max ? n : null;
};
const sym = (v: unknown) => (typeof v === "string" && v.trim() && v.length <= 32 ? v.trim() : null);

const RAW_MAX = 8_000;
function rawCopy(raw: unknown): Record<string, unknown> {
  const s = JSON.stringify(raw);
  return s.length <= RAW_MAX ? { raw: JSON.parse(s) } : { raw_truncated: true, raw_bytes: s.length };
}

export function eventKey(chain: string, txHash: string, logIndex: number | null, native?: { from: string; to: string; raw: string | null }): string {
  if (logIndex !== null) return `${chain}:${txHash}:${logIndex}`.toLowerCase();
  return `${chain}:${txHash}:native:${native?.from ?? ""}:${native?.to ?? ""}:${native?.raw ?? ""}`.toLowerCase();
}

// ── 1. Beam / Datastreams erc20_token_transfer ──────────────────────────────

const beamRecord = z
  .object({
    chain: z.string().optional(),
    transaction_hash: z.string(),
    log_index: z.union([z.number(), z.string()]),
    block_number: z.union([z.number(), z.string()]).optional(),
    block_hash: z.string().nullish(),
    block_timestamp: z.union([z.string(), z.number()]),
    from_address: z.string(),
    to_address: z.string(),
    token_address: z.string().nullish(),
    token_symbol: z.string().nullish(),
    raw_amount_str: z.string().nullish(),
    amount_str: z.string().nullish(),
    usd_amount: z.union([z.number(), z.string()]).nullish(),
    unique_id: z.string().nullish(),
  })
  .passthrough();

export function normalizeBeamRecord(raw: unknown, opts: { chain?: string | null; zerolag: boolean }): Normalized {
  const p = beamRecord.safeParse(raw);
  if (!p.success) return { ok: false, reason: "record does not match the erc20_token_transfer contract" };
  const r = p.data;
  const chain = (r.chain ?? opts.chain ?? "").toLowerCase();
  if (!CHAIN.test(chain)) return { ok: false, reason: "record has no valid chain" };
  const tx = normHash(r.transaction_hash);
  const from = normAddr(r.from_address);
  const to = normAddr(r.to_address);
  const logIndex = intOrNull(r.log_index, 1_000_000);
  const when = ts(r.block_timestamp);
  const amountRaw = exactUint(r.raw_amount_str);
  const amount = exactDec(r.amount_str);
  if (!tx) return { ok: false, reason: "invalid transaction_hash" };
  if (!from || !to) return { ok: false, reason: "invalid from/to address" };
  if (logIndex === null) return { ok: false, reason: "invalid log_index" };
  if (!when) return { ok: false, reason: "invalid block_timestamp" };
  if (!amountRaw && !amount) return { ok: false, reason: "no exact amount (raw_amount_str / amount_str)" };
  const blockHash = r.block_hash ? normHash(r.block_hash) : null;
  return {
    ok: true,
    transfers: [
      {
        event_key: eventKey(chain, tx, logIndex),
        source: "allium_beam",
        chain,
        tx_hash: tx,
        block_number: r.block_number === undefined ? null : intOrNull(r.block_number),
        block_hash: blockHash,
        block_timestamp: when,
        log_index: logIndex,
        from_address: from,
        to_address: to,
        asset_address: r.token_address ? normAddr(r.token_address) : null,
        asset_symbol: sym(r.token_symbol),
        asset_decimals: null,
        amount_raw: amountRaw,
        amount,
        amount_usd: usd(r.usd_amount),
        activity_type: "transfer",
        // Datastreams/Beam deliver confirmed data by default; pre-finality only
        // when the pipeline is configured is_zerolag (docs: guides/finality).
        confirmation_state: opts.zerolag ? "observed" : "confirmed",
        provider_event_id: typeof r.unique_id === "string" ? r.unique_id.slice(0, 200) : null,
        // The provider record as received (bounded), for audit and replay.
        metadata: rawCopy(raw),
      },
    ],
  };
}

// ── 2. Realtime API wallet transactions ─────────────────────────────────────

const amountObj = z.object({ raw_amount: z.string().nullish(), amount_str: z.string().nullish() }).partial().nullish();
const walletItem = z
  .object({
    chain: z.string(),
    hash: z.string(),
    block_number: z.union([z.number(), z.string()]).nullish(),
    block_hash: z.string().nullish(),
    block_timestamp: z.string(),
    labels: z.array(z.string()).nullish(),
    asset_transfers: z
      .array(
        z.object({
          transfer_type: z.string().nullish(),
          operation: z.string().nullish(),
          transaction_hash: z.string().nullish(),
          log_index: z.union([z.number(), z.string()]).nullish(),
          from_address: z.string().nullish(),
          to_address: z.string().nullish(),
          asset: z
            .object({ type: z.string().nullish(), address: z.string().nullish(), symbol: z.string().nullish(), decimals: z.number().int().nullish() })
            .nullish(),
          amount: amountObj,
        })
      )
      .nullish(),
    activities: z.array(z.object({ type: z.string() }).passthrough()).nullish(),
  })
  .passthrough();

const ACTIVITY: Record<string, string> = { asset_bridge: "bridge", dex_trade: "swap", nft_trade: "nft_trade" };

/**
 * One wallet-transactions item -> its fungible transfers. NFTs are skipped
 * (no fungible amount), as are `invalid` transfers. The Realtime API serves
 * from the chain tip (may include later-reorged blocks), so these are
 * 'observed'; reconciliation promotes them once Allium's finality window has
 * passed and the block hash is unchanged.
 */
export function normalizeWalletItem(raw: unknown): Normalized {
  const p = walletItem.safeParse(raw);
  if (!p.success) return { ok: false, reason: "wallet transaction does not match the documented schema" };
  const it = p.data;
  const chain = it.chain.toLowerCase();
  if (!CHAIN.test(chain)) return { ok: false, reason: "invalid chain" };
  const tx = normHash(it.hash);
  const when = ts(it.block_timestamp);
  if (!tx || !when) return { ok: false, reason: "invalid hash or block_timestamp" };
  const kinds = (it.activities ?? []).map((a) => ACTIVITY[a.type]).filter(Boolean);
  const out: Transfer[] = [];
  for (const t of it.asset_transfers ?? []) {
    if (t.transfer_type === "invalid") continue;
    if (t.asset?.type && /erc721|erc1155/.test(t.asset.type)) continue;
    const from = normAddr(t.from_address);
    const to = normAddr(t.to_address);
    const raw = exactUint(t.amount?.raw_amount ?? null);
    const amount = exactDec(t.amount?.amount_str ?? null);
    if (!from || !to || (!raw && !amount)) continue;
    const logIndex = t.log_index === null || t.log_index === undefined ? null : intOrNull(t.log_index, 1_000_000);
    const activity = t.operation === "mint" || t.transfer_type === "minted" ? "mint" : t.operation === "burn" || t.transfer_type === "burned" ? "burn" : kinds[0] ?? "transfer";
    out.push({
      event_key: eventKey(chain, tx, logIndex, { from, to, raw }),
      source: "allium_realtime_api",
      chain,
      tx_hash: tx,
      block_number: it.block_number === null || it.block_number === undefined ? null : intOrNull(it.block_number),
      block_hash: it.block_hash ? normHash(it.block_hash) : null,
      block_timestamp: when,
      log_index: logIndex,
      from_address: from,
      to_address: to,
      asset_address: t.asset?.address ? normAddr(t.asset.address) : null,
      asset_symbol: sym(t.asset?.symbol),
      asset_decimals: t.asset?.decimals ?? null,
      amount_raw: raw,
      amount,
      amount_usd: null,
      activity_type: activity,
      confirmation_state: "observed",
      provider_event_id: null,
      metadata: it.labels?.length ? { labels: it.labels.slice(0, 20) } : {},
    });
  }
  return { ok: true, transfers: out };
}

// ── 3. A node's own Transfer logs (eth_getLogs) ─────────────────────────────

/** keccak256("Transfer(address,address,uint256)") — the ERC-20 Transfer topic. */
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const HEX = /^0x[0-9a-f]*$/;
const WORD = /^0x[0-9a-f]{64}$/;

export interface RpcLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string | null;
  blockHash: string | null;
  transactionHash: string | null;
  logIndex: string | null;
  removed?: boolean;
  /** Not in the base JSON-RPC spec; newer Geth/Reth include it. */
  blockTimestamp?: string;
}

/** Exact base units -> decimal string. String arithmetic only; never a float. */
export function formatUnits(raw: string, decimals: number): string {
  if (decimals === 0) return raw;
  const s = raw.padStart(decimals + 1, "0");
  const int = s.slice(0, -decimals);
  const frac = s.slice(-decimals).replace(/0+$/, "");
  return frac ? `${int}.${frac}` : int;
}

/**
 * One eth_getLogs entry -> a Transfer, straight from the chain's own client.
 * Same identity as Allium ("<chain>:<tx>:<log_index>"), so the node and the
 * provider deduplicate against each other and a disagreement between them is
 * a detectable conflict, not a second row.
 *
 * Rejects (null): `removed` logs, ERC-721 Transfers (tokenId is a 4th topic,
 * data is empty), and anything malformed. Amount comes from the 32-byte data
 * word as a BigInt; the decimal amount only when the token's decimals() was
 * read from the same node.
 */
export function normalizeTransferLog(
  chain: string,
  log: RpcLog,
  ctx: { blockTimestamp: string; finalizedBlock: bigint; token?: { decimals: number | null; symbol: string | null } }
): Transfer | null {
  if (log.removed) return null;
  const topics = (log.topics ?? []).map((t) => String(t).toLowerCase());
  if (topics.length !== 3 || topics[0] !== TRANSFER_TOPIC || !WORD.test(topics[1]) || !WORD.test(topics[2])) return null;
  const data = String(log.data ?? "").toLowerCase();
  if (!WORD.test(data)) return null;
  const tx = normHash(log.transactionHash);
  const blockHash = normHash(log.blockHash);
  const asset = normAddr(log.address);
  if (!tx || !blockHash || !asset || !log.blockNumber || !log.logIndex || !HEX.test(log.blockNumber) || !HEX.test(log.logIndex)) return null;
  const block = BigInt(log.blockNumber);
  const logIndex = Number(BigInt(log.logIndex));
  if (logIndex > 1_000_000) return null;
  const from = `0x${topics[1].slice(26)}`;
  const to = `0x${topics[2].slice(26)}`;
  // An address word must be zero-padded above its 20 bytes.
  if (!/^0x0{24}/.test(topics[1]) || !/^0x0{24}/.test(topics[2])) return null;
  const when = ts(ctx.blockTimestamp);
  if (!when) return null;
  const amountRaw = BigInt(data).toString();
  const decimals = ctx.token?.decimals ?? null;
  return {
    event_key: eventKey(chain, tx, logIndex),
    source: "node_rpc",
    chain,
    tx_hash: tx,
    block_number: Number(block),
    block_hash: blockHash,
    block_timestamp: when,
    log_index: logIndex,
    from_address: from,
    to_address: to,
    asset_address: asset,
    asset_symbol: ctx.token?.symbol ?? null,
    asset_decimals: decimals,
    amount_raw: amountRaw,
    amount: decimals === null ? null : formatUnits(amountRaw, decimals),
    // No price is invented: USD stays empty unless a source that observed one supplies it.
    amount_usd: null,
    activity_type: from === "0x0000000000000000000000000000000000000000" ? "mint" : to === "0x0000000000000000000000000000000000000000" ? "burn" : "transfer",
    confirmation_state: block <= ctx.finalizedBlock ? "finalized" : "observed",
    provider_event_id: null,
    metadata: rawCopy(log),
  };
}

// ── 4. A Solana node's own transaction (getTransaction, jsonParsed) ─────────

/** The parsed-instruction shape a Solana RPC returns with encoding "jsonParsed". */
export interface SolanaParsedIx {
  program?: string;
  programId?: string;
  parsed?: { type?: string; info?: Record<string, unknown> } | string;
}
export interface SolanaTokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  programId?: string;
  uiTokenAmount: { amount: string; decimals: number };
}
export interface SolanaTx {
  slot: number;
  blockTime: number | null;
  meta: {
    err: unknown;
    preTokenBalances?: SolanaTokenBalance[] | null;
    postTokenBalances?: SolanaTokenBalance[] | null;
    innerInstructions?: { index: number; instructions: SolanaParsedIx[] }[] | null;
  } | null;
  transaction: { signatures: string[]; message: { accountKeys: ({ pubkey: string } | string)[]; instructions: SolanaParsedIx[] } };
}

const SPL_PROGRAMS = new Set(["spl-token", "spl-token-2022"]);
const SPL_TRANSFERS = new Set(["transfer", "transferChecked", "transferCheckedWithFee"]);
const SOL_TRANSFERS = new Set(["transfer", "transferWithSeed"]);

/**
 * One Solana transaction -> its fungible transfers, from the chain's own
 * client. Solana has no event log: a transfer IS an executed instruction, so
 * this walks the top-level instructions and the inner (CPI) instructions in
 * execution order and keeps:
 *
 *   SPL Token / Token-2022  transfer, transferChecked, transferCheckedWithFee
 *                           (token ACCOUNTS are mapped to their owner WALLETS
 *                           through the transaction's own pre/post token
 *                           balances — the same node, the same transaction)
 *   System program          transfer, transferWithSeed (native SOL)
 *
 * Exact integers only: token amounts are the node's string amounts; lamports
 * must be a safe integer or the transfer is skipped (and counted). A failed
 * transaction moved nothing and yields nothing. Mint/burn/close are not
 * transfers and are not reported.
 *
 * Identity: Solana has no log index, so this uses the SAME native-style key as
 * the Allium path ("solana:<sig>:native:<from>:<to>:<raw>"), letting the node
 * and Allium deduplicate against each other. Two identical transfers in one
 * transaction get ":2", ":3"… in execution order.
 *
 * `confirmation_state`: slot <= the node's finalized slot -> finalized;
 * otherwise confirmed (the scanner reads at "confirmed" commitment, i.e.
 * supermajority-voted).
 */
export function normalizeSolanaTransaction(tx: SolanaTx, ctx: { finalizedSlot: number }): { transfers: Transfer[]; skipped: number } {
  const out: Transfer[] = [];
  let skipped = 0;
  const sig = normHash(tx.transaction?.signatures?.[0]);
  if (!sig || !tx.meta || tx.meta.err !== null) return { transfers: out, skipped };
  const when = tx.blockTime === null ? null : ts(tx.blockTime);
  if (!when || !Number.isSafeInteger(tx.slot) || tx.slot < 0) return { transfers: out, skipped: skipped + 1 };

  const keys = tx.transaction.message.accountKeys.map((k) => (typeof k === "string" ? k : k.pubkey));
  // token account -> owner/mint/decimals, as this transaction's balances report them
  const accounts = new Map<string, { owner: string | null; mint: string; decimals: number }>();
  for (const b of [...(tx.meta.preTokenBalances ?? []), ...(tx.meta.postTokenBalances ?? [])]) {
    const acct = keys[b.accountIndex];
    if (!acct || accounts.has(acct)) continue;
    accounts.set(acct, { owner: b.owner && B58.test(b.owner) ? b.owner : null, mint: b.mint, decimals: b.uiTokenAmount.decimals });
  }

  const ordered: SolanaParsedIx[] = [];
  const inner = new Map((tx.meta.innerInstructions ?? []).map((g) => [g.index, g.instructions]));
  tx.transaction.message.instructions.forEach((ix, i) => {
    ordered.push(ix, ...(inner.get(i) ?? []));
  });

  const seen = new Map<string, number>();
  const state: ConfirmationState = tx.slot <= ctx.finalizedSlot ? "finalized" : "confirmed";
  for (const ix of ordered) {
    if (!ix.parsed || typeof ix.parsed === "string" || !ix.parsed.type) continue;
    const info = ix.parsed.info ?? {};
    let from: string | null = null;
    let to: string | null = null;
    let raw: string | null = null;
    let mint: string | null = null;
    let decimals: number | null = null;
    let symbol: string | null = null;
    let detail: Record<string, unknown> = {};
    if (ix.program && SPL_PROGRAMS.has(ix.program) && SPL_TRANSFERS.has(ix.parsed.type)) {
      const src = typeof info.source === "string" ? accounts.get(info.source) : undefined;
      const dst = typeof info.destination === "string" ? accounts.get(info.destination) : undefined;
      const ta = info.tokenAmount as { amount?: unknown; decimals?: unknown } | undefined;
      raw = exactUint(ta?.amount ?? info.amount);
      mint = typeof info.mint === "string" ? info.mint : src?.mint ?? dst?.mint ?? null;
      decimals = typeof ta?.decimals === "number" ? ta.decimals : src?.decimals ?? dst?.decimals ?? null;
      // The OWNER wallet is the party; without it this would credit a token
      // account nobody tracks. An unresolvable side is skipped, not guessed.
      from = src?.owner ?? null;
      to = dst?.owner ?? null;
      detail = { source_account: info.source, destination_account: info.destination, program: ix.program, type: ix.parsed.type };
    } else if (ix.program === "system" && SOL_TRANSFERS.has(ix.parsed.type)) {
      const lamports = info.lamports;
      raw = typeof lamports === "number" && Number.isSafeInteger(lamports) && lamports >= 0 ? String(lamports) : null;
      from = typeof info.source === "string" ? info.source : null;
      to = typeof info.destination === "string" ? info.destination : null;
      decimals = 9;
      symbol = "SOL";
      detail = { program: "system", type: ix.parsed.type };
    } else continue;

    const f = normAddr(from);
    const t = normAddr(to);
    const asset = mint === null ? null : normAddr(mint);
    if (!f || !t || !raw || (mint !== null && !asset)) {
      skipped++;
      continue;
    }
    const base = eventKey("solana", sig, null, { from: f, to: t, raw });
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    out.push({
      event_key: n === 1 ? base : `${base}:${n}`,
      source: "node_rpc",
      chain: "solana",
      tx_hash: sig,
      block_number: tx.slot,
      // getTransaction does not return the block's hash; the scanner pins slots instead.
      block_hash: null,
      block_timestamp: when,
      log_index: null,
      from_address: f,
      to_address: t,
      asset_address: asset,
      asset_symbol: symbol,
      asset_decimals: decimals,
      amount_raw: raw,
      amount: decimals === null ? null : formatUnits(raw, decimals),
      amount_usd: null,
      activity_type: "transfer",
      confirmation_state: state,
      provider_event_id: null,
      metadata: detail,
    });
  }
  return { transfers: out, skipped };
}
