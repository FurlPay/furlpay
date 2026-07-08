import { readPositionValueUsd } from "./morpho";

// ---------------------------------------------------------------------------
// FurlPay Earn position book. Tracks each user's vault position (principal +
// accrued yield). Yield accrues continuously off the vault's net APY; in live
// mode the on-chain share value (convertToAssets) overrides the estimate.
//
// In-memory (demo) — mirrors lib/store's approach; a live build persists to the
// ledger and reconciles against on-chain balances. Not a securities offering:
// deposits go directly into the ERC-4626 vault, FurlPay is only the frontend.
// ---------------------------------------------------------------------------

export interface EarnPosition {
  id: string;
  vault: string;
  vaultName: string;
  protocol: "morpho";
  chainId: number;
  apy: number; // net APY %, snapshotted at deposit
  principalUsd: number; // cost basis (net of withdrawals)
  accruedUsd: number; // yield accrued so far
  lastAccruedAt: number; // ms
  openedAt: string; // ISO
  receiver: string; // Safe address that owns the shares
}

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

const g = globalThis as unknown as { __earnBook?: EarnPosition[] };
const book = g.__earnBook ?? (g.__earnBook = seed());

function seed(): EarnPosition[] {
  const now = Date.now();
  // One deterministic demo position so the Earn hero isn't empty.
  return [
    {
      id: "earn_seed_usdc",
      vault: "0xba9E3b3b684719F80657af1A19DEbc3C772494a0",
      vaultName: "Gauntlet USDC Core",
      protocol: "morpho",
      chainId: 42161,
      apy: 4.8,
      principalUsd: 2500,
      accruedUsd: 24.7, // ~ accrued over the opening window
      lastAccruedAt: now,
      openedAt: new Date(now - 78 * 24 * 60 * 60 * 1000).toISOString(),
      receiver: "0x0000000000000000000000000000000000000000",
    },
  ];
}

/** Settle continuous accrual up to `now` at the position's APY. */
function accrue(pos: EarnPosition, now = Date.now()): void {
  const dtYears = (now - pos.lastAccruedAt) / YEAR_MS;
  if (dtYears > 0) {
    pos.accruedUsd = round(pos.accruedUsd + pos.principalUsd * (pos.apy / 100) * dtYears);
    pos.lastAccruedAt = now;
  }
}

export function getPositions(): EarnPosition[] {
  const now = Date.now();
  for (const p of book) accrue(p, now);
  return book;
}

/** Open a new position or add principal to the matching vault position. */
export function addToPosition(params: {
  vault: string;
  vaultName: string;
  apy: number;
  chainId: number;
  amountUsd: number;
  receiver: string;
}): EarnPosition {
  const now = Date.now();
  let pos = book.find((p) => p.vault.toLowerCase() === params.vault.toLowerCase());
  if (pos) {
    accrue(pos, now);
    pos.principalUsd = round(pos.principalUsd + params.amountUsd);
    pos.apy = params.apy; // refresh to latest snapshot
  } else {
    pos = {
      id: `earn_${now.toString(36)}`,
      vault: params.vault,
      vaultName: params.vaultName,
      protocol: "morpho",
      chainId: params.chainId,
      apy: params.apy,
      principalUsd: round(params.amountUsd),
      accruedUsd: 0,
      lastAccruedAt: now,
      openedAt: new Date(now).toISOString(),
      receiver: params.receiver,
    };
    book.push(pos);
  }
  return pos;
}

export interface WithdrawResult {
  ok: boolean;
  withdrawnUsd: number;
  remainingUsd: number;
  error?: string;
}

/** Withdraw USD from a vault position (yield first, then principal). */
export function withdrawFromPosition(vault: string, amountUsd: number): WithdrawResult {
  const pos = book.find((p) => p.vault.toLowerCase() === vault.toLowerCase());
  if (!pos) return { ok: false, withdrawnUsd: 0, remainingUsd: 0, error: "no_position" };
  accrue(pos);
  const total = pos.principalUsd + pos.accruedUsd;
  if (amountUsd <= 0 || amountUsd > total + 1e-6) {
    return { ok: false, withdrawnUsd: 0, remainingUsd: round(total), error: "invalid_amount" };
  }
  // Draw from accrued yield first, then principal.
  let remaining = amountUsd;
  const fromYield = Math.min(pos.accruedUsd, remaining);
  pos.accruedUsd = round(pos.accruedUsd - fromYield);
  remaining = round(remaining - fromYield);
  pos.principalUsd = round(pos.principalUsd - remaining);

  if (pos.principalUsd <= 0.005 && pos.accruedUsd <= 0.005) {
    book.splice(book.indexOf(pos), 1);
  }
  return { ok: true, withdrawnUsd: round(amountUsd), remainingUsd: round(pos.principalUsd + pos.accruedUsd) };
}

export interface ValuedPosition {
  id: string;
  vault: string;
  vaultName: string;
  protocol: string;
  apy: number;
  principalUsd: number;
  currentValueUsd: number;
  earnedUsd: number;
  days: number;
  live: boolean;
}

/** Value every position; in live mode prefer the on-chain share value. */
export async function valuePositions(): Promise<ValuedPosition[]> {
  const positions = getPositions();
  return Promise.all(
    positions.map(async (p): Promise<ValuedPosition> => {
      const onChain = await readPositionValueUsd(p.vault, p.receiver).catch(() => null);
      const estimate = round(p.principalUsd + p.accruedUsd);
      const currentValueUsd = onChain ?? estimate;
      return {
        id: p.id,
        vault: p.vault,
        vaultName: p.vaultName,
        protocol: p.protocol,
        apy: p.apy,
        principalUsd: round(p.principalUsd),
        currentValueUsd: round(currentValueUsd),
        earnedUsd: round(currentValueUsd - p.principalUsd),
        days: Math.max(0, Math.floor((Date.now() - Date.parse(p.openedAt)) / (24 * 60 * 60 * 1000))),
        live: onChain !== null,
      };
    }),
  );
}

export async function earnSummary() {
  const valued = await valuePositions();
  const totalPrincipal = round(valued.reduce((s, p) => s + p.principalUsd, 0));
  const totalValue = round(valued.reduce((s, p) => s + p.currentValueUsd, 0));
  const totalEarned = round(totalValue - totalPrincipal);
  const blendedApy =
    totalPrincipal > 0 ? round(valued.reduce((s, p) => s + p.apy * p.principalUsd, 0) / totalPrincipal) : 0;
  return {
    positions: valued,
    summary: {
      totalPrincipal,
      totalValue,
      totalEarned,
      blendedApy,
      projectedYearly: round((totalPrincipal * blendedApy) / 100),
    },
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
