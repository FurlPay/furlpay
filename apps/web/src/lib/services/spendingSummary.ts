// ---------------------------------------------------------------------------
// Auto Commentary for spending — generates a client-ready weekly narrative
// over the user's real transactions (the Aladdin "Auto Commentary" pattern:
// the numbers come from deterministic aggregation, the prose is templated
// over those grounded facts, so the narrative can never misstate an amount).
//
// Windows are rolling 7-day periods (this week vs the prior week) so the
// summary is meaningful on any day, not just Mondays.
// ---------------------------------------------------------------------------

import type { Transaction } from "@/lib/types";

export interface CategoryBreakdown {
  category: string;
  amountUsd: number;
  percentage: number; // share of the week's outflow, 0-100
  count: number;
}

export interface SpendingSummary {
  periodStart: string; // ISO
  periodEnd: string; // ISO
  totalSpentUsd: number;
  totalReceivedUsd: number;
  transactionCount: number;
  topCategories: CategoryBreakdown[];
  largestExpense: { title: string; amountUsd: number; category: string } | null;
  weekOverWeekPct: number | null; // null when last week had no spend
  narrative: string;
  insight: string;
}

const round = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function within(t: Transaction, from: Date, to: Date): boolean {
  const ts = new Date(t.timestamp).getTime();
  return ts >= from.getTime() && ts < to.getTime();
}

function outflow(txs: Transaction[]): Transaction[] {
  return txs.filter((t) => t.direction === "out" && t.status !== "declined");
}

/** One deterministic, actionable observation about the week. */
function pickInsight(
  top: CategoryBreakdown[],
  weekOverWeekPct: number | null,
  totalSpent: number
): string {
  if (totalSpent === 0) return "No spending this week — your balances stayed put.";
  const lead = top[0];
  if (lead && lead.percentage >= 50) {
    return `${capitalize(lead.category)} dominated the week at ${lead.percentage}% of outflow — worth a look if that's unusual for you.`;
  }
  if (weekOverWeekPct !== null && weekOverWeekPct >= 30) {
    return `Spending is up ${weekOverWeekPct}% on last week — the increase is concentrated in ${lead?.category ?? "your top category"}.`;
  }
  if (weekOverWeekPct !== null && weekOverWeekPct <= -30) {
    return `Spending dropped ${Math.abs(weekOverWeekPct)}% from last week — idle USDC could be earning yield in FurlPay Earn.`;
  }
  return "Spending is in line with your recent pattern.";
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Build the rolling 7-day spending summary ending now. */
//
// The caller's transactions are REQUIRED. This used to accept a Date or nothing
// and fall back to the seeded demo account's history — someone else's spending
// for any caller that forgot to pass the account's.
export function buildSpendingSummary(allTxs: readonly Transaction[], now = new Date()): SpendingSummary {

  const weekMs = 7 * 86_400_000;
  const start = new Date(now.getTime() - weekMs);
  const prevStart = new Date(now.getTime() - 2 * weekMs);

  const thisWeek = allTxs.filter((t) => within(t, start, now));
  const spent = outflow(thisWeek);
  const lastWeekSpent = outflow(allTxs.filter((t) => within(t, prevStart, start)));

  const totalSpent = round(spent.reduce((s, t) => s + t.amountUsd, 0));
  const totalReceived = round(
    thisWeek
      .filter((t) => t.direction === "in" && t.status !== "declined")
      .reduce((s, t) => s + t.amountUsd, 0)

  );
  const lastWeekTotal = round(lastWeekSpent.reduce((s, t) => s + t.amountUsd, 0));

  const byCategory = new Map<string, { amountUsd: number; count: number }>();
  for (const t of spent) {
    const entry = byCategory.get(t.category) ?? { amountUsd: 0, count: 0 };
    entry.amountUsd += t.amountUsd;
    entry.count++;
    byCategory.set(t.category, entry);
  }
  const topCategories: CategoryBreakdown[] = [...byCategory.entries()]
    .map(([category, v]) => ({
      category,
      amountUsd: round(v.amountUsd),
      percentage: totalSpent > 0 ? Math.round((v.amountUsd / totalSpent) * 100) : 0,
      count: v.count,
    }))
    .sort((a, b) => b.amountUsd - a.amountUsd);

  const largest = spent.reduce<Transaction | null>(
    (max, t) => (max === null || t.amountUsd > max.amountUsd ? t : max),
    null
  );

  const weekOverWeekPct =
    lastWeekTotal > 0 ? Math.round(((totalSpent - lastWeekTotal) / lastWeekTotal) * 100) : null;

  const insight = pickInsight(topCategories, weekOverWeekPct, totalSpent);

  const trend =
    weekOverWeekPct === null
      ? ""
      : ` Spending ${weekOverWeekPct >= 0 ? "increased" : "decreased"} ${Math.abs(weekOverWeekPct)}% versus the week before.`;
  const lead = topCategories[0];
  const narrative =
    totalSpent === 0
      ? `No outgoing payments in the last 7 days. You received $${money(totalReceived)}.`
      : `This week you spent $${money(totalSpent)} across ${topCategories.length} ${
          topCategories.length === 1 ? "category" : "categories"
        } (${spent.length} payments). Your largest bucket was ${lead.category} at $${money(lead.amountUsd)} (${lead.percentage}% of outflow).${trend} ${insight}`;

  return {
    periodStart: start.toISOString(),
    periodEnd: now.toISOString(),
    totalSpentUsd: totalSpent,
    totalReceivedUsd: totalReceived,
    transactionCount: thisWeek.length,
    topCategories,
    largestExpense: largest
      ? { title: largest.title, amountUsd: round(largest.amountUsd), category: largest.category }
      : null,
    weekOverWeekPct,
    narrative,
    insight,
  };
}
