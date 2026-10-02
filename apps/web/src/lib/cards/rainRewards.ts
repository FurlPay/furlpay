import { flagEnabled } from "@/lib/flags";
import { rainRequest, RainNotConfiguredError } from "./rainAdapter";

// ---------------------------------------------------------------------------
// Rain Rewards — PROTOCOL UNVERIFIED, NOT WIRED.
//
// Rain markets a native rewards layer (rain.xyz/product/rewards), but its API
// reference sits behind a login (docs.rain.xyz) and the public Swagger hosts
// return 403 (checked 2026-10-02). The endpoint paths below were written
// without that reference and are ASSUMPTIONS: /rewards/balance/:id,
// /rewards/history/:id, /rewards/redeem. Nothing in the app calls this module.
//
// Every function is gated on REWARDS_LIVE, which lib/flags.ts marks
// `unimplemented` (no per-user rewards ledger), so they refuse whatever the
// environment says. An earlier draft checked `process.env.REWARDS_LIVE`
// directly, which bypassed that guard.
//
// Before wiring: confirm the paths and payloads against Rain's gated docs, and
// route any USD credit through apply_financial_effect with an effect key —
// a redemption that reports "credited" without a FurlPay ledger entry is a
// balance the user cannot spend.
// ---------------------------------------------------------------------------

export interface RainRewardsBalance {
  points: number;
  lifetimeEarned: number;
  lifetimeRedeemed: number;
}

export interface RainRewardsTransaction {
  id: string;
  type: "earn" | "redeem" | "expire";
  points: number;
  createdAt: string;
  transactionId?: string;
}

const UNVERIFIED = "Rain Rewards API paths are unverified (gated docs) and REWARDS_LIVE is unimplemented";

function assertLive(what: string): void {
  if (!flagEnabled("REWARDS_LIVE")) throw new RainNotConfiguredError(what, UNVERIFIED);
}

export async function getRewardsBalance(userId: string): Promise<RainRewardsBalance> {
  assertLive("get rewards balance");
  return rainRequest<RainRewardsBalance>("GET", `/rewards/balance/${encodeURIComponent(userId)}`);
}

export async function getRewardsHistory(userId: string): Promise<RainRewardsTransaction[]> {
  assertLive("get rewards history");
  const res = await rainRequest<{ history: RainRewardsTransaction[] }>("GET", `/rewards/history/${encodeURIComponent(userId)}`);
  return res.history;
}
