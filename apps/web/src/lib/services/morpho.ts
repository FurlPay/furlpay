import { encodeFunctionData, getAddress, type Hex } from "viem";

// ---------------------------------------------------------------------------
// Morpho Vaults integration (FurlPay Earn's primary yield source — the same
// ERC-4626 curated-vault approach Robinhood Earn uses). Two layers:
//
//   1. DATA (read-only, safe): live APY/TVL from the public Morpho GraphQL API
//      (https://api.morpho.org/graphql). No key required. Falls back to a
//      deterministic vault list if the network is unreachable so the demo and
//      SSR never break — same convention as the rest of the app.
//
//   2. TRANSACTIONS (non-custodial): FurlPay never holds keys, so deposit and
//      withdraw are returned as UNSIGNED ERC-4626 calldata the user's Safe
//      signs (mirrors how /api/payments/create returns EIP-712 sign data).
//      Because vaults are standard ERC-4626 (deposit/redeem/convertToAssets),
//      viem encodes everything — no Morpho SDK dependency needed.
//
// Real on-chain reads/settlement are gated behind INTEGRATION_MODE=live +
// ARBITRUM_RPC_URL; otherwise valuation is computed off the deterministic APY.
// ---------------------------------------------------------------------------

export const MORPHO_GRAPHQL = process.env.MORPHO_API_URL || "https://api.morpho.org/graphql";
export const ARBITRUM_CHAIN_ID = 42161;
// Native (Circle-issued) USDC on Arbitrum One — matches x402 NETWORK_USDC.
export const ARBITRUM_USDC = getAddress("0xaf88d065e77c8cC2239327C5EDb3A432268e5831");

export function earnIsLive(): boolean {
  return process.env.INTEGRATION_MODE === "live" && !!process.env.ARBITRUM_RPC_URL;
}

export interface EarnVault {
  address: string;
  name: string;
  symbol: string;
  /** Net APY after fees + rewards, as a percentage (e.g. 4.5). */
  netApy: number;
  /** Total value locked, USD. */
  tvlUsd: number;
  /** Vault performance fee, percentage. */
  fee: number;
  curators: string[];
  protocol: "morpho";
  chainId: number;
  risk: "Low" | "Medium";
  live: boolean;
}

// Deterministic fallback vaults (used when the API is unreachable). Values are
// plausible mid-2026 Arbitrum USDC vaults; a live fetch overrides them.
const FALLBACK_VAULTS: EarnVault[] = [
  {
    address: "0xba9E3b3b684719F80657af1A19DEbc3C772494a0",
    name: "Gauntlet USDC Core",
    symbol: "gtUSDCc",
    netApy: 4.8,
    tvlUsd: 42_000_000,
    fee: 10,
    curators: ["Gauntlet"],
    protocol: "morpho",
    chainId: ARBITRUM_CHAIN_ID,
    risk: "Low",
    live: false,
  },
  {
    address: "0x1e6ffa4e9F63d10B8820A3ab52566Af881Dab53c",
    name: "Steakhouse USDC",
    symbol: "steakUSDC",
    netApy: 4.2,
    tvlUsd: 28_500_000,
    fee: 5,
    curators: ["Steakhouse Financial"],
    protocol: "morpho",
    chainId: ARBITRUM_CHAIN_ID,
    risk: "Low",
    live: false,
  },
];

interface GqlVaultItem {
  address: string;
  name: string;
  symbol: string;
  asset?: { address?: string; symbol?: string; decimals?: number };
  state?: { netApy?: number; apy?: number; totalAssetsUsd?: number; fee?: number };
}

// The API's VaultMetadata exposes only description/image, so the curator (risk
// manager) is derived from the vault name — its first token (e.g. "Steakhouse
// High Yield USDC" → "Steakhouse", "Gauntlet USDC Core" → "Gauntlet").
function curatorFromName(name: string): string[] {
  const first = name.trim().split(/\s+/)[0];
  return first ? [first] : [];
}

/** Fetch curated Arbitrum USDC vaults from the Morpho API (read-only, no key). */
export async function fetchMorphoVaults(): Promise<EarnVault[]> {
  const query = `query FurlpayEarnVaults($chainId: Int!) {
    vaults(
      first: 20
      orderBy: NetApy
      orderDirection: Desc
      where: { chainId_in: [$chainId], listed: true }
    ) {
      items {
        address
        name
        symbol
        asset { address symbol decimals }
        state { netApy apy totalAssetsUsd fee }
      }
    }
  }`;

  try {
    const res = await fetch(MORPHO_GRAPHQL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, variables: { chainId: ARBITRUM_CHAIN_ID } }),
      // Cache vault data briefly — APY doesn't need per-request freshness.
      next: { revalidate: 300 },
    } as RequestInit);
    if (!res.ok) throw new Error(`morpho api ${res.status}`);
    const json = (await res.json()) as { data?: { vaults?: { items?: GqlVaultItem[] } }; errors?: unknown };
    const items = json?.data?.vaults?.items;
    if (!Array.isArray(items) || items.length === 0) throw new Error("no vaults");

    const usdc = ARBITRUM_USDC.toLowerCase();
    const vaults = items
      .filter((v) => (v.asset?.address || "").toLowerCase() === usdc)
      .map((v): EarnVault => {
        // Morpho returns APY as a decimal (0.045 = 4.5%).
        const netApy = round((v.state?.netApy ?? v.state?.apy ?? 0) * 100);
        return {
          address: getAddress(v.address),
          name: v.name,
          symbol: v.symbol,
          netApy,
          tvlUsd: Math.round(v.state?.totalAssetsUsd ?? 0),
          fee: round((v.state?.fee ?? 0) * 100),
          curators: curatorFromName(v.name),
          protocol: "morpho",
          chainId: ARBITRUM_CHAIN_ID,
          risk: netApy > 8 ? "Medium" : "Low",
          live: true,
        };
      })
      .filter((v) => v.netApy > 0);

    return vaults.length > 0 ? vaults : FALLBACK_VAULTS;
  } catch {
    return FALLBACK_VAULTS;
  }
}

/** Resolve the vault to deposit into: env-pinned, else highest net APY. */
export async function selectVault(preferredAddress?: string): Promise<EarnVault> {
  const vaults = await fetchMorphoVaults();
  const pinned = preferredAddress || process.env.MORPHO_USDC_VAULT;
  if (pinned) {
    const match = vaults.find((v) => v.address.toLowerCase() === pinned.toLowerCase());
    if (match) return match;
  }
  return vaults.slice().sort((a, b) => b.netApy - a.netApy)[0];
}

// ---- ERC-4626 / ERC-20 encoding (non-custodial tx building) ----------------

const ERC20_APPROVE = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

const ERC4626 = [
  {
    name: "deposit",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assets", type: "uint256" },
      { name: "receiver", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "redeem",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "shares", type: "uint256" },
      { name: "receiver", type: "address" },
      { name: "owner", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "withdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assets", type: "uint256" },
      { name: "receiver", type: "address" },
      { name: "owner", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "convertToAssets",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "shares", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

export interface TxCall {
  to: string;
  data: Hex;
  value: string; // wei, always "0" here
}

/** USDC has 6 decimals. Convert a USD amount to atomic units. */
export function usdcAtomic(amountUsd: number): bigint {
  return BigInt(Math.round(amountUsd * 1e6));
}

/**
 * Build the non-custodial deposit bundle: approve USDC to the vault, then
 * ERC-4626 deposit(assets, receiver). The Safe signs and submits these.
 */
export function buildDepositBundle(vault: string, amountUsd: number, receiver: string): {
  chainId: number;
  calls: TxCall[];
} {
  const v = getAddress(vault);
  const to = getAddress(receiver);
  const assets = usdcAtomic(amountUsd);
  return {
    chainId: ARBITRUM_CHAIN_ID,
    calls: [
      {
        to: ARBITRUM_USDC,
        data: encodeFunctionData({ abi: ERC20_APPROVE, functionName: "approve", args: [v, assets] }),
        value: "0",
      },
      {
        to: v,
        data: encodeFunctionData({ abi: ERC4626, functionName: "deposit", args: [assets, to] }),
        value: "0",
      },
    ],
  };
}

/** Build the non-custodial redeem bundle: ERC-4626 redeem(shares, receiver, owner). */
export function buildRedeemBundle(vault: string, shares: bigint, owner: string): {
  chainId: number;
  calls: TxCall[];
} {
  const v = getAddress(vault);
  const o = getAddress(owner);
  return {
    chainId: ARBITRUM_CHAIN_ID,
    calls: [
      {
        to: v,
        data: encodeFunctionData({ abi: ERC4626, functionName: "redeem", args: [shares, o, o] }),
        value: "0",
      },
    ],
  };
}

/**
 * Read the current USD value of a Safe's vault shares on-chain (live mode).
 * Returns null when not live so callers fall back to APY-based valuation.
 */
export function buildWithdrawBundle(vault: string, amountUsd: number, owner: string): {
  chainId: number;
  calls: TxCall[];
} {
  const v = getAddress(vault);
  const o = getAddress(owner);
  const assets = usdcAtomic(amountUsd);
  return {
    chainId: ARBITRUM_CHAIN_ID,
    calls: [
      {
        to: v,
        data: encodeFunctionData({ abi: ERC4626, functionName: "withdraw", args: [assets, o, o] }),
        value: "0",
      },
    ],
  };
}

export async function readPositionValueUsd(vault: string, owner: string): Promise<number | null> {
  if (!earnIsLive()) return null;
  try {
    const { createPublicClient, http } = await import("viem");
    const { arbitrum } = await import("viem/chains");
    const client = createPublicClient({ chain: arbitrum, transport: http(process.env.ARBITRUM_RPC_URL) });
    const v = getAddress(vault);
    const shares = (await client.readContract({
      address: v,
      abi: ERC4626,
      functionName: "balanceOf",
      args: [getAddress(owner)],
    })) as bigint;
    if (shares === 0n) return 0;
    const assets = (await client.readContract({
      address: v,
      abi: ERC4626,
      functionName: "convertToAssets",
      args: [shares],
    })) as bigint;
    return Number(assets) / 1e6;
  } catch {
    return null;
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
