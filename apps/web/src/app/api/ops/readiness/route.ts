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
import { ledgerDurable } from "@/lib/ledger";
import { cronConfigured } from "@/lib/cron/auth";
import { notifierConfigured } from "@/lib/alerts";
import { lastRun } from "@/lib/cron/runner";
import { placesDatasetReadiness } from "@/lib/hotels/googlePlacesLayer";
import { googlePlacesConfigured } from "@/lib/hotels/googlePlaces";

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

  // ── Settlement RPCs ───────────────────────────────────────────────────
  //
  // Every chain in lib/services/chainRegistry.ts falls back to a PUBLIC RPC
  // (arb1.arbitrum.io, mainnet.base.org, eth.llamarpc.com, polygon-rpc.com) when
  // no override is set. Those rate-limit, and a rate-limited RPC in the middle
  // of a settlement is a money-safety event, not a slow page: the settler can
  // submit and then fail to observe confirmation, which lands the payment in
  // the pending path with the payer possibly already debited.
  //
  // The FALLBACK is reported separately and is NOT blocking. One private RPC is
  // the requirement; a second is what turns a provider outage into a failover
  // instead of a settlement freeze (x402Chains.rpcTransport only builds viem's
  // fallback transport when both are present).
  const settlementRpcNetworks = ["ARBITRUM", "BASE"] as const;
  for (const network of settlementRpcNetworks) {
    const primary = (process.env[`${network}_RPC_URL`] ?? "").trim();
    const fallback = (process.env[`${network}_RPC_URL_FALLBACK`] ?? "").trim();
    checks.push({
      id: `rpc.${network.toLowerCase()}.private`,
      ok: primary.length > 0,
      blocking: environment === "production",
      detail: primary
        ? `${network} uses a configured RPC endpoint.`
        : `${network}_RPC_URL is unset, so the public default is in use. Public RPCs rate-limit, ` +
          "and a rate-limited RPC mid-settlement can leave a payment submitted but unconfirmed.",
    });
    checks.push({
      id: `rpc.${network.toLowerCase()}.failover`,
      ok: Boolean(primary && fallback),
      blocking: false,
      detail:
        primary && fallback
          ? `${network} has a secondary RPC; viem fails over automatically.`
          : `${network}_RPC_URL_FALLBACK is unset. A provider outage would stop settlement on this ` +
            "chain rather than failing over.",
    });
  }

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

  // Separate from database.configured on purpose. Credentials being present is
  // not the same statement as "the ledger migration is applied and postings are
  // landing in Postgres" — and a clean reconciliation run against an empty
  // in-memory book is the most misleading green light this system can show.
  // lib/ledger.assertLedgerDurable() refuses to post in production when this is
  // false, so a red here means money routes are already returning 503, not that
  // they are quietly writing somewhere unsafe.
  checks.push({
    id: "ledger.durable",
    ok: ledgerDurable(),
    blocking: environment === "production",
    detail: ledgerDurable()
      ? "Ledger postings are written to Postgres (migration 0009)."
      : "The ledger has no durable backend. In production every money posting refuses " +
        "(LedgerDurabilityError) rather than landing in a per-instance memory book. Apply " +
        "supabase/migrations/0009_payments_and_ledger.sql.",
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

  // ── Scheduler ─────────────────────────────────────────────────────────
  checks.push({
    id: "cron.configured",
    ok: cronConfigured(),
    blocking: false,
    detail: cronConfigured()
      ? "A cron secret is set; scheduled jobs will run."
      : "No CRON_SECRET or FURLPAY_CRON_SECRET. Scheduled jobs return 503 and reconciliation never runs.",
  });

  // Has the reconciler actually run, as opposed to merely being configured?
  // The distinction matters: a job that silently stops generates no errors.
  const reconcileRun = await lastRun("brokerage.reconcile");
  checks.push({
    id: "cron.reconcile_ran",
    ok: reconcileRun !== null,
    blocking: false,
    detail: reconcileRun
      ? `Reconciliation last ran ${reconcileRun.finishedAt} (ok: ${reconcileRun.ok}).`
      : "Reconciliation has never run on this deployment.",
  });

  // ── Data freshness ────────────────────────────────────────────────────
  const places = placesDatasetReadiness();
  checks.push({ id: "travel.places_dataset", ok: places.ok, blocking: false, detail: `[${places.state}] ${places.detail}` });
  // The live path (/api/places/discover) is separate from the snapshot. This
  // reports configuration only: a set key is not proof the provider answers,
  // and a provider failure surfaces as a 502/503 from that route at call time.
  checks.push({
    id: "travel.places_live",
    ok: googlePlacesConfigured(),
    blocking: false,
    detail: googlePlacesConfigured()
      ? "GOOGLE_PLACES_API_KEY is set; live place discovery can be attempted (reachability not checked here)."
      : "GOOGLE_PLACES_API_KEY is not set; /api/places/discover answers 503.",
  });

  // ── Alerting ──────────────────────────────────────────────────────────
  checks.push({
    id: "alerts.notifier",
    ok: notifierConfigured(),
    blocking: false,
    detail: notifierConfigured()
      ? "An alert notifier is configured."
      : "No alert notifier. Findings are written to logs only — nobody is paged.",
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
