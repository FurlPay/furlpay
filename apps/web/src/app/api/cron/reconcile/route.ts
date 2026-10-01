import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
// The default 10s ceiling is not enough to poll a set of open orders across
// several accounts. 60s is the Vercel Hobby/Pro function maximum; the job's own
// budget (see runJob) stops it before the platform does.
export const maxDuration = 60;

import { requireCron } from "@/lib/cron/auth";
import { runJob } from "@/lib/cron/runner";
import { raiseAlert } from "@/lib/alerts";
import { runReconciliation } from "@/lib/reconciliation";
import { getBrokerageOrNull } from "@/lib/brokerage";
import { reconcileUser, needsAttention } from "@/lib/brokerage/reconcile";
import { syncOpenOrders, syncNeedsAttention } from "@/lib/brokerage/sync";
import { listAccounts } from "@/lib/store";

// GET /api/cron/reconcile — sync open orders, then reconcile against the broker.
//
// AUTHENTICATED. A cron endpoint is a mutation endpoint that a scheduler calls
// over plain HTTP; "nothing links to it" is not a control. See lib/cron/auth.ts
// — with no secret configured this returns 503 rather than running.
//
// TWO PASSES, in this order and for a reason:
//
//   1. SYNC advances what we already know is open. Cheap, and it closes the
//      ordinary case where a fill landed after the request that created it
//      returned.
//   2. RECONCILE compares both sides in full, and finds what sync cannot: an
//      order the provider has that we do not, a position quantity that
//      disagrees, a fill we booked that never happened.
//
// Reconciling first would raise findings that the sync was about to resolve,
// which is how an alerting channel becomes noise.
//
// THIS JOB CHANGES NO FINANCIAL STATE beyond applying provider-authoritative
// order updates. It does not repair discrepancies — see docs/RECONCILIATION.md
// for why auto-correction turns a detection bug into a money bug.

export async function GET(req: NextRequest) {
  const auth = requireCron(req);
  if (!auth.ok) return auth.res;

  const outcome = await runJob("brokerage.reconcile", async (ctx) => {
    // ---- 0. THE LEDGER ITSELF ------------------------------------------
    //
    // migration 0009 shipped two views for exactly this — `ledger_imbalance`
    // and `payments_missing_ledger` — and its comment says they are "meant to
    // be alerted on, not just queried by hand". Nothing alerted on them. A
    // detection control nobody is paged by is a detection control that does not
    // exist, and the second view is the most serious signal this system can
    // produce: a payment marked settled with no ledger entry means money moved
    // on-chain and was never recorded.
    //
    // Run FIRST, and independently of the brokerage: the books must be checked
    // even on a deployment with no broker configured, which is every deployment
    // today. That ordering is why the brokerage early-return moved below it.
    try {
      const books = await runReconciliation();
      ctx.metric("ledger_checks", books.checks.length);
      ctx.note(`Ledger reconciliation: ${books.status} (durable=${books.durable}).`);

      for (const check of books.checks) {
        if (check.severity === "ok") continue;
        ctx.metric(check.severity === "critical" ? "ledger_critical" : "ledger_warnings", 1);
        await raiseAlert({
          kind: `ledger.${check.id}`,
          severity: check.severity === "critical" ? "critical" : "high",
          title:
            check.id === "settled_without_ledger"
              ? "A settled payment has no ledger entry"
              : check.id === "ledger_balance"
                ? "The ledger does not balance"
                : "Ledger reconciliation is incomplete",
          detail: check.summary,
          // Fingerprinted per check so a standing break is one alert with a
          // rising count, not a page every run.
          dimensions: { check: check.id },
          // The alert context is a flat scalar map by contract, and a check's
          // `detail` is free-form. Coerce rather than cast: an object arriving
          // in a Discord payload renders as "[object Object]", which is how a
          // page ends up carrying no usable information.
          context: Object.fromEntries(
            Object.entries(check.detail ?? {}).map(([k, v]) => [
              k,
              typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v === null
                ? v
                : JSON.stringify(v),
            ])
          ),
        });
      }
    } catch (e) {
      // runReconciliation() is documented never to throw; if it somehow does,
      // that is itself the finding — a silent reconciliation is the failure
      // mode this whole job exists to prevent.
      ctx.metric("ledger_errors", 1);
      await raiseAlert({
        kind: "ledger.reconciliation_failed",
        severity: "critical",
        title: "Ledger reconciliation could not run",
        detail: e instanceof Error ? e.message : "unknown error",
        dimensions: { check: "runner" },
      });
    }

    const brokerage = getBrokerageOrNull();
    if (!brokerage) {
      ctx.note("Brokerage is not available on this deployment; nothing further to reconcile.");
      ctx.metric("skipped", 1);
      return;
    }

    // In-memory accounts on this instance. Bounded on purpose: a full user
    // scan belongs behind a paginated query once orders live in Postgres, and
    // silently reconciling a partial set while reporting success would be the
    // same class of lie this system exists to prevent — so the note records
    // exactly what was covered.
    const accounts = listAccounts();
    ctx.note(`Reconciling ${accounts.length} account(s) resolvable on this instance.`);

    for (const account of accounts) {
      if (ctx.expired()) {
        ctx.note("Budget exhausted; remaining accounts deferred to the next run.");
        break;
      }
      const userId = account.user.id;

      // ---- 1. Sync ----------------------------------------------------
      try {
        const sync = await syncOpenOrders(userId, brokerage, { max: 25 });
        ctx.metric("orders_checked", sync.checked);
        ctx.metric("orders_advanced", sync.advanced);
        ctx.metric("orders_settled", sync.settled);

        if (syncNeedsAttention(sync)) {
          ctx.metric("sync_findings", 1);
          if (sync.orphaned.length > 0) {
            await raiseAlert({
              kind: "brokerage.order_orphaned",
              severity: "critical",
              title: "Submitted orders missing at the broker",
              detail:
                `${sync.orphaned.length} order(s) we recorded as submitted do not exist at ${brokerage.name}. ` +
                "Either the submission never landed, or they were placed on a different account.",
              dimensions: { userId, provider: brokerage.name },
              context: { orderIds: sync.orphaned.slice(0, 5).join(", "), count: sync.orphaned.length },
            });
          }
        }
      } catch (e) {
        ctx.metric("sync_errors", 1);
        ctx.note(`sync failed for ${userId}: ${e instanceof Error ? e.message : "error"}`);
      }

      if (ctx.expired()) break;

      // ---- 2. Reconcile ------------------------------------------------
      try {
        const report = await reconcileUser(
          userId,
          account.holdings.map((h) => ({ symbol: h.symbol, shares: h.shares })),
          brokerage,
          { orderLimit: 50 }
        );
        ctx.metric("reconciled_users", 1);
        ctx.metric("critical_findings", report.summary.critical);
        ctx.metric("warning_findings", report.summary.warnings);

        if (needsAttention(report)) {
          const positionMismatches = report.positions.filter((p) => p.status !== "MATCHED");
          await raiseAlert({
            kind: "brokerage.reconciliation_mismatch",
            severity: report.summary.critical > 0 ? "critical" : "high",
            title: report.incomplete
              ? "Reconciliation could not complete"
              : "Reconciliation found a mismatch",
            detail:
              report.incomplete ??
              `${report.summary.critical} critical and ${report.summary.warnings} warning finding(s) ` +
                `across ${report.summary.ordersChecked} order(s) and ${report.summary.positionsChecked} position(s).`,
            // Fingerprinted per user+provider, so a standing mismatch is one
            // alert with a rising count rather than one page per run.
            dimensions: { userId, provider: brokerage.name },
            context: {
              critical: report.summary.critical,
              warnings: report.summary.warnings,
              incomplete: report.incomplete ?? false,
              positions: positionMismatches.slice(0, 3).map((p) => `${p.symbol}:${p.difference}`).join(", "),
            },
          });
        }
      } catch (e) {
        ctx.metric("reconcile_errors", 1);
        ctx.note(`reconcile failed for ${userId}: ${e instanceof Error ? e.message : "error"}`);
      }
    }
  });

  // 200 even on a failed run. The scheduler's job is to invoke; a 500 would
  // trigger a retry of work that may have half-completed.
  return NextResponse.json({
    job: "brokerage.reconcile",
    status: outcome.status,
    ...(outcome.status === "skipped_locked" ? { detail: outcome.detail } : { record: outcome.record }),
  });
}

// Vercel Cron calls GET; EventBridge Scheduler (infra/aws/modules/env/scheduler.tf)
// calls POST — it used to get a 405 (audit P1-3). Same handler, same auth.
export const POST = GET;
