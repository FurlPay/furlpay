import { createPublicClient, http, parseAbi, formatUnits, type Address } from "viem";
import { arbitrum } from "viem/chains";
import { log } from "@/lib/log";

// ---------------------------------------------------------------------------
// Live on-chain balance reads for JIT funding decisions.
//
// The issuer gives us ~2000ms to answer an authorization webhook, so every
// read here runs under an explicit time budget. If the RPC is slow we fall
// back to the caller-supplied ledger balance rather than timing out the whole
// authorization (a timeout at the issuer means their default action fires —
// we lose the decision entirely).
// ---------------------------------------------------------------------------

const RPC_URL = process.env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc";
// Native (Circle-issued) USDC on Arbitrum One, 6 decimals.
export const ARBITRUM_USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" as Address;

const ERC20_ABI = parseAbi(["function balanceOf(address account) view returns (uint256)"]);

const client = createPublicClient({
  chain: arbitrum,
  transport: http(RPC_URL, { timeout: 1500, retryCount: 0 }),
});

export interface BalanceRead {
  balanceUsd: number;
  source: "chain" | "ledger";
}

/**
 * Read the user's live USDC balance on Arbitrum within `budgetMs`.
 * On any failure (RPC down, over budget, bad address) returns the ledger
 * fallback so the authorization decision still happens in time.
 */
export async function getUsdcBalanceWithBudget(
  address: string,
  ledgerFallbackUsd: number,
  budgetMs = 1200
): Promise<BalanceRead> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return { balanceUsd: ledgerFallbackUsd, source: "ledger" };
  }
  try {
    const raw = await Promise.race([
      client.readContract({
        address: ARBITRUM_USDC,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [address as Address],
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("balance read over budget")), budgetMs)
      ),
    ]);
    return { balanceUsd: Number(formatUnits(raw, 6)), source: "chain" };
  } catch (e) {
    log.warn("on-chain balance read failed — using ledger fallback", {
      error: (e as Error).message,
    });
    return { balanceUsd: ledgerFallbackUsd, source: "ledger" };
  }
}
