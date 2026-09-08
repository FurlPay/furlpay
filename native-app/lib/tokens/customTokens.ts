import * as Crypto from "expo-crypto";
import { getDb } from "@/lib/db";
import { track } from "@/lib/analytics";
import { getCode, type ChainSlug } from "@/lib/evm/rpc";
import { CHAINS, type ChainId } from "@/lib/swap/assets";
import { readErc20Metadata, TokenReadError, type Erc20Metadata } from "./erc20Metadata";

// ---------------------------------------------------------------------------
// Tokens the user added by hand.
//
// KEPT STRICTLY APART FROM THE BUILT-IN CATALOGUE in lib/swap/assets.ts, and
// the separation is a safety property rather than tidiness. That catalogue is
// a list FurlPay vouches for: fixed contracts, drawn icons, known decimals.
// This table is a list the USER vouches for, populated from contracts anyone
// can deploy. A token calling itself "USDC" with a matching name is trivial to
// publish, so the two must never merge into one list where a scam token
// inherits the built-in one's credibility.
//
// `verified` is 0 for everything added here and there is no code path that
// sets it to 1. It exists so the column is already there the day a token
// registry is integrated, and so every UI reading this table has to decide what
// to render for an unverified token rather than defaulting to "trusted".
//
// WHAT IS VALIDATED BEFORE A TOKEN CAN BE ADDED:
//
//   1. the address is well-formed
//   2. something is actually DEPLOYED there (eth_getCode is non-empty)
//   3. it answers decimals() with a plausible value
//   4. it is not already in the list, and not already in the built-in catalogue
//
// Step 2 is the one that catches the most common real mistake: pasting a wallet
// address instead of a contract address. Without it the token adds cleanly,
// shows a zero balance forever, and the user concludes the app is broken.
//
// Step 3 refuses rather than defaulting to 18 — see Erc20Metadata.decimals for
// why a wrong decimals figure is worse than no token at all.
// ---------------------------------------------------------------------------

export interface CustomToken {
  id: string;
  chain: ChainId;
  /** Lowercased. Comparison is always case-insensitive; EIP-55 is display only. */
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  /** Always false today. See the header. */
  verified: boolean;
  addedAt: number;
}

interface Row {
  id: string;
  chain: string;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  verified: number;
  added_at: number;
}

function toToken(r: Row): CustomToken {
  return {
    id: r.id,
    chain: r.chain as ChainId,
    address: r.address,
    symbol: r.symbol,
    name: r.name,
    decimals: r.decimals,
    verified: r.verified === 1,
    addedAt: r.added_at,
  };
}

export function listCustomTokens(chain?: ChainId): CustomToken[] {
  const rows = chain
    ? getDb().getAllSync<Row>("SELECT * FROM custom_tokens WHERE chain = ? ORDER BY added_at DESC", chain)
    : getDb().getAllSync<Row>("SELECT * FROM custom_tokens ORDER BY added_at DESC");
  return rows.map(toToken);
}

export function findCustomToken(chain: ChainId, address: string): CustomToken | null {
  const row = getDb().getFirstSync<Row>(
    "SELECT * FROM custom_tokens WHERE chain = ? AND address = ?",
    chain,
    address.toLowerCase(),
  );
  return row ? toToken(row) : null;
}

export type AddTokenFailure =
  | { code: "invalid_address"; message: string }
  | { code: "unsupported_chain"; message: string }
  | { code: "not_a_contract"; message: string }
  | { code: "no_decimals"; message: string }
  | { code: "duplicate"; message: string; existing: CustomToken }
  | { code: "built_in"; message: string }
  | { code: "rpc_failed"; message: string }
  | { code: "limit_reached"; message: string };

export type AddTokenResult = { ok: true; token: CustomToken } | { ok: false; error: AddTokenFailure };

/**
 * Cap on how many tokens one device may hold.
 *
 * Not arbitrary: every token in this list is a balance read on every discovery
 * sweep, and an unbounded list turns a portfolio refresh into hundreds of RPC
 * calls the user did not ask for and the proxy's rate limit will reject.
 */
export const MAX_CUSTOM_TOKENS = 200;

/** The chains a custom token may be added on — those the RPC proxy can serve. */
const TOKEN_CHAINS: Partial<Record<ChainId, ChainSlug>> = {
  ethereum: "ethereum",
  polygon: "polygon",
  base: "base",
  arbitrum: "arbitrum",
};

export function chainSlugFor(chain: ChainId): ChainSlug | null {
  return TOKEN_CHAINS[chain] ?? null;
}

/**
 * Validate a contract and add it.
 *
 * `builtInAddresses` is passed in rather than imported so the caller decides
 * what counts as built-in — the swap catalogue today, a fetched registry later
 * — and so this function stays testable without the catalogue.
 */
export async function addCustomToken(
  chain: ChainId,
  rawAddress: string,
  builtInAddresses: Set<string> = new Set(),
): Promise<AddTokenResult> {
  const address = rawAddress.trim().toLowerCase();

  if (!/^0x[0-9a-f]{40}$/.test(address)) {
    return { ok: false, error: { code: "invalid_address", message: "That is not a valid contract address." } };
  }

  const slug = chainSlugFor(chain);
  if (!slug) {
    return {
      ok: false,
      error: {
        code: "unsupported_chain",
        message: `FurlPay cannot read token details on ${CHAINS[chain]?.name ?? chain}.`,
      },
    };
  }

  const existing = findCustomToken(chain, address);
  if (existing) {
    return {
      ok: false,
      error: { code: "duplicate", message: `${existing.symbol} is already in your token list.`, existing },
    };
  }

  if (builtInAddresses.has(address)) {
    return {
      ok: false,
      error: { code: "built_in", message: "FurlPay already supports this token — you do not need to add it." },
    };
  }

  const count = getDb().getFirstSync<{ n: number }>("SELECT COUNT(*) AS n FROM custom_tokens")?.n ?? 0;
  if (count >= MAX_CUSTOM_TOKENS) {
    return {
      ok: false,
      error: {
        code: "limit_reached",
        message: `You can add up to ${MAX_CUSTOM_TOKENS} tokens. Remove one to add another.`,
      },
    };
  }

  // Is anything deployed there at all? This catches pasting a wallet address,
  // which is the most common real mistake and otherwise fails silently forever.
  let code: string;
  try {
    code = await getCode(slug, address);
  } catch (e) {
    return { ok: false, error: { code: "rpc_failed", message: (e as Error).message } };
  }
  if (!code || code === "0x") {
    return {
      ok: false,
      error: {
        code: "not_a_contract",
        message: "There is no contract at that address on this network. Check the address and the network.",
      },
    };
  }

  let meta: Erc20Metadata;
  try {
    meta = await readErc20Metadata(slug, address);
  } catch (e) {
    const err = e instanceof TokenReadError ? e : null;
    return {
      ok: false,
      error: { code: err?.code === "rpc_failed" ? "rpc_failed" : "not_a_contract", message: (e as Error).message },
    };
  }

  if (meta.decimals === null) {
    // Refused, not defaulted. A token displayed with the wrong decimals shows a
    // balance off by orders of magnitude and takes an amount typed against that
    // display — in either direction.
    return {
      ok: false,
      error: {
        code: "no_decimals",
        message: "This contract did not report how many decimals it uses, so FurlPay cannot show its amounts safely.",
      },
    };
  }

  const token: CustomToken = {
    id: Crypto.randomUUID(),
    chain,
    address,
    // A contract with no symbol still gets a row, labelled by its address.
    // Inventing "TOKEN" would be indistinguishable from a token actually
    // called TOKEN.
    symbol: meta.symbol || shortAddress(address),
    name: meta.name || meta.symbol || shortAddress(address),
    decimals: meta.decimals,
    verified: false,
    addedAt: Date.now(),
  };

  getDb().runSync(
    `INSERT INTO custom_tokens (id, chain, address, symbol, name, decimals, verified, added_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
    token.id,
    token.chain,
    token.address,
    token.symbol,
    token.name,
    token.decimals,
    token.addedAt,
  );

  track("custom_token_added", { chain, source: "address" });
  return { ok: true, token };
}

export function removeCustomToken(id: string): void {
  const row = getDb().getFirstSync<{ chain: string }>("SELECT chain FROM custom_tokens WHERE id = ?", id);
  getDb().runSync("DELETE FROM custom_tokens WHERE id = ?", id);
  // Discovered rows for a removed token would otherwise keep it visible in the
  // portfolio with no way to remove it.
  getDb().runSync("DELETE FROM discovered_assets WHERE id = ?", id);
  if (row) track("custom_token_removed", { chain: row.chain });
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
