import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixtures from "./fixtures/solana-mainnet-txs.json";

// Direct-to-node Solana source. The two transactions in fixtures/ are REAL
// (Solana mainnet, slot 454142535, read 2026-10-07); the scan tests run the
// real scanSolana against a scripted JSON-RPC node.

const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
const db = {
  cursor: null as null | { last_block: number; genesis_hash: string | null },
  stored: [] as Record<string, unknown>[],
  known: [] as { account: string; owner: string; gone_at: string | null }[],
  upserts: [] as { table: string; rows: Record<string, unknown>[] }[],
  updates: [] as { table: string; query: string; patch: Record<string, unknown> }[],
};

vi.mock("@/lib/supabase", async (orig) => ({
  ...(await orig<typeof import("@/lib/supabase")>()),
  supabaseBackend: "supabase",
  sbRpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
    rpcCalls.push({ fn, args });
    if (fn === "onchain_ingest") return { inserted: (args.p_events as unknown[]).length, duplicates: 0, promoted: 0, reorg_replaced: 0, reinstated: 0, conflicts: 0, blocked_keys: [] };
    if (fn === "onchain_node_cursor_advance") {
      db.cursor = { last_block: Number(args.p_next), genesis_hash: String(args.p_genesis) };
      return true;
    }
    return true;
  }),
  sbSelect: vi.fn(async (table: string) => {
    if (table === "onchain_node_cursors") return db.cursor ? [db.cursor] : [];
    if (table === "onchain_events") return db.stored;
    if (table === "onchain_solana_token_accounts") return db.known;
    return [];
  }),
  sbUpsert: vi.fn(async (table: string, rows: Record<string, unknown>[]) => {
    db.upserts.push({ table, rows });
    return rows;
  }),
  sbUpdate: vi.fn(async (table: string, query: string, patch: Record<string, unknown>) => {
    db.updates.push({ table, query, patch });
    return [];
  }),
}));
vi.mock("@/lib/kv", async (orig) => ({ ...(await orig<typeof import("@/lib/kv")>()), kvSet: vi.fn(async () => undefined) }));
vi.mock("@/lib/ops/events", () => ({ recordSecurityEvent: vi.fn(async () => undefined) }));
vi.mock("@/lib/linkedWalletStore", () => ({ findLinkedWalletOwner: vi.fn(async () => null) }));

import { normalizeSolanaTransaction, type SolanaTx } from "../normalize";
import { scanSolana } from "../solanaNodeIndexer";
import { nodeChains, scanNodes } from "../nodeIndexer";

const TOP = fixtures.transferChecked_top as unknown as SolanaTx;
const INNER = fixtures.transferChecked_inner as unknown as SolanaTx;
const SIG_TOP = TOP.transaction.signatures[0];
const SIG_INNER = INNER.transaction.signatures[0];
const SLOT = 454142535;
const GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
// Receiver in TOP: wallet 3bick… owns token account 6FLeo….
const WALLET = "3bickQtS7Xw6eYnXEEkZrVwcWsbJKhTdCLLmLv6pDWaq";
const WALLET_ATA = "6FLeo53zFGdo6JMnsNCvCbN6S9Mm1UJXCTkKHPbktfhN";

describe("normalizeSolanaTransaction (REAL mainnet transactions)", () => {
  it("top-level transferChecked: token accounts resolve to owner wallets, amount exact", () => {
    const { transfers, skipped } = normalizeSolanaTransaction(TOP, { finalizedSlot: SLOT });
    expect(skipped).toBe(0);
    expect(transfers).toHaveLength(1);
    const t = transfers[0];
    expect(t.from_address).toBe("GachaNgyXTU3zFogQ8Z5jR2BLXs8215X2AtEH18VxJq3");
    expect(t.to_address).toBe(WALLET);
    expect(t.asset_address).toBe("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    expect(t.amount_raw).toBe("33300000");
    expect(t.amount).toBe("33.3");
    expect(t.asset_decimals).toBe(6);
    expect(t.block_number).toBe(SLOT);
    expect(t.block_timestamp).toBe(new Date(1791354552 * 1000).toISOString());
    expect(t.confirmation_state).toBe("finalized");
    expect(t.amount_usd).toBeNull();
    expect(t.source).toBe("node_rpc");
    // Allium's native-style identity, so the two sources deduplicate.
    expect(t.event_key).toBe(`solana:${SIG_TOP}:native:${t.from_address}:${WALLET}:33300000`.toLowerCase());
  });
  it("inner (CPI) transferChecked is found in execution order", () => {
    const { transfers } = normalizeSolanaTransaction(INNER, { finalizedSlot: SLOT - 1 });
    expect(transfers).toHaveLength(1);
    expect(transfers[0].from_address).toBe("2AgtbNBrq67HBdNthZUH3CDbDdKh5BueFx1mbT75peik");
    expect(transfers[0].to_address).toBe("7uTT8Xi5RWXzy7h9XL244GRgEycDYDhLjr3ZyNdXi8pZ");
    expect(transfers[0].amount_raw).toBe("17152238");
    expect(transfers[0].confirmation_state).toBe("confirmed"); // above the finalized slot
  });
  it("a failed transaction moved nothing", () => {
    const failed = { ...TOP, meta: { ...TOP.meta!, err: { InstructionError: [2, { Custom: 1 }] } } };
    expect(normalizeSolanaTransaction(failed, { finalizedSlot: SLOT }).transfers).toEqual([]);
  });
  it("skips (and counts) a side whose owner the transaction does not report, never guessing", () => {
    const noOwner = { ...TOP, meta: { ...TOP.meta!, preTokenBalances: TOP.meta!.preTokenBalances!.map((b) => ({ ...b, owner: undefined })), postTokenBalances: [] } };
    const r = normalizeSolanaTransaction(noOwner, { finalizedSlot: SLOT });
    expect(r.transfers).toEqual([]);
    expect(r.skipped).toBe(1);
  });
  it("native SOL transfers are exact lamports; unsafe integers are skipped", () => {
    const sys = (lamports: unknown): SolanaTx => ({
      ...TOP,
      meta: { ...TOP.meta!, innerInstructions: [] },
      transaction: {
        ...TOP.transaction,
        message: { ...TOP.transaction.message, instructions: [{ program: "system", parsed: { type: "transfer", info: { source: "GachaNgyXTU3zFogQ8Z5jR2BLXs8215X2AtEH18VxJq3", destination: WALLET, lamports } } }] },
      },
    });
    const ok = normalizeSolanaTransaction(sys(1_500_000_000), { finalizedSlot: SLOT }).transfers[0];
    expect(ok.asset_address).toBeNull();
    expect(ok.asset_symbol).toBe("SOL");
    expect(ok.amount).toBe("1.5");
    expect(normalizeSolanaTransaction(sys(2 ** 60), { finalizedSlot: SLOT }).skipped).toBe(1);
  });
  it("two identical transfers in one transaction keep distinct identities", () => {
    const ix = TOP.transaction.message.instructions[2];
    const twice = { ...TOP, transaction: { ...TOP.transaction, message: { ...TOP.transaction.message, instructions: [ix, ix] } } };
    const keys = normalizeSolanaTransaction(twice, { finalizedSlot: SLOT }).transfers.map((t) => t.event_key);
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(`${keys[0]}:2`);
  });
});

// ── A scripted Solana node ──────────────────────────────────────────────────

type Handler = (method: string, params: unknown[]) => unknown;
function node(handler: Handler) {
  const seen: { method: string; params: unknown[] }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const { method, params } = JSON.parse(String(init.body));
      seen.push({ method, params });
      try {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: handler(method, params) }), { status: 200 });
      } catch (e) {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: (e as Error).message } }), { status: 200 });
      }
    })
  );
  return seen;
}

/** A node at finalized=SLOT, confirmed=SLOT+30, with `txs` touching the tracked wallet's token account. */
type Acct = { pubkey: string; mint: string; amount: string };
function cluster(
  opts: {
    genesis?: string;
    sigs?: { signature: string; slot: number; err: unknown }[];
    txs?: Record<string, SolanaTx | null>;
    /** Token accounts the wallet owns now, per program. Default: its USDC ATA under SPL Token. */
    accounts?: { spl?: Acct[]; t22?: Acct[] };
    /** Which account each signature list belongs to. Default: all `sigs` on the ATA. */
    sigsByAccount?: Record<string, { signature: string; slot: number; err: unknown }[]>;
  } = {}
) {
  const sigs = opts.sigs ?? [{ signature: SIG_TOP, slot: SLOT, err: null }];
  const txs = opts.txs ?? { [SIG_TOP]: TOP };
  const accts = opts.accounts ?? { spl: [{ pubkey: WALLET_ATA, mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", amount: "201929164" }], t22: [] };
  const byAccount = opts.sigsByAccount ?? { [WALLET_ATA]: sigs };
  return node((m, p) => {
    switch (m) {
      case "getGenesisHash":
        return opts.genesis ?? GENESIS;
      case "getSlot":
        return (p[0] as { commitment: string }).commitment === "finalized" ? SLOT : SLOT + 30;
      case "getTokenAccountsByOwner": {
        const list = (p[1] as { programId: string }).programId.startsWith("Tokenkeg") ? accts.spl ?? [] : accts.t22 ?? [];
        return { context: { slot: SLOT + 30 }, value: list.map((a) => ({ pubkey: a.pubkey, account: { data: { parsed: { info: { mint: a.mint, tokenAmount: { amount: a.amount, decimals: 6 } } } } } })) };
      }
      case "getSignaturesForAddress": {
        const before = (p[1] as { before?: string }).before;
        return !before ? [...(byAccount[p[0] as string] ?? [])].sort((a, b) => b.slot - a.slot) : [];
      }
      case "getTransaction":
        return txs[p[0] as string] ?? null;
      case "getBlock":
        return { blockhash: "BLOCKHASH" + p[0] };
      case "getBlockTime":
        return 1791354552;
      default:
        throw new Error(`unexpected ${m}`);
    }
  });
}

const ingested = () => rpcCalls.filter((c) => c.fn === "onchain_ingest").flatMap((c) => c.args.p_events as Record<string, unknown>[]);
const advances = () => rpcCalls.filter((c) => c.fn === "onchain_node_cursor_advance").map((c) => c.args);
const forever = () => false;

describe("scanSolana", () => {
  beforeEach(() => {
    rpcCalls.length = 0;
    db.cursor = { last_block: SLOT - 10, genesis_hash: GENESIS };
    db.stored = [];
    db.known = [];
    db.upserts = [];
    db.updates = [];
    vi.stubEnv("SOLANA_RPC_URL", "http://solana.local");
    vi.stubEnv("ONCHAIN_WATCH_ADDRESSES", `solana:${WALLET}`);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("finds a deposit through the wallet's TOKEN ACCOUNT, scopes it, and advances to the finalized slot", async () => {
    const seen = cluster();
    const r = await scanSolana({ deadline: forever });
    expect(r.status).toBe("ok");
    expect(seen.some((s) => s.method === "getSignaturesForAddress" && s.params[0] === WALLET_ATA)).toBe(true);
    const evs = ingested();
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ tracked_address: WALLET, direction: "in", scope: "watch", amount_raw: "33300000", confirmation_state: "finalized" });
    expect(advances()).toEqual([{ p_chain: "solana", p_chain_id: null, p_expected: SLOT - 10, p_next: SLOT, p_hash: `BLOCKHASH${SLOT}`, p_genesis: GENESIS }]);
  });

  it("first pass anchors at the finalized slot without reading history", async () => {
    db.cursor = null;
    cluster({ sigs: [] });
    const r = await scanSolana({ deadline: forever });
    expect(r.from).toBe(SLOT + 1);
    expect(advances()[0]).toMatchObject({ p_expected: null, p_next: SLOT, p_genesis: GENESIS });
  });

  it("refuses an endpoint serving a different cluster", async () => {
    cluster({ genesis: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG" });
    const r = await scanSolana({ deadline: forever });
    expect(r.status).toBe("failed");
    expect(r.errors[0]).toMatch(/pinned to genesis/);
    expect(ingested()).toEqual([]);
    expect(advances()).toEqual([]);
  });

  it("never advances past an unprocessed signature (transaction budget)", async () => {
    const sigs = [
      { signature: SIG_TOP, slot: SLOT - 5, err: null },
      { signature: SIG_INNER, slot: SLOT - 2, err: null },
    ];
    cluster({ sigs, txs: { [SIG_TOP]: { ...TOP, slot: SLOT - 5 }, [SIG_INNER]: { ...INNER, slot: SLOT - 2 } } });
    const r = await scanSolana({ deadline: forever, maxTransactions: 1 });
    expect(r.status).toBe("partial");
    expect(r.scannedThrough).toBe(SLOT - 3);
    expect(advances()[0]).toMatchObject({ p_next: SLOT - 3 });
  });

  it("stops at a listed transaction the node does not serve yet", async () => {
    cluster({ txs: { [SIG_TOP]: null } });
    const r = await scanSolana({ deadline: forever });
    expect(r.status).toBe("partial");
    expect(ingested()).toEqual([]);
    expect(advances()[0]).toMatchObject({ p_next: SLOT - 1 });
  });

  it("does not fetch failed transactions", async () => {
    const seen = cluster({ sigs: [{ signature: SIG_TOP, slot: SLOT, err: { InstructionError: [0, "x"] } }] });
    await scanSolana({ deadline: forever });
    expect(seen.some((s) => s.method === "getTransaction")).toBe(false);
  });

  it("fromSlot re-reads history without moving the cursor", async () => {
    cluster();
    await scanSolana({ deadline: forever, fromSlot: SLOT - 100 });
    expect(ingested()).toHaveLength(1);
    expect(advances()).toEqual([]);
  });

  it("scans EVERY token account the wallet owns (several per mint, Token-2022 too) and records their balances, USDC classified by mint", async () => {
    const SECOND_USDC = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
    const T22 = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
    const seen = cluster({
      accounts: {
        spl: [
          { pubkey: WALLET_ATA, mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", amount: "201929164" },
          { pubkey: SECOND_USDC, mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", amount: "5" },
        ],
        t22: [{ pubkey: T22, mint: "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo", amount: "7" }],
      },
    });
    const r = await scanSolana({ deadline: forever });
    expect(r.detail).toMatchObject({ wallets: 1, tokenAccounts: 3 });
    const listed = seen.filter((s) => s.method === "getSignaturesForAddress").map((s) => s.params[0]);
    expect(new Set(listed)).toEqual(new Set([WALLET, WALLET_ATA, SECOND_USDC, T22]));
    const bal = db.upserts.find((u) => u.table === "onchain_wallet_balances")!.rows;
    expect(bal.find((b) => b.account === WALLET_ATA)).toMatchObject({ owner: WALLET, asset: "usdc", amount_raw: "201929164", at_block: SLOT + 30 });
    expect(bal.find((b) => b.account === T22)!.asset).toBe("2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo"); // not in the registry: kept as its mint
  });

  it("keeps scanning a token account that was CLOSED since the last pass, and marks it gone", async () => {
    const CLOSED = "8yLhYqcnPvSbXFm7kWv3QNmrhwqiGvtq8ma9dBeB8Bnz";
    db.known = [{ account: CLOSED, owner: WALLET, gone_at: null }];
    // The deposit landed in the closed account; the wallet itself is not in that transaction.
    const seen = cluster({ sigsByAccount: { [CLOSED]: [{ signature: SIG_TOP, slot: SLOT, err: null }] } });
    const r = await scanSolana({ deadline: forever });
    expect(seen.some((s) => s.method === "getSignaturesForAddress" && s.params[0] === CLOSED)).toBe(true);
    expect(ingested()).toHaveLength(1);
    expect(r.detail).toMatchObject({ knownGoneAccounts: 1, newlyGone: 1 });
    expect(db.updates[0]).toMatchObject({ table: "onchain_solana_token_accounts", patch: { gone_at: expect.any(String) } });
    expect(db.updates[0].query).toContain(CLOSED);
  });

  it("a wallet with very many token accounts: only registry-asset (USDC) accounts are scanned, it is reported, and nothing is wrongly marked gone", async () => {
    const OTHER_KNOWN = "So11111111111111111111111111111111111111112";
    const many = Array.from({ length: 70 }, (_, i) => ({ pubkey: i === 0 ? OTHER_KNOWN : `${"1".repeat(31)}${String.fromCharCode(65 + (i % 26))}${i}`.slice(0, 44), mint: "Mint" + "x".repeat(36) + i, amount: "1" }));
    db.known = [{ account: OTHER_KNOWN, owner: WALLET, gone_at: null }];
    const seen = cluster({ accounts: { spl: [{ pubkey: WALLET_ATA, mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", amount: "5" }, ...many], t22: [] } });
    const r = await scanSolana({ deadline: forever });
    const listed = new Set(seen.filter((s) => s.method === "getSignaturesForAddress").map((s) => s.params[0]));
    expect(listed).toEqual(new Set([WALLET, WALLET_ATA]));
    expect(r.errors.join(" ")).toMatch(/has 71 token accounts; scanning the 1 of registry assets only/);
    expect(r.detail).toMatchObject({ tokenAccounts: 1, cappedWallets: 1, newlyGone: 0 });
    expect(db.updates).toEqual([]); // the unscanned-but-owned account is NOT marked gone
  });

  it("a token account created after initial indexing is picked up on the next pass", async () => {
    cluster({ accounts: { spl: [], t22: [] }, sigsByAccount: {} });
    const r1 = await scanSolana({ deadline: forever });
    expect(r1.detail).toMatchObject({ tokenAccounts: 0 });
    rpcCalls.length = 0;
    // The ATA now exists and received USDC at a slot after the first pass's cursor.
    // (Its CREATION always names the wallet, so it is caught through the wallet itself.)
    cluster({ sigs: [{ signature: SIG_TOP, slot: SLOT + 5, err: null }], txs: { [SIG_TOP]: { ...TOP, slot: SLOT + 5 } } });
    const r2 = await scanSolana({ deadline: forever });
    expect(r2.detail).toMatchObject({ tokenAccounts: 1 });
    expect(ingested()).toHaveLength(1);
  });

  it("reports wallet-indexer health with head, finalized and last processed slot", async () => {
    cluster();
    await scanSolana({ deadline: forever });
    const t = rpcCalls.find((c) => c.fn === "onchain_indexer_touch")!.args;
    expect(t).toMatchObject({ p_indexer: "wallet", p_chain: "solana", p_ok: true, p_head: SLOT + 30, p_finalized: SLOT, p_indexed: SLOT + 30 });
  });

  it("is opted in through ONCHAIN_NODE_CHAINS and dispatched by scanNodes", async () => {
    vi.stubEnv("ONCHAIN_NODE_CHAINS", "solana,base");
    vi.stubEnv("BASE_RPC_URL", "");
    expect(nodeChains()).toEqual(["solana"]);
    cluster();
    const reports = await scanNodes({ deadline: forever, only: ["solana"] });
    expect(reports.map((x) => [x.chain, x.status])).toEqual([["solana", "ok"]]);
  });
});
