import {
  ledgerImbalance,
  paymentsMissingLedger,
  paymentsDurable,
  ftxSettledWithoutLedger,
  ftxCompletedWithoutEvidence,
  ftxStaleInFlight,
  ftxAwaitingReview,
  type FtxFindingRow,
} from "@/lib/paymentsDb";
import { log } from "@/lib/log";

// ---------------------------------------------------------------------------
// Reconciliation — the check that the books are internally consistent.
//
// A double-entry ledger cannot tell you it is wrong. It can only tell you that
// its debits and credits disagree, which is a much narrower claim than "the
// money is right". This module runs the three checks that ARE decidable from
// our own data, and is explicit that a clean result is not proof of solvency:
//
//   1. GLOBAL BALANCE. Sum of debits == sum of credits across every posting.
//      This can only break if a write bypassed ledger_post (which rejects
//      unbalanced input) or if a posting was mutated (which the append-only
//      trigger forbids). A non-zero imbalance therefore means a defect has
//      already been written to the books, not that a request failed.
//
//   2. SETTLED WITHOUT A LEDGER ENTRY. A payment marked `settled` whose
//      ledger_tx_id is null or dangling. settle_payment_atomic posts the entry
//      and flips the status in ONE transaction, so this set is empty by
//      construction — unless something wrote `settled` directly, which is
//      exactly the bypass worth alerting on. This is the most serious of the
//      three: it means money moved on-chain and was never recorded.
//
//   3. DURABILITY. Whether a durable backend is configured at all. Reported
//      because the other two checks are vacuously clean when the ledger lives
//      in a per-instance Map: "no imbalance" from an empty database is not the
//      same statement as "no imbalance".
//
// WHAT THIS DOES NOT CHECK, and would need a chain indexer to: that every
// on-chain transfer has a matching payment row (the opposite direction of
// check 2), and that our recorded balances match token balances on-chain.
// Claiming those here would be the kind of overreach this codebase has been
// pruning elsewhere.
// ---------------------------------------------------------------------------

export type ReconciliationSeverity = "ok" | "warn" | "critical";

export interface ReconciliationCheck {
  id: string;
  severity: ReconciliationSeverity;
  /** One line, safe to put straight into an alert. */
  summary: string;
  detail?: Record<string, unknown>;
}

export interface ReconciliationReport {
  checkedAt: string;
  durable: boolean;
  /** Worst severity across all checks — what a pager should read. */
  status: ReconciliationSeverity;
  checks: ReconciliationCheck[];
}

const RANK: Record<ReconciliationSeverity, number> = { ok: 0, warn: 1, critical: 2 };

function worst(checks: ReconciliationCheck[]): ReconciliationSeverity {
  return checks.reduce<ReconciliationSeverity>(
    (acc, c) => (RANK[c.severity] > RANK[acc] ? c.severity : acc),
    "ok"
  );
}

/**
 * Run one view-backed check and append its result.
 *
 * Factored out because the four 0014 checks differ only in which view they read
 * and what a non-empty result means. Three outcomes, and the middle one is the
 * one that gets forgotten when this is written inline four times:
 *
 *   view unavailable -> WARN. The migration is not applied. An empty result
 *                       from a table that does not exist is not "clean", and
 *                       reporting it as ok is the exact false green this module
 *                       exists to avoid.
 *   rows found       -> the check's own severity.
 *   no rows          -> ok.
 *
 * Never throws: a reconciliation run that dies tells an operator nothing, and a
 * monitor that errors is usually muted.
 */
async function runFtxCheck(
  checks: ReconciliationCheck[],
  spec: {
    id: string;
    severity: Exclude<ReconciliationSeverity, "ok">;
    read: () => Promise<FtxFindingRow[] | null>;
    bad: (count: number) => string;
    good: string;
  }
): Promise<void> {
  try {
    const rows = await spec.read();
    if (!rows) {
      checks.push({
        id: spec.id,
        severity: "warn",
        summary: `${spec.id}: view unavailable — migration 0014 may not be applied.`,
      });
      return;
    }
    if (rows.length > 0) {
      checks.push({
        id: spec.id,
        severity: spec.severity,
        summary: spec.bad(rows.length),
        // Ids only. This reaches an ops console and a chat webhook, so it
        // carries no counterparty, address or PII.
        detail: { count: rows.length, transactionIds: rows.slice(0, 20).map((r) => r.id) },
      });
      return;
    }
    checks.push({ id: spec.id, severity: "ok", summary: spec.good });
  } catch (e) {
    checks.push({
      id: spec.id,
      severity: "critical",
      summary: `${spec.id} check failed: ${(e as Error).message}`,
    });
  }
}

/**
 * Run every reconciliation check.
 *
 * Never throws: a reconciliation run that fails with an exception tells an
 * operator nothing, and worse, a monitor that errors is usually muted. A failed
 * check is reported AS a check, at critical, with the error attached.
 */
export async function runReconciliation(): Promise<ReconciliationReport> {
  const checkedAt = new Date().toISOString();
  const durable = paymentsDurable();
  const checks: ReconciliationCheck[] = [];

  if (!durable) {
    // Say this plainly rather than returning three green checks against a
    // database that is not there.
    checks.push({
      id: "durability",
      severity: "warn",
      summary:
        "No durable backend configured — payments and the ledger are per-instance, " +
        "so the checks below cannot be meaningfully evaluated.",
    });
    return { checkedAt, durable, status: worst(checks), checks };
  }

  checks.push({ id: "durability", severity: "ok", summary: "Durable backend configured." });

  // 1. Global debit/credit balance.
  try {
    const imbalance = await ledgerImbalance();
    if (!imbalance) {
      checks.push({
        id: "ledger_balance",
        severity: "warn",
        summary: "Ledger imbalance view unavailable — migration 0009 may not be applied.",
      });
    } else if (Number(imbalance.imbalance) !== 0) {
      checks.push({
        id: "ledger_balance",
        severity: "critical",
        summary: `Ledger does not balance: debits and credits differ by ${imbalance.imbalance} minor units.`,
        detail: {
          totalDebits: Number(imbalance.total_debits),
          totalCredits: Number(imbalance.total_credits),
          imbalance: Number(imbalance.imbalance),
        },
      });
    } else {
      checks.push({
        id: "ledger_balance",
        severity: "ok",
        summary: `Ledger balances: ${imbalance.total_debits} minor units on each side.`,
        detail: { totalDebits: Number(imbalance.total_debits) },
      });
    }
  } catch (e) {
    checks.push({
      id: "ledger_balance",
      severity: "critical",
      summary: `Ledger balance check failed: ${(e as Error).message}`,
    });
  }

  // 2. Settled payments with no ledger entry.
  try {
    const orphans = await paymentsMissingLedger(100);
    if (!orphans) {
      checks.push({
        id: "settled_without_ledger",
        severity: "warn",
        summary: "Orphan-payment view unavailable — migration 0009 may not be applied.",
      });
    } else if (orphans.length > 0) {
      checks.push({
        id: "settled_without_ledger",
        severity: "critical",
        summary: `${orphans.length} settled payment(s) have no ledger transaction — money moved without being recorded.`,
        // Ids and amounts only. This report reaches an ops console, so it
        // carries no counterparty addresses or PII.
        detail: {
          count: orphans.length,
          paymentIds: orphans.slice(0, 20).map((p) => p.id),
        },
      });
    } else {
      checks.push({
        id: "settled_without_ledger",
        severity: "ok",
        summary: "Every settled payment has a ledger transaction.",
      });
    }
  } catch (e) {
    checks.push({
      id: "settled_without_ledger",
      severity: "critical",
      summary: `Orphan-payment check failed: ${(e as Error).message}`,
    });
  }

  // 3-6. The transaction envelope (migration 0014).
  //
  // Each of these is a distinct failure that the two ledger checks above cannot
  // see, because they only compare the books against themselves. A transaction
  // can be internally consistent and still be wrong about the outside world.
  await runFtxCheck(checks, {
    id: "ftx_settled_without_ledger",
    severity: "critical",
    read: () => ftxSettledWithoutLedger(100),
    bad: (n) =>
      `${n} transaction(s) are SETTLED or COMPLETED with no ledger entry — value moved and was never recorded.`,
    good: "Every settled transaction has a ledger entry.",
  });

  await runFtxCheck(checks, {
    id: "ftx_completed_without_evidence",
    severity: "critical",
    read: () => ftxCompletedWithoutEvidence(100),
    bad: (n) =>
      `${n} transaction(s) are COMPLETED carrying no provider, bank or chain reference. ` +
      "lifecycle.ts refuses that transition, so something wrote the state directly.",
    good: "Every completed transaction carries evidence.",
  });

  await runFtxCheck(checks, {
    id: "ftx_stale_in_flight",
    // Warn, not critical: a stale transaction is a customer waiting, which is
    // urgent but is not the same as money being unaccounted for.
    severity: "warn",
    read: () => ftxStaleInFlight(100),
    bad: (n) => `${n} transaction(s) are past their deadline and still in flight.`,
    good: "No transaction is overdue.",
  });

  await runFtxCheck(checks, {
    id: "ftx_awaiting_review",
    severity: "warn",
    read: () => ftxAwaitingReview(200),
    bad: (n) => `${n} transaction(s) are held for compliance or manual review.`,
    good: "No transaction is awaiting review.",
  });

  const report: ReconciliationReport = { checkedAt, durable, status: worst(checks), checks };

  // Log at a level matching severity so this is alertable without a dashboard.
  if (report.status === "critical") {
    log.error("reconciliation FAILED", {
      status: report.status,
      failing: report.checks.filter((c) => c.severity === "critical").map((c) => c.id),
    });
  } else if (report.status === "warn") {
    log.warn("reconciliation incomplete", {
      warnings: report.checks.filter((c) => c.severity === "warn").map((c) => c.id),
    });
  } else {
    log.info("reconciliation clean", { checks: report.checks.length });
  }

  return report;
}
