// ---------------------------------------------------------------------------
// Real on-chain balance reads.
//
// This replaces the hardcoded position table in /api/investing/rwa, which
// returned the same 1.5 bNVDA and 3.0 bAAPL to every user who asked. That is
// the worst shape a demo can take on a money surface: it is per-user-looking,
// it marks to a real live price, and it therefore reads as a real holding.
//
// Two chains, one contract:
//
//   EVM      ERC-20 `balanceOf` and `decimals`, batched through Multicall3 at
//            0xcA11bde05977b3631167028862bE2a173976CA11 — the same address on
//            every major EVM chain by design (deterministic deployment). One
//            eth_call returns every balance instead of N round trips.
//   Solana   `getTokenAccountsByOwner` with the SPL Token program filter, which
//            returns parsed balances including decimals in one call. Token-2022
//            mints live under a DIFFERENT program id, so both are queried —
//            asking only the legacy program would silently report zero for
//            every xStock, which are Token-2022.
//
// A ZERO BALANCE AND AN UNREADABLE CHAIN ARE DIFFERENT ANSWERS, and this
// module never collapses them. An RPC failure yields `null` with a reason, and
// the caller must render "unavailable" rather than "you hold nothing" — telling
// someone their position is empty because a node timed out is a false statement
// about their money.
// ---------------------------------------------------------------------------

/** Multicall3, deployed at the same address on every chain this app touches. */
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";

/** `balanceOf(address)` and `decimals()` selectors. */
const SELECTOR_BALANCE_OF = "0x70a08231";
const SELECTOR_DECIMALS = "0x313ce567";

/** SPL Token and Token-2022 program ids. Both are queried — see the header. */
const SPL_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const SPL_TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

const RPC_TIMEOUT_MS = 8_000;

export type ChainKind = "evm" | "solana";

/** Why a balance could not be read. Never conflated with a zero balance. */
export type BalanceError = "rpc_unavailable" | "rpc_error" | "not_configured" | "invalid_address";

export interface TokenBalance {
  /** Contract address (EVM) or mint address (Solana). */
  token: string;
  /** Raw base units, as a decimal string — never a JS number. A token with 18
   *  decimals overflows Number.MAX_SAFE_INTEGER at about 9 units, so parsing
   *  the raw amount as a float loses precision on any real balance. */
  rawAmount: string;
  decimals: number;
  /** Human-scale amount. Safe here because it is derived AFTER the raw string
   *  has been divided down, and is for display and marking only. */
  amount: number;
  /** The block or slot this was read at, so a caller can tell how current it
   *  is and detect a node serving stale state. */
  blockNumber: number | null;
}

export type BalanceResult =
  | { ok: true; balances: TokenBalance[]; chain: string; readAt: string; blockNumber: number | null }
  | { ok: false; error: BalanceError; detail: string; chain: string };

// ---------------------------------------------------------------------------
// EVM
// ---------------------------------------------------------------------------

interface EvmChainConfig {
  chain: string;
  rpcUrl: string;
}

/** RPC endpoints, from the environment only. No public fallback endpoint is
 *  baked in: a rate-limited shared node returning an error would be read as a
 *  balance failure on a user's portfolio, and a silently WRONG answer from an
 *  untrusted node is worse still. */
export function evmRpcFor(chain: string): string | null {
  const map: Record<string, string | undefined> = {
    arbitrum: process.env.ARBITRUM_RPC_URL,
    base: process.env.BASE_RPC_URL,
    ethereum: process.env.ETHEREUM_RPC_URL,
    polygon: process.env.POLYGON_RPC_URL,
    // ROBINHOOD_RPC_URL, matching the name already registered in lib/env.ts —
    // a second spelling for the same endpoint is a config trap, not a feature.
    robinhood: process.env.ROBINHOOD_RPC_URL,
  };
  const url = map[chain]?.trim();
  return url && url.length > 0 ? url : null;
}

function isEvmAddress(v: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(v);
}

/** Left-pad an address into a 32-byte ABI word. */
function encodeAddress(address: string): string {
  return address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

/** ABI-encode a Multicall3 `aggregate3` call for N (target, calldata) pairs.
 *
 *  Hand-rolled rather than pulled from viem's ABI encoder because this is one
 *  fixed call shape and the encoding is a dozen lines — adding an encoder
 *  dependency to the server bundle for it is not a trade worth making. */
function encodeAggregate3(calls: { target: string; callData: string }[]): string {
  const AGGREGATE3 = "82ad56cb";
  const word = (n: number) => n.toString(16).padStart(64, "0");

  // One dynamic array of structs: offset, length, then per-element offsets.
  let head = word(0x20) + word(calls.length);
  const elementOffsets: string[] = [];
  const elements: string[] = [];
  let running = calls.length * 32;

  for (const call of calls) {
    const data = call.callData.replace(/^0x/, "");
    const dataBytes = data.length / 2;
    const padded = data.padEnd(Math.ceil(dataBytes / 32) * 64, "0");
    // struct Call3 { address target; bool allowFailure; bytes callData; }
    const element =
      encodeAddress(call.target) + word(1) + word(0x60) + word(dataBytes) + padded;
    elementOffsets.push(word(running));
    elements.push(element);
    running += element.length / 2;
  }

  head += elementOffsets.join("") + elements.join("");
  return "0x" + AGGREGATE3 + head;
}

/** Decode `aggregate3`'s `(bool success, bytes returnData)[]`. */
function decodeAggregate3(hex: string): { success: boolean; data: string }[] {
  const body = hex.replace(/^0x/, "");
  const wordAt = (i: number) => body.slice(i * 64, (i + 1) * 64);
  const intAt = (i: number) => parseInt(wordAt(i), 16);

  const arrayStart = intAt(0) / 32;
  const length = intAt(arrayStart);
  const out: { success: boolean; data: string }[] = [];

  for (let i = 0; i < length; i++) {
    const elementStart = arrayStart + 1 + intAt(arrayStart + 1 + i) / 32;
    const success = intAt(elementStart) === 1;
    const dataOffset = elementStart + intAt(elementStart + 1) / 32;
    const dataLen = intAt(dataOffset);
    const data = body.slice((dataOffset + 1) * 64, (dataOffset + 1) * 64 + dataLen * 2);
    out.push({ success, data });
  }
  return out;
}

async function evmRpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`rpc ${res.status}`);
  const json = (await res.json()) as { result?: T; error?: { message?: string } };
  if (json.error) throw new Error(json.error.message ?? "rpc error");
  if (json.result === undefined) throw new Error("rpc returned no result");
  return json.result;
}

/**
 * ERC-20 balances for one owner across many tokens, in one eth_call.
 *
 * `decimals()` is fetched alongside `balanceOf` rather than assumed to be 18.
 * Tokenized equities do not follow the ERC-20 default — several issuers use 6
 * or 8 — and assuming 18 would under-report a real position by twelve orders
 * of magnitude while looking like a perfectly ordinary number.
 */
export async function readEvmBalances(
  config: EvmChainConfig,
  owner: string,
  tokens: string[]
): Promise<BalanceResult> {
  if (!isEvmAddress(owner)) {
    return { ok: false, error: "invalid_address", detail: "Owner is not a valid EVM address", chain: config.chain };
  }
  const valid = tokens.filter(isEvmAddress);
  if (valid.length === 0) {
    return { ok: true, balances: [], chain: config.chain, readAt: new Date().toISOString(), blockNumber: null };
  }

  const calls = valid.flatMap((token) => [
    { target: token, callData: SELECTOR_BALANCE_OF + encodeAddress(owner) },
    { target: token, callData: SELECTOR_DECIMALS },
  ]);

  try {
    const [raw, blockHex] = await Promise.all([
      evmRpc<string>(config.rpcUrl, "eth_call", [{ to: MULTICALL3, data: encodeAggregate3(calls) }, "latest"]),
      evmRpc<string>(config.rpcUrl, "eth_blockNumber", []).catch(() => null),
    ]);

    const results = decodeAggregate3(raw);
    const balances: TokenBalance[] = [];

    for (let i = 0; i < valid.length; i++) {
      const balanceCall = results[i * 2];
      const decimalsCall = results[i * 2 + 1];
      // A token whose calls reverted is OMITTED, not reported as zero. A
      // reverting contract is one we could not read, and "you hold none of it"
      // is a claim this code has no basis for.
      if (!balanceCall?.success || !decimalsCall?.success) continue;

      const rawAmount = BigInt("0x" + (balanceCall.data || "0"));
      const decimals = Number(BigInt("0x" + (decimalsCall.data || "0")));
      if (!Number.isFinite(decimals) || decimals < 0 || decimals > 36) continue;

      balances.push({
        token: valid[i].toLowerCase(),
        rawAmount: rawAmount.toString(),
        decimals,
        amount: Number(rawAmount) / 10 ** decimals,
        blockNumber: blockHex ? parseInt(blockHex, 16) : null,
      });
    }

    return {
      ok: true,
      balances,
      chain: config.chain,
      readAt: new Date().toISOString(),
      blockNumber: blockHex ? parseInt(blockHex, 16) : null,
    };
  } catch (e) {
    return {
      ok: false,
      error: "rpc_error",
      detail: e instanceof Error ? e.message : "RPC call failed",
      chain: config.chain,
    };
  }
}

// ---------------------------------------------------------------------------
// Solana
// ---------------------------------------------------------------------------

export function solanaRpc(): string | null {
  const url = (process.env.SOLANA_RPC_URL ?? process.env.HELIUS_RPC_URL ?? "").trim();
  return url.length > 0 ? url : null;
}

/** Base58, 32–44 chars — the shape of every Solana address. */
function isSolanaAddress(v: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);
}

interface SolanaTokenAccount {
  account: {
    data: {
      parsed?: {
        info?: {
          mint?: string;
          tokenAmount?: { amount?: string; decimals?: number };
        };
      };
    };
  };
}

async function solanaRpcCall<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`rpc ${res.status}`);
  const json = (await res.json()) as { result?: T; error?: { message?: string } };
  if (json.error) throw new Error(json.error.message ?? "rpc error");
  if (json.result === undefined) throw new Error("rpc returned no result");
  return json.result;
}

/**
 * SPL balances for an owner, across BOTH token programs.
 *
 * Querying only the legacy SPL Token program would report zero for every
 * Token-2022 mint — which is what xStocks and most 2025-onward tokenized
 * equities are issued as. The result would be a portfolio confidently showing
 * no position in assets the user actually holds.
 *
 * `mints` filters the result; passing an empty array returns every token
 * account, which is the right behaviour for a wallet view and the wrong one for
 * a registry-scoped read.
 */
export async function readSolanaBalances(owner: string, mints: string[] = []): Promise<BalanceResult> {
  const url = solanaRpc();
  if (!url) {
    return { ok: false, error: "not_configured", detail: "SOLANA_RPC_URL is not set", chain: "solana" };
  }
  if (!isSolanaAddress(owner)) {
    return { ok: false, error: "invalid_address", detail: "Owner is not a valid Solana address", chain: "solana" };
  }

  const wanted = new Set(mints.filter(isSolanaAddress));

  try {
    const [legacy, token2022, slot] = await Promise.all([
      solanaRpcCall<{ value: SolanaTokenAccount[]; context?: { slot?: number } }>(url, "getTokenAccountsByOwner", [
        owner,
        { programId: SPL_TOKEN_PROGRAM },
        { encoding: "jsonParsed" },
      ]),
      solanaRpcCall<{ value: SolanaTokenAccount[]; context?: { slot?: number } }>(url, "getTokenAccountsByOwner", [
        owner,
        { programId: SPL_TOKEN_2022_PROGRAM },
        { encoding: "jsonParsed" },
      ]).catch(() => ({ value: [] as SolanaTokenAccount[] })),
      solanaRpcCall<number>(url, "getSlot", []).catch(() => null),
    ]);

    const balances: TokenBalance[] = [];
    for (const entry of [...legacy.value, ...token2022.value]) {
      const info = entry.account?.data?.parsed?.info;
      const mint = info?.mint;
      const amount = info?.tokenAmount?.amount;
      const decimals = info?.tokenAmount?.decimals;
      if (!mint || amount == null || decimals == null) continue;
      if (wanted.size > 0 && !wanted.has(mint)) continue;

      const rawAmount = BigInt(amount);
      // Skip empty accounts: an associated token account survives after the
      // balance goes to zero, and listing it as a position would show a holding
      // the user closed.
      if (rawAmount === 0n) continue;

      balances.push({
        token: mint,
        rawAmount: rawAmount.toString(),
        decimals,
        amount: Number(rawAmount) / 10 ** decimals,
        blockNumber: slot ?? null,
      });
    }

    return {
      ok: true,
      balances,
      chain: "solana",
      readAt: new Date().toISOString(),
      blockNumber: slot ?? null,
    };
  } catch (e) {
    return {
      ok: false,
      error: "rpc_error",
      detail: e instanceof Error ? e.message : "RPC call failed",
      chain: "solana",
    };
  }
}

/** Read one chain, dispatching on its kind. */
export async function readBalances(
  chain: string,
  kind: ChainKind,
  owner: string,
  tokens: string[]
): Promise<BalanceResult> {
  if (kind === "solana") return readSolanaBalances(owner, tokens);
  const rpcUrl = evmRpcFor(chain);
  if (!rpcUrl) {
    return { ok: false, error: "not_configured", detail: `No RPC configured for ${chain}`, chain };
  }
  return readEvmBalances({ chain, rpcUrl }, owner, tokens);
}

/** Test seam for the ABI codec, which is the part most worth pinning. */
export const __abi = { encodeAggregate3, decodeAggregate3, encodeAddress };
