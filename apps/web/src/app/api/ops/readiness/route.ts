import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { requireRole } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { allFlagStates, financialEnvironment, moneyKillSwitchEngaged } from "@/lib/flags";
import { brokerageIsLive } from "@/lib/brokerage";
import { registryAudit } from "@/lib/onchain/stockTokenRegistry";
import { evmRpcFor, solanaRpc } from "@/lib/onchain/balances";
import { backerAudit } from "@/lib/markets/backers";
import { kvBackend } from "@/lib/kv";

// GET /api/ops/readiness — can this deployment move real money, and if not, why?
//
// The one screen that answers "are we live" without anybody reading code. It
// exists because the honest answer is not a single boolean: a deployment can
// have brokerage credentials and no KMS, a verified registry and no RPC, or
// every credential in place behind an engaged kill switch. Each of those is a
// different sentence, and collapsing them into "ready: false" tells an operator
// nothing they can act on.
//
// ADMIN ONLY. The response enumerates which capabilities are off and which
// credentials are absent — a precise map of where this deployment is weakest,
// which is exactly the reconnaissance an attacker would want. Names only, never
// values, but even the names are not public.

interface Check {
  id: string;
  ok: boolean;
  /** `true` = this blocks real money movement. A failing non-blocking check is
   *  a gap worth closing, not a reason to refuse to operate. */
  blocking: boolean;
  detail: string;
}

export async function GET(req: NextRequest) {
  const auth = await requireRole(req, "admin");
  if (!auth.ok) return auth.res;

  const limited = await rateLimitOr429(req, "ops.readiness", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  const environment = financialEnvironment();
  const flags = allFlagStates();
  const registry = registryAudit();
  const backers = backerAudit();

  const checks: Check[] = [];

  // ── Durable state ─────────────────────────────────────────────────────
  checks.push({
    id: "kv.durable",
    ok: kvBackend === "redis",
    blocking: environment === "production",
    detail:
      kvBackend === "redis"
        ? "Durable KV is backed by Redis."
        : "KV is the in-memory fallback. Order records and rate limits would not survive a cold start, " +
          "and an order written on one instance would be invisible to the next.",
  });

  checks.push({
    id: "database.configured",
    ok: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
    blocking: environment === "production",
    detail: process.env.SUPABASE_URL
      ? "Supabase is configured; accounts hydrate from Postgres."
      : "No Supabase credentials. Account state lives only in process memory and is lost on restart.",
  });

  // ── Session integrity ─────────────────────────────────────────────────
  const sessionSecret = process.env.FURLPAY_SESSION_SECRET ?? "";
  checks.push({
    id: "session.secret",
    ok: sessionSecret.length >= 32,
    blocking: environment === "production",
    detail:
      sessionSecret.length >= 32
        ? "Session signing secret is present and long enough."
        : "FURLPAY_SESSION_SECRET is missing or under 32 characters. A predictable key lets anyone forge a session.",
  });

  // ── Brokerage ─────────────────────────────────────────────────────────
  checks.push({
    id: "brokerage.live",
    ok: brokerageIsLive(),
    // Not blocking: a deployment with brokerage off is correctly configured for
    // every other capability. It simply cannot trade.
    blocking: false,
    detail: brokerageIsLive()
      ? "Orders route to the live brokerage."
      : "Brokerage is off. Order submissions return 503 rather than a simulated fill.",
  });

  // ── On-chain ──────────────────────────────────────────────────────────
  const rpcs = {
    arbitrum: Boolean(evmRpcFor("arbitrum")),
    base: Boolean(evmRpcFor("base")),
    ethereum: Boolean(evmRpcFor("ethereum")),
    solana: Boolean(solanaRpc()),
  };
  checks.push({
    id: "onchain.rpc",
    ok: Object.values(rpcs).some(Boolean),
    blocking: false,
    detail: Object.values(rpcs).some(Boolean)
      ? `RPC configured for: ${Object.entries(rpcs).filter(([, v]) => v).map(([k]) => k).join(", ")}.`
      : "No chain RPC is configured. On-chain balances cannot be read and report as unavailable.",
  });

  // ── Tokenized equities ────────────────────────────────────────────────
  checks.push({
    id: "registry.verified",
    ok: registry.anyTradable,
    blocking: false,
    detail: registry.anyTradable
      ? `${registry.active} of ${registry.total} registry entries are verified and tradable.`
      : `No tokenized-equity contract address has been verified (${registry.missingAddress} of ${registry.total} ` +
        "entries have no address). Tokenized positions and routes stay unavailable until an address is " +
        "confirmed against its issuer.",
  });

  // ── Curated datasets awaiting a human ─────────────────────────────────
  const backersPending = backers.filter((b) => b.verified < b.total);
  checks.push({
    id: "backers.verified",
    ok: backersPending.length === 0,
    blocking: false,
    detail:
      backersPending.length === 0
        ? "Every strategic-backer entry has been verified against its source."
        : `${backersPending.length} symbol(s) have unverified backer entries; none are rendered until verified.`,
  });

  // ── Key management ────────────────────────────────────────────────────
  const kms = (process.env.FURLPAY_KMS_PROVIDER ?? "").trim();
  checks.push({
    id: "kms.configured",
    ok: kms.length > 0 && kms !== "env",
    blocking: false,
    detail:
      kms.length === 0
        ? "No key-management provider is configured. On-chain settlement stays disabled."
        : kms === "env"
          ? "Signing keys are read from environment variables. Acceptable outside production; not for production custody."
          : `Signing goes through ${kms}.`,
  });

  const blockingFailures = checks.filter((c) => c.blocking && !c.ok);
  const advisoryFailures = checks.filter((c) => !c.blocking && !c.ok);

  return NextResponse.json({
    environment,
    killSwitchEngaged: moneyKillSwitchEngaged(),
    /** True only when nothing that BLOCKS money movement is failing. It does
     *  not mean every capability is on — read `flags` for that. */
    ready: blockingFailures.length === 0 && !moneyKillSwitchEngaged(),
    checks,
    blockingFailures: blockingFailures.map((c) => c.id),
    advisoryFailures: advisoryFailures.map((c) => c.id),
    flags: flags.map((f) => ({
      flag: f.flag,
      on: f.on,
      reason: f.blocker?.reason ?? null,
      detail: f.blocker?.detail ?? null,
      description: f.description,
    })),
    registry,
    ranAt: new Date().toISOString(),
  });
}
