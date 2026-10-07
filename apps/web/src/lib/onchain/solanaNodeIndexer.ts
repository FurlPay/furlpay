import { PublicKey } from "@solana/web3.js";
import { sbRpc, sbSelect, sbUpdate, sbUpsert, supabaseBackend } from "@/lib/supabase";
import { log } from "@/lib/log";
import { solanaRpc } from "./balances";
import { normalizeSolanaTransaction, type SolanaTx, type Transfer } from "./normalize";
import { persist, scopeTransfers, touchSource, trackedAddresses, ZERO_COUNTS } from "./ingest";
import { nodeRpc, type NodeScanReport } from "./nodeIndexer";
import { classifyContract } from "./assets";
import { indexerEvent } from "./indexerLog";

// ---------------------------------------------------------------------------
// Direct-to-node source for Solana: the validator's own JSON-RPC (an Agave or
// Firedancer RPC node the operator runs, or any endpoint in SOLANA_RPC_URL),
// through the same scope + onchain_ingest path as the EVM node and Allium.
//
// Solana has no eth_getLogs. What a node CAN answer exactly is "which
// transactions touched this account" (getSignaturesForAddress) and "what did
// this transaction execute" (getTransaction, jsonParsed). So each pass:
//
//   1. pins the endpoint by its genesis hash (Solana has no chain id);
//   2. reads the finalized and confirmed slots from the node itself;
//   3. lists every tracked wallet AND its token accounts — an incoming SPL
//      transfer to an existing token account does not mention the wallet, so
//      scanning the wallet alone silently misses deposits;
//   4. pages signatures back to the cursor at "confirmed" commitment and
//      fetches each successful transaction oldest-first;
//   5. normalizes instructions (normalize.ts §4), scopes, persists;
//   6. advances ONE chain cursor (onchain_node_cursors, chain "solana") to the
//      newest finalized slot below which every signature was processed —
//      never past an unprocessed one, never backwards (compare-and-set).
//
// Everything above the cursor is re-read every pass, so "confirmed" events are
// promoted to "finalized" by onchain_ingest when their slot roots.
// ---------------------------------------------------------------------------

const PAGE = 1_000;
const MAX_PAGES = 10;
const DEFAULT_MAX_TX = 400;

interface SigInfo {
  signature: string;
  slot: number;
  err: unknown;
  transactionIndex?: number;
}

/** A configured Solana address list entry, validated as a real public key (AGENTS rule 9). */
function isSolanaKey(v: string): boolean {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v)) return false;
  try {
    new PublicKey(v);
    return true;
  } catch {
    return false;
  }
}

export interface TokenAccount {
  account: string;
  owner: string;
  mint: string;
  program: string;
  amount: string | null;
  decimals: number | null;
  slot: number | null;
}

/**
 * Token accounts a wallet owns under BOTH token programs: the associated
 * token account and any others (a wallet may hold several per mint), with the
 * balance the node reports for each.
 */
export async function tokenAccounts(url: string, owner: string): Promise<TokenAccount[]> {
  const programs = ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"];
  type Parsed = { context?: { slot?: number }; value: { pubkey: string; account?: { data?: { parsed?: { info?: { mint?: string; tokenAmount?: { amount?: string; decimals?: number } } } } } }[] };
  const res = await Promise.all(programs.map((programId) => nodeRpc<Parsed>(url, "getTokenAccountsByOwner", [owner, { programId }, { encoding: "jsonParsed", commitment: "confirmed" }])));
  return res.flatMap((r, i) =>
    r.value.map((a) => {
      const info = a.account?.data?.parsed?.info;
      const amount = info?.tokenAmount?.amount;
      return {
        account: a.pubkey,
        owner,
        mint: info?.mint ?? "",
        program: programs[i],
        amount: typeof amount === "string" && /^\d+$/.test(amount) ? amount : null,
        decimals: info?.tokenAmount?.decimals ?? null,
        slot: r.context?.slot ?? null,
      };
    })
  );
}

/** Above this many token accounts, a wallet's scan is limited to registry-asset accounts. */
const MAX_TOKEN_ACCOUNTS_PER_WALLET = 50;

/** Keep scanning an account for this long after the owner's list stops returning it (closed or moved). */
const GONE_GRACE_MS = 7 * 24 * 3600_000;
const missingTable = (e: unknown) => /does not exist|PGRST205|Could not find the table|42P01/i.test((e as Error).message);

/**
 * Token accounts seen before for these owners and not gone for longer than
 * the grace period. Scanning them keeps the last transfers into an account
 * that has since been CLOSED: such a transfer does not mention the wallet, and
 * the closed account no longer appears in getTokenAccountsByOwner.
 */
async function knownTokenAccounts(owners: string[], now: number): Promise<{ account: string; owner: string; gone_at: string | null }[]> {
  if (owners.length === 0) return [];
  try {
    return await sbSelect(
      "onchain_solana_token_accounts",
      `select=account,owner,gone_at&owner=in.(${owners.map(encodeURIComponent).join(",")})&or=(gone_at.is.null,gone_at.gt.${encodeURIComponent(new Date(now - GONE_GRACE_MS).toISOString())})&limit=5000`
    );
  } catch (e) {
    if (missingTable(e)) return [];
    throw e;
  }
}

/** Remember current accounts and balances; mark previously known ones that disappeared. Non-fatal. */
async function rememberTokenAccounts(current: TokenAccount[], known: { account: string; gone_at: string | null }[], now: number, stillOwned: Set<string>): Promise<number> {
  const nowIso = new Date(now).toISOString();
  // "Gone" means the node no longer lists it for the owner — not merely that this pass skipped it.
  const cur = stillOwned;
  const gone = known.filter((k) => !cur.has(k.account) && k.gone_at === null).map((k) => k.account);
  try {
    if (current.length) {
      await sbUpsert("onchain_solana_token_accounts", current.map((a) => ({ account: a.account, owner: a.owner, mint: a.mint, program: a.program, last_seen_at: nowIso, gone_at: null })));
      const balances = current.filter((a) => a.amount !== null && a.decimals !== null && a.slot !== null);
      if (balances.length)
        await sbUpsert(
          "onchain_wallet_balances",
          balances.map((a) => ({ chain: "solana", account: a.account, owner: a.owner, asset: classifyContract("solana", a.mint)?.id ?? a.mint, amount_raw: a.amount, decimals: a.decimals, at_block: a.slot, observed_at: nowIso }))
        );
    }
    for (const g of gone) await sbUpdate("onchain_solana_token_accounts", `account=eq.${encodeURIComponent(g)}&gone_at=is.null`, { gone_at: nowIso });
  } catch (e) {
    if (!missingTable(e)) log.warn("solana token-account bookkeeping failed", { error: (e as Error).message.slice(0, 160) });
  }
  return gone.length;
}

async function walletTouch(ok: boolean, f: { head: number | null; finalized: number | null; indexed: number | null; error?: string; detail: Record<string, unknown> }) {
  await sbRpc("onchain_indexer_touch", {
    p_indexer: "wallet",
    p_chain: "solana",
    p_asset: "",
    p_ok: ok,
    p_head: f.head,
    p_head_time: null,
    p_finalized: f.finalized,
    p_indexed: f.indexed,
    p_indexed_time: null,
    p_error: f.error ?? null,
    p_duration_ms: null,
    p_detail: f.detail,
  }).catch(() => {});
}

/** Every signature touching `account` with slot >= fromSlot, or `complete: false` when the backlog exceeds the page budget. */
async function signaturesSince(url: string, account: string, fromSlot: number): Promise<{ sigs: SigInfo[]; complete: boolean }> {
  const out: SigInfo[] = [];
  let before: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const batch = await nodeRpc<SigInfo[]>(url, "getSignaturesForAddress", [account, { limit: PAGE, commitment: "confirmed", ...(before ? { before } : {}) }]);
    for (const s of batch) if (s.slot >= fromSlot) out.push(s);
    if (batch.length < PAGE || batch[batch.length - 1].slot < fromSlot) return { sigs: out, complete: true };
    before = batch[batch.length - 1].signature;
  }
  return { sigs: out, complete: false };
}

export async function scanSolana(opts: { deadline: () => boolean; maxTransactions?: number; fromSlot?: number }): Promise<NodeScanReport> {
  const report: NodeScanReport = {
    chain: "solana",
    status: "ok",
    from: null,
    to: null,
    head: null,
    finalized: null,
    scannedThrough: null,
    addresses: 0,
    logs: 0,
    counts: { ...ZERO_COUNTS },
    markedReorged: 0,
    unverified: 0,
    cursorAdvanced: false,
    errors: [],
  };
  const url = solanaRpc();
  if (!url) return { ...report, status: "not_configured", reason: "No RPC URL for solana (SOLANA_RPC_URL)." };
  if (supabaseBackend !== "supabase") return { ...report, status: "not_configured", reason: "No durable store (SUPABASE_URL)." };

  try {
    // 1. Pin the endpoint to the cluster it served before.
    const genesis = await nodeRpc<string>(url, "getGenesisHash", []);
    const [cursor] = await sbSelect<{ last_block: number | string; genesis_hash: string | null }>("onchain_node_cursors", "select=last_block,genesis_hash&chain=eq.solana&limit=1");
    if (cursor && cursor.genesis_hash !== genesis) throw new Error(`solana is pinned to genesis ${cursor.genesis_hash}, endpoint answered ${genesis}`);

    // 2. Where the cluster is — from the node.
    const [finalized, head] = await Promise.all([nodeRpc<number>(url, "getSlot", [{ commitment: "finalized" }]), nodeRpc<number>(url, "getSlot", [{ commitment: "confirmed" }])]);
    report.finalized = finalized;
    report.head = head;
    const cursorSlot = cursor ? Number(cursor.last_block) : null;
    // No cursor yet: start at the finalized tip (history is a backfill, not a side effect).
    const from = opts.fromSlot ?? (cursorSlot !== null ? cursorSlot + 1 : finalized + 1);
    report.from = from;
    report.to = head;

    // 3. Who to look for: tracked wallets plus the token accounts they own.
    const wallets = [...new Set((await trackedAddresses()).filter((t) => t.chains !== "evm" && t.chains.includes("solana") && isSolanaKey(t.address)).map((t) => t.address))];
    report.addresses = wallets.length;
    const accounts = new Set(wallets);
    const now = Date.now();
    const current: TokenAccount[] = [];
    const capped: string[] = [];
    const stillOwned = new Set<string>();
    for (const w of wallets) {
      const all = await tokenAccounts(url, w);
      for (const a of all) stillOwned.add(a.account);
      // A program or exchange wallet can own thousands of token accounts;
      // scanning each every pass is impractical (and a spread of that many
      // arguments overflows the stack). Above the cap, only accounts of
      // registry assets (USDC) are scanned — and the report says so.
      const keep = all.length > MAX_TOKEN_ACCOUNTS_PER_WALLET ? all.filter((a) => classifyContract("solana", a.mint) !== null) : all;
      if (keep.length < all.length) capped.push(`${w.slice(0, 8)}… has ${all.length} token accounts; scanning the ${keep.length} of registry assets only`);
      for (const a of keep) current.push(a);
    }
    for (const c of capped) report.errors.push(c);
    const known = await knownTokenAccounts(wallets, now);
    for (const a of current) accounts.add(a.account);
    // Known accounts: since-closed ones within the grace period, plus (for a capped wallet) only registry-asset ones.
    for (const k of known) if (!stillOwned.has(k.account) || current.some((c) => c.account === k.account)) accounts.add(k.account);
    const newlyGone = await rememberTokenAccounts(current, known, now, stillOwned);
    report.detail = { wallets: wallets.length, tokenAccounts: current.length, knownGoneAccounts: known.filter((k) => !stillOwned.has(k.account)).length, newlyGone, cappedWallets: capped.length };

    // 4. Signatures since the cursor, deduplicated across accounts.
    const bySig = new Map<string, SigInfo>();
    let listed = true;
    for (const a of accounts) {
      if (opts.deadline()) {
        listed = false;
        report.errors.push("budget expired while listing signatures");
        break;
      }
      const { sigs, complete } = await signaturesSince(url, a, from);
      if (!complete) {
        listed = false;
        report.errors.push(`more than ${PAGE * MAX_PAGES} signatures since slot ${from} for ${a.slice(0, 8)}…; run a node backfill with fromBlock`);
      }
      for (const s of sigs) bySig.set(s.signature, s);
    }
    const ordered = [...bySig.values()].sort((x, y) => x.slot - y.slot || (x.transactionIndex ?? 0) - (y.transactionIndex ?? 0));
    report.logs = ordered.length;

    // 5. Fetch oldest-first. `safeThrough` = newest slot whose signatures were
    // ALL processed; a cut-off stops it below the first unprocessed slot.
    const maxTx = Math.max(1, opts.maxTransactions ?? DEFAULT_MAX_TX);
    const transfers: Transfer[] = [];
    let fetched = 0;
    let safeThrough = listed ? head : null;
    let skipped = 0;
    for (const s of ordered) {
      if (s.err !== null && s.err !== undefined) continue; // a failed transaction moved nothing
      if (fetched >= maxTx || opts.deadline()) {
        safeThrough = s.slot - 1;
        report.errors.push(fetched >= maxTx ? `transaction budget reached (${maxTx})` : `budget expired at slot ${s.slot}`);
        break;
      }
      fetched++;
      const tx = await nodeRpc<SolanaTx | null>(url, "getTransaction", [s.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }]);
      if (!tx) {
        // Listed but not served yet: stop here so the next pass re-reads it.
        safeThrough = s.slot - 1;
        report.errors.push(`transaction ${s.signature.slice(0, 12)}… not served yet`);
        break;
      }
      const n = normalizeSolanaTransaction(tx, { finalizedSlot: finalized });
      transfers.push(...n.transfers);
      skipped += n.skipped;
    }
    if (skipped > 0) report.errors.push(`${skipped} transfer(s) without an exact amount or a resolvable owner were skipped`);
    if (!listed || (safeThrough !== null && safeThrough < head)) report.status = "partial";
    report.scannedThrough = safeThrough !== null && safeThrough >= from ? safeThrough : null;

    // 6. One write path: scope, OFAC screen, onchain_ingest.
    const { scoped } = await scopeTransfers(transfers);
    report.counts = await persist(scoped);

    // 7. Stored node events in the finalized part of the window that the node
    // did not return this pass: counted for operators, never altered here.
    const finalScanned = safeThrough === null ? null : Math.min(safeThrough, finalized);
    if (finalScanned !== null && finalScanned >= from) {
      const returned = new Set(transfers.map((t) => t.event_key));
      const stored = await sbSelect<{ event_key: string }>(
        "onchain_events",
        `select=event_key&chain=eq.solana&source=eq.node_rpc&block_number=gte.${from}&block_number=lte.${finalScanned}&confirmation_state=neq.reorged&limit=5000`
      );
      report.unverified = stored.filter((s) => !returned.has(s.event_key)).length;
    }

    // 8. Advance the cursor over the finalized, fully processed part only.
    if (opts.fromSlot === undefined) {
      const next = finalScanned !== null && finalScanned >= from ? finalScanned : cursorSlot === null ? finalized : null;
      if (next !== null && (cursorSlot === null || next > cursorSlot)) {
        const block = await nodeRpc<{ blockhash: string }>(url, "getBlock", [next, { transactionDetails: "none", rewards: false, commitment: "finalized", maxSupportedTransactionVersion: 0 }]).catch(() => null);
        report.cursorAdvanced = await sbRpc<boolean>("onchain_node_cursor_advance", {
          p_chain: "solana",
          p_chain_id: null,
          p_expected: cursorSlot,
          p_next: next,
          // A skipped slot has no block; the slot number is then the record.
          p_hash: block?.blockhash ?? `skipped:${next}`,
          p_genesis: genesis,
        });
      }
    }

    const tip = await nodeRpc<number | null>(url, "getBlockTime", [finalized]).catch(() => null);
    await touchSource("node:solana", true, { dataAt: tip ? new Date(tip * 1000).toISOString() : null });
    if (report.cursorAdvanced) indexerEvent("indexer_checkpoint_saved", { indexer: "wallet", chain: "solana", slot: report.scannedThrough ?? finalized });
    indexerEvent("solana_slot_indexed", { indexer: "wallet", from, through: report.scannedThrough, head, finalized, signatures: report.logs, inserted: report.counts.inserted, status: report.status, ...report.detail });
    await walletTouch(true, { head, finalized, indexed: report.scannedThrough, detail: report.detail ?? {} });
  } catch (e) {
    const msg = (e as Error).message.slice(0, 200);
    report.status = "failed";
    report.errors.push(msg);
    indexerEvent("indexer_error", { indexer: "wallet", chain: "solana", error: msg });
    await touchSource("node:solana", false, { error: msg });
    await walletTouch(false, { head: report.head, finalized: report.finalized, indexed: null, error: msg, detail: {} });
  }
  return report;
}
