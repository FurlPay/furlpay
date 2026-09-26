import { createPublicClient, http, parseAbi, isAddress, getAddress, type Address } from "viem";
import { arbitrum, base } from "viem/chains";
import { Connection, PublicKey } from "@solana/web3.js";
import { log } from "@/lib/log";
import { selfCustodyStage } from "@/lib/walletLink";
import type { Balance, BalanceAsOf } from "@/lib/custody";

// ---------------------------------------------------------------------------
// Phase 2 — live on-chain USDC balance reads for the linked self-custodial
// wallet (docs/SELF-CUSTODIAL-WALLET-DESIGN.md).
//
// The chain is the source of truth for SELF_CUSTODIAL_ONCHAIN balances. The
// stored ledger number is demoted to a CACHE, and every value returned here
// says which of the two it came from (`asOf.source`) so a screen can never
// present a stale cache as live truth.
//
// ATOMIC UNITS ONLY. Every amount crosses this module as a decimal STRING of
// base units, matching `custody.ts::Balance.atomic`. USDC has 6 decimals, so a
// JS number survives today — but the rule is not about what fits, it is about
// never letting a float into a money path where a later 18-decimal token would
// silently lose precision.
//
// CONTRACT ADDRESSES BELOW WERE VERIFIED ON-CHAIN (2026-09-17), not copied
// from a doc — each returned decimals() == 6 and symbol() == "USDC" from a
// live RPC call. Re-verify before adding a chain; a wrong USDC address reads
// someone else's token and reports a confident, wrong balance.
// ---------------------------------------------------------------------------

export type UsdcChain = "base" | "arbitrum" | "solana";

/** Native (Circle-issued) USDC. All 6 decimals. Verified on-chain. */
export const USDC_ADDRESS: Record<UsdcChain, string> = {
  // eth_call decimals() -> 6, symbol() -> "USDC"
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  arbitrum: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  // getAccountInfo -> SPL mint, decimals 6
  solana: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
};

export const USDC_DECIMALS = 6;

const ERC20_ABI = parseAbi(["function balanceOf(address account) view returns (uint256)"]);

/** Default read budget. Balance screens can wait longer than a card auth. */
const DEFAULT_BUDGET_MS = 4000;

const EVM_CHAINS = { base, arbitrum } as const;

function rpcUrlFor(chain: UsdcChain): string {
  switch (chain) {
    case "base":
      return process.env.BASE_RPC_URL || "https://mainnet.base.org";
    case "arbitrum":
      return process.env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc";
    case "solana":
      return process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
  }
}

/** Reject a promise that outruns the budget, so one slow RPC cannot hang a page. */
function withBudget<T>(p: Promise<T>, budgetMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} exceeded ${budgetMs}ms budget`)), budgetMs);
    }),
  ]);
}

export interface OnChainRead {
  chain: UsdcChain;
  /** Atomic base units as a decimal string. */
  atomic: string;
  asOf: BalanceAsOf;
}

// ---------------------------------------------------------------------------
// EVM
// ---------------------------------------------------------------------------

async function readEvmUsdc(
  chain: "base" | "arbitrum",
  address: string,
  budgetMs: number,
): Promise<OnChainRead> {
  // AGENTS.md rule 9 — validate externally-supplied EVM addresses.
  if (!isAddress(address)) {
    throw new Error(`"${address}" is not a valid EVM address`);
  }
  const client = createPublicClient({
    chain: EVM_CHAINS[chain],
    transport: http(rpcUrlFor(chain), { timeout: budgetMs, retryCount: 1 }),
  });

  // Read the balance and the block it reflects together. A balance without the
  // block it was read at cannot be reconciled against anything later.
  const [raw, blockNumber] = await withBudget(
    Promise.all([
      client.readContract({
        address: getAddress(USDC_ADDRESS[chain]) as Address,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        // Checksum before use: viem rejects a mixed-case address that fails
        // EIP-55, and a lowercased one from storage would otherwise throw here.
        args: [getAddress(address) as Address],
      }),
      client.getBlockNumber(),
    ]),
    budgetMs,
    `${chain} USDC balanceOf`,
  );

  return {
    chain,
    atomic: raw.toString(),
    asOf: { source: "chain", at: new Date().toISOString(), block: blockNumber.toString() },
  };
}

// ---------------------------------------------------------------------------
// Solana
// ---------------------------------------------------------------------------

async function readSolanaUsdc(address: string, budgetMs: number): Promise<OnChainRead> {
  // AGENTS.md rule 9 — validate Solana addresses via PublicKey in try/catch.
  let owner: PublicKey;
  try {
    owner = new PublicKey(address);
  } catch {
    throw new Error(`"${address}" is not a valid Solana address`);
  }

  const connection = new Connection(rpcUrlFor("solana"), "confirmed");
  const mint = new PublicKey(USDC_ADDRESS.solana);

  const [accounts, slot] = await withBudget(
    Promise.all([
      connection.getParsedTokenAccountsByOwner(owner, { mint }),
      connection.getSlot("confirmed"),
    ]),
    budgetMs,
    "solana USDC token accounts",
  );

  // SUM every account, do not take [0].
  //
  // An owner can hold many token accounts for the same mint — the canonical
  // ATA plus any created by an exchange, a earlier wallet, or a program. The
  // obvious `accounts.value[0]` reads one arbitrary account and under-reports
  // the balance, which on a send screen means telling the user they have less
  // money than they do, or failing a transfer they could afford.
  let total = 0n;
  for (const { account } of accounts.value) {
    const amount = account.data.parsed?.info?.tokenAmount?.amount;
    if (typeof amount === "string") total += BigInt(amount);
  }

  return {
    chain: "solana",
    atomic: total.toString(),
    // Solana has slots, not block numbers; recorded in the same field so a
    // reconciler has one "as of what point on the chain" value per read.
    asOf: { source: "chain", at: new Date().toISOString(), block: String(slot) },
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** True when Phase 2 (on-chain reads) is enabled on this deployment. */
export function onChainReadsEnabled(): boolean {
  return selfCustodyStage() >= 2;
}

/**
 * Read live USDC for one chain.
 *
 * Throws on failure rather than returning zero. A zero balance and an
 * unreachable RPC are completely different facts, and collapsing them is how a
 * UI ends up telling someone their funds are gone. Callers that need
 * resilience use `readUsdcBalances` below, which degrades to a tagged cache.
 */
export async function readUsdcBalance(
  chain: UsdcChain,
  address: string,
  budgetMs: number = DEFAULT_BUDGET_MS,
): Promise<OnChainRead> {
  return chain === "solana"
    ? readSolanaUsdc(address, budgetMs)
    : readEvmUsdc(chain, address, budgetMs);
}

export interface BalancesRequest {
  /** EVM address for base/arbitrum reads. */
  evmAddress?: string;
  /** Solana address for the SPL read. */
  solanaAddress?: string;
  chains?: readonly UsdcChain[];
  /**
   * Per-chain cached atomic amounts, used ONLY when a live read fails. Tagged
   * `source: "cache"` in the result so the caller can label it.
   */
  cache?: Partial<Record<UsdcChain, string>>;
  budgetMs?: number;
}

/**
 * Read USDC across chains for a linked wallet, degrading per chain.
 *
 * Chains are read CONCURRENTLY and each degrades independently: one dead RPC
 * must not blank out the other two. A chain with no cache entry and a failed
 * read is omitted entirely rather than reported as zero.
 */
export async function readUsdcBalances(req: BalancesRequest): Promise<Balance[]> {
  const chains = req.chains ?? (["base", "arbitrum", "solana"] as const);
  const budgetMs = req.budgetMs ?? DEFAULT_BUDGET_MS;

  const settled = await Promise.all(
    chains.map(async (chain): Promise<Balance | null> => {
      const address = chain === "solana" ? req.solanaAddress : req.evmAddress;
      if (!address) return null;

      try {
        const read = await readUsdcBalance(chain, address, budgetMs);
        return toBalance(chain, read.atomic, read.asOf);
      } catch (e) {
        const cached = req.cache?.[chain];
        log.warn("on-chain USDC read failed", {
          chain,
          error: (e as Error).message,
          degradedToCache: cached !== undefined,
        });
        if (cached === undefined) return null;
        return toBalance(chain, cached, { source: "cache", at: new Date().toISOString() });
      }
    }),
  );

  return settled.filter((b): b is Balance => b !== null);
}

function toBalance(chain: UsdcChain, atomic: string, asOf: BalanceAsOf): Balance {
  return {
    custody: "SELF_CUSTODIAL_ONCHAIN",
    token: "USDC",
    chain,
    atomic,
    decimals: USDC_DECIMALS,
    asOf,
    spendable: true,
  };
}

/**
 * Format atomic units for display without floats.
 *
 * `Number(atomic) / 1e6` is the tempting one-liner and it is wrong: it rounds
 * at 2^53 and produces artefacts like 12.340000000000001 well before that.
 * String slicing is exact at any size.
 */
export function formatUsdc(atomic: string, decimals: number = USDC_DECIMALS): string {
  const negative = atomic.startsWith("-");
  const digits = (negative ? atomic.slice(1) : atomic).padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const frac = digits.slice(digits.length - decimals);
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

/** Sum atomic balances for one token. Rejects a mixed-token sum outright. */
export function sumAtomic(balances: readonly Balance[]): string {
  const tokens = new Set(balances.map((b) => b.token));
  if (tokens.size > 1) {
    throw new Error(`refusing to sum mixed tokens: ${[...tokens].join(", ")}`);
  }
  return balances.reduce((acc, b) => acc + BigInt(b.atomic), 0n).toString();
}
