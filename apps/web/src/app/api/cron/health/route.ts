import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { requireCron } from "@/lib/cron/auth";
import { cronHttpStatus, isJobHealthy, runJob } from "@/lib/cron/runner";
import { raiseAlert } from "@/lib/alerts";
import { getBrokerageOrNull } from "@/lib/brokerage";
import { evmRpcFor, solanaRpc } from "@/lib/onchain/balances";
import { kvBackend, kvErrorCategory, kvGet } from "@/lib/kv";
import { flagState } from "@/lib/flags";

/** Read-only sentinel: the probe never writes, so it costs one command and cannot collide with real state. */
const KV_PROBE_KEY = "health:kv-probe";

// GET /api/cron/health — provider reachability, and the watchdog on the
// scheduler itself.
//
// THE WATCHDOG IS THE POINT. A reconciliation job that stops running generates
// no errors, no alerts and no logs — it is the one failure mode that is
// completely silent, and the only thing that catches it is a *different* job
// noticing the first one has gone quiet. That is `isJobHealthy` below.
//
// This job deliberately does not check itself. A watchdog that watches only
// itself proves nothing; if the whole scheduler stops, nothing here fires and
// the absence must be caught by an external uptime check on this endpoint.
// That external check is NOT configured — recorded honestly in the response so
// it is visible rather than assumed.

/** How stale each job may get before it is considered stopped. Generous
 *  multiples of the intended cadence, so ordinary jitter does not alarm. */
const FRESHNESS: Record<string, number> = {
  "brokerage.reconcile": 3 * 3600,
};

export async function GET(req: NextRequest) {
  const auth = requireCron(req);
  if (!auth.ok) return auth.res;

  const checks: { id: string; ok: boolean; detail: string; latencyMs?: number }[] = [];

  // ---- Durable state, LIVE ---------------------------------------------
  // Deliberately OUTSIDE runJob. runJob takes its lock in KV first, so when
  // KV refuses commands (a plan limit, a revoked token, an outage) it returns
  // "job not run" before any check below executes — the health job goes quiet
  // at exactly the moment it has something to say. `kvBackend === "redis"`
  // only proves the credentials are present, not that a command succeeds.
  // raiseAlert tolerates a failing KV (counting and history are best-effort),
  // so this is the one alert that can still leave the building.
  if (kvBackend === "redis") {
    const started = Date.now();
    try {
      await kvGet(KV_PROBE_KEY);
      checks.push({ id: "kv:live", ok: true, latencyMs: Date.now() - started, detail: "A read against durable KV succeeded." });
    } catch (e) {
      const category = kvErrorCategory(e);
      checks.push({
        id: "kv:live",
        ok: false,
        latencyMs: Date.now() - started,
        detail: `Durable KV refused a read [${category}]. Rate limits, rail controls and scheduled jobs that depend on it are failing closed.`,
      });
      await raiseAlert({
        kind: "infra.kv_unavailable",
        severity: "critical",
        title: "Durable KV is refusing commands",
        detail:
          `A read against durable KV failed with category "${category}". Rail status, x402 controls, ` +
          "rate-limited sign-in and every scheduled job that locks through KV are unavailable until it recovers.",
        dimensions: { category },
      });
    }
  }

  const outcome = await runJob("ops.health", async (ctx) => {
    // ---- Scheduler watchdog -------------------------------------------
    for (const [job, maxAge] of Object.entries(FRESHNESS)) {
      const health = await isJobHealthy(job, maxAge);
      checks.push({ id: `job:${job}`, ok: health.healthy, detail: health.detail });
      if (!health.healthy) {
        ctx.metric("stale_jobs", 1);
        await raiseAlert({
          kind: "cron.job_stale",
          severity: "high",
          title: `Scheduled job "${job}" is not running`,
          detail: health.detail,
          dimensions: { job },
          context: { maxAgeSeconds: maxAge },
        });
      }
    }

    // ---- Durable state -------------------------------------------------
    checks.push({
      id: "kv",
      ok: kvBackend === "redis",
      detail:
        kvBackend === "redis"
          ? "Durable KV is Redis-backed."
          : "KV is the in-memory fallback; order records would not survive a cold start.",
    });
    if (kvBackend !== "redis") {
      ctx.metric("degraded", 1);
      await raiseAlert({
        kind: "infra.kv_not_durable",
        severity: "critical",
        title: "Durable KV is unavailable",
        detail: "Order records, dedupe claims and rate limits are running on per-instance memory.",
        dimensions: { backend: kvBackend },
      });
    }

    // ---- Brokerage ------------------------------------------------------
    const brokerage = getBrokerageOrNull();
    if (!brokerage) {
      checks.push({ id: "brokerage", ok: true, detail: "Brokerage is disabled on this deployment (not an error)." });
    } else {
      const started = Date.now();
      try {
        const account = await brokerage.getAccount();
        const latencyMs = Date.now() - started;
        // A reachable but BLOCKED account is not healthy — orders would be
        // rejected, and the useful alert fires here rather than on a user's
        // failed trade.
        const ok = !account.tradingBlocked;
        checks.push({
          id: "brokerage",
          ok,
          latencyMs,
          detail: ok
            ? `${brokerage.name} reachable, status ${account.status}.`
            : `${brokerage.name} reachable but trading is blocked: ${account.restrictions.join(", ")}.`,
        });
        if (!ok) {
          ctx.metric("provider_degraded", 1);
          await raiseAlert({
            kind: "brokerage.trading_blocked",
            severity: "high",
            title: "Brokerage account cannot trade",
            detail: `${brokerage.name} reports restrictions: ${account.restrictions.join(", ") || "unknown"}.`,
            dimensions: { provider: brokerage.name },
            context: { status: account.status },
          });
        }
      } catch (e) {
        const latencyMs = Date.now() - started;
        checks.push({ id: "brokerage", ok: false, latencyMs, detail: e instanceof Error ? e.message : "unreachable" });
        ctx.metric("provider_down", 1);
        await raiseAlert({
          kind: "brokerage.unreachable",
          severity: "high",
          title: "Brokerage is unreachable",
          detail: `${brokerage.name} did not answer an account read: ${e instanceof Error ? e.message : "error"}`,
          dimensions: { provider: brokerage.name },
        });
      }
    }

    // ---- Chain RPCs ------------------------------------------------------
    // Only checked when on-chain reads are actually enabled. Alerting about an
    // unconfigured RPC on a deployment that does not use one is noise.
    if (flagState("ONCHAIN_BALANCES_LIVE").on) {
      for (const chain of ["arbitrum", "base", "ethereum"]) {
        const url = evmRpcFor(chain);
        if (!url) continue;
        const started = Date.now();
        try {
          const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
            signal: AbortSignal.timeout(6_000),
          });
          const ok = res.ok;
          checks.push({ id: `rpc:${chain}`, ok, latencyMs: Date.now() - started, detail: ok ? "reachable" : `HTTP ${res.status}` });
          if (!ok) {
            ctx.metric("rpc_down", 1);
            await raiseAlert({
              kind: "infra.rpc_unreachable",
              severity: "high",
              title: `${chain} RPC is unhealthy`,
              detail: `eth_blockNumber returned HTTP ${res.status}. On-chain balances will report unavailable.`,
              dimensions: { chain },
            });
          }
        } catch (e) {
          checks.push({ id: `rpc:${chain}`, ok: false, latencyMs: Date.now() - started, detail: e instanceof Error ? e.message : "error" });
          ctx.metric("rpc_down", 1);
          await raiseAlert({
            kind: "infra.rpc_unreachable",
            severity: "high",
            title: `${chain} RPC is unreachable`,
            detail: e instanceof Error ? e.message : "error",
            dimensions: { chain },
          });
        }
      }

      const sol = solanaRpc();
      if (sol) {
        const started = Date.now();
        try {
          const res = await fetch(sol, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }),
            signal: AbortSignal.timeout(6_000),
          });
          checks.push({ id: "rpc:solana", ok: res.ok, latencyMs: Date.now() - started, detail: res.ok ? "reachable" : `HTTP ${res.status}` });
        } catch (e) {
          checks.push({ id: "rpc:solana", ok: false, detail: e instanceof Error ? e.message : "error" });
          ctx.metric("rpc_down", 1);
        }
      }
    }

    ctx.metric("checks", checks.length);
    ctx.metric("failing", checks.filter((c) => !c.ok).length);
  });

  return NextResponse.json({
    job: "ops.health",
    status: outcome.status,
    checks,
    /** Stated rather than assumed: nothing outside this deployment is
     *  watching whether the scheduler itself still runs. */
    externalUptimeCheckConfigured: false,
    ...("detail" in outcome ? { detail: outcome.detail } : { record: outcome.record, recorded: outcome.recorded }),
  }, { status: cronHttpStatus(outcome) });
}

// Vercel Cron calls GET; EventBridge Scheduler (infra/aws/modules/env/scheduler.tf)
// calls POST — it used to get a 405 (audit P1-3). Same handler, same auth.
export const POST = GET;
