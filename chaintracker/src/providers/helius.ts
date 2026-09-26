// Helius — Solana.
//
// An honest note on scope, because it shapes the whole Solana whale strategy:
// a complete Solana transfer firehose needs Geyser or webhooks, which are not
// on the free tier. What IS free and reliable is per-address history. So Solana
// whale detection is *tracked-address* detection — labelled CEX hot wallets,
// bridges, protocol treasuries and any address a user /watch-es — polled through
// getSignaturesForAddress and enriched by the parsed-transaction API.
//
// That produces genuine exchange-flow and treasury intelligence, which is the
// signal people actually want, and it never claims to be a full firehose.

import { env } from "../config/env.js";
import { Provider } from "./base.js";

const RPC = (key: string) => `https://mainnet.helius-rpc.com/?api-key=${key}`;
const API = "https://api.helius.xyz/v0";
const PUBLIC_RPC = "https://api.mainnet-beta.solana.com";

export interface SolTransfer {
  signature: string;
  slot: number;
  timestamp: number;
  type: string;
  source: string;
  /** Native SOL legs. */
  nativeTransfers: Array<{ from: string; to: string; lamports: number }>;
  tokenTransfers: Array<{
    from: string;
    to: string;
    mint: string;
    amount: number;
    symbol: string | null;
  }>;
  fee: number;
  description: string;
}

export class HeliusProvider extends Provider {
  private readonly key: string | null;

  constructor() {
    super({
      name: "helius",
      kind: "blockchain",
      configured: !!env.heliusKey,
      // Free tier documents 10 RPS; 6 leaves room for the odd burst.
      rps: 6,
      timeoutMs: 15_000,
      budgetLimit: env.heliusKey ? 1_000_000 : null, // 1M credits/month free
    });
    this.key = env.heliusKey;
  }

  /** Helius when keyed, otherwise Solana's rate-limited public endpoint. */
  private rpcUrl(): string {
    return this.key ? RPC(this.key) : PUBLIC_RPC;
  }

  async slot(): Promise<number> {
    return this.rpc<number>(this.rpcUrl(), "getSlot", [], { label: "getSlot" });
  }

  async blockHeight(): Promise<number> {
    return this.rpc<number>(this.rpcUrl(), "getBlockHeight", [], { label: "getBlockHeight" });
  }

  /** SOL balance in whole SOL. */
  async balance(address: string): Promise<number | null> {
    try {
      const r = await this.rpc<{ value: number }>(this.rpcUrl(), "getBalance", [address], {
        label: "getBalance",
      });
      return typeof r?.value === "number" ? r.value / 1e9 : null;
    } catch {
      return null;
    }
  }

  /** Recent signatures for one account, newest first. */
  async signaturesFor(
    address: string,
    opts: { limit?: number; until?: string } = {},
  ): Promise<Array<{ signature: string; slot: number; blockTime: number | null; err: unknown }>> {
    const params: [string, Record<string, unknown>] = [
      address,
      { limit: Math.min(opts.limit ?? 25, 100) },
    ];
    if (opts.until) params[1].until = opts.until;
    try {
      const r = await this.rpc<
        Array<{ signature: string; slot: number; blockTime: number | null; err: unknown }>
      >(this.rpcUrl(), "getSignaturesForAddress", params, { label: "getSignaturesForAddress" });
      return Array.isArray(r) ? r : [];
    } catch {
      return [];
    }
  }

  /**
   * Parsed transactions by signature. This is the Helius enhanced API and is
   * the only reason the Solana path can name a token and an amount without
   * hand-decoding SPL instructions. Unavailable without a key.
   */
  async parseTransactions(signatures: string[]): Promise<SolTransfer[]> {
    if (!this.key || !signatures.length) return [];
    const out: SolTransfer[] = [];
    for (let i = 0; i < signatures.length; i += 100) {
      const batch = signatures.slice(i, i + 100);
      try {
        const raw = await this.request<RawParsed[]>(
          `${API}/transactions?api-key=${this.key}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ transactions: batch }),
          },
          { label: "parseTransactions", units: batch.length },
        );
        for (const t of raw ?? []) out.push(normalise(t));
      } catch (err) {
        this.log.warn("parseTransactions failed", {
          count: batch.length,
          err: (err as Error).message.slice(0, 120),
        });
      }
    }
    return out;
  }

  /** Address history already parsed — one call instead of signatures + parse. */
  async addressTransactions(
    address: string,
    opts: { limit?: number; before?: string } = {},
  ): Promise<SolTransfer[]> {
    if (!this.key) return [];
    const u = new URL(`${API}/addresses/${address}/transactions`);
    u.searchParams.set("api-key", this.key);
    u.searchParams.set("limit", String(Math.min(opts.limit ?? 25, 100)));
    if (opts.before) u.searchParams.set("before", opts.before);
    try {
      const raw = await this.request<RawParsed[]>(u.toString(), {}, {
        label: "addresses/transactions",
        units: 5,
      });
      return (raw ?? []).map(normalise);
    } catch (err) {
      this.log.warn("addressTransactions failed", {
        err: (err as Error).message.slice(0, 120),
      });
      return [];
    }
  }

  /** SPL token balances for a wallet, used by /address on Solana. */
  async tokenBalances(
    address: string,
  ): Promise<Array<{ mint: string; amount: number; decimals: number }>> {
    try {
      const r = await this.rpc<{
        value: Array<{
          account: {
            data: {
              parsed: { info: { mint: string; tokenAmount: { uiAmount: number; decimals: number } } };
            };
          };
        }>;
      }>(
        this.rpcUrl(),
        "getTokenAccountsByOwner",
        [address, { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" }, { encoding: "jsonParsed" }],
        { label: "getTokenAccountsByOwner" },
      );
      return (r?.value ?? [])
        .map((a) => {
          const i = a.account?.data?.parsed?.info;
          return {
            mint: i?.mint ?? "",
            amount: i?.tokenAmount?.uiAmount ?? 0,
            decimals: i?.tokenAmount?.decimals ?? 0,
          };
        })
        .filter((t) => t.mint && t.amount > 0);
    } catch {
      return [];
    }
  }

  /** Whether a Solana address is a program (contract) rather than a wallet. */
  async isProgram(address: string): Promise<boolean | null> {
    try {
      const r = await this.rpc<{ value: { executable: boolean } | null }>(
        this.rpcUrl(),
        "getAccountInfo",
        [address, { encoding: "base64" }],
        { label: "getAccountInfo" },
      );
      return r?.value ? r.value.executable === true : null;
    } catch {
      return null;
    }
  }

  async ping(): Promise<boolean> {
    try {
      return (await this.slot()) > 0;
    } catch {
      return false;
    }
  }
}

/* ------------------------------------------------------------------ */

interface RawParsed {
  signature: string;
  slot: number;
  timestamp: number;
  type?: string;
  source?: string;
  fee?: number;
  description?: string;
  nativeTransfers?: Array<{ fromUserAccount: string; toUserAccount: string; amount: number }>;
  tokenTransfers?: Array<{
    fromUserAccount: string;
    toUserAccount: string;
    mint: string;
    tokenAmount: number;
  }>;
}

function normalise(t: RawParsed): SolTransfer {
  return {
    signature: t.signature,
    slot: t.slot,
    timestamp: (t.timestamp ?? 0) * 1000,
    type: t.type ?? "UNKNOWN",
    source: t.source ?? "UNKNOWN",
    fee: t.fee ?? 0,
    description: t.description ?? "",
    nativeTransfers: (t.nativeTransfers ?? []).map((n) => ({
      from: n.fromUserAccount,
      to: n.toUserAccount,
      lamports: n.amount,
    })),
    tokenTransfers: (t.tokenTransfers ?? []).map((n) => ({
      from: n.fromUserAccount,
      to: n.toUserAccount,
      mint: n.mint,
      amount: n.tokenAmount,
      symbol: MINT_SYMBOLS[n.mint] ?? null,
    })),
  };
}

/**
 * Mint → ticker for the assets that dominate Solana whale flow. Anything not
 * listed keeps a null symbol and is priced by mint lookup, never guessed.
 */
export const MINT_SYMBOLS: Record<string, string> = {
  So11111111111111111111111111111111111111112: "SOL",
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "USDC",
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: "USDT",
  mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So: "mSOL",
  "7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj": "stSOL",
  J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn: "jitoSOL",
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: "BONK",
  JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: "JUP",
  "27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4": "JLP",
};
