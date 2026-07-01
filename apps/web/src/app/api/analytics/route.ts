import { NextResponse } from "next/server";
import { db } from "@/lib/store";

export const dynamic = "force-dynamic";

// GET /api/analytics — spending breakdown by merchant category (MCC-style),
// derived from the transaction ledger. Categorizes outbound card/bill spend.

type Cat = { label: string; emoji?: string; match: RegExp };

// Keyword → merchant category, mirroring RedotPay's MCC categorization.
const CATEGORIES: Cat[] = [
  { label: "Food & Drink", match: /coffee|blue bottle|restaurant|mcdonald|kfc|starbucks|deliveroo|uber eats|grocery/i },
  { label: "Shopping", match: /amazon|apple|store|shop|zara|nike/i },
  { label: "Travel", match: /marriott|hotel|airline|uber|booking|airbnb|flight/i },
  { label: "Subscriptions", match: /netflix|spotify|adobe|vodafone|telecom|canva|duolingo/i },
  { label: "Bills & Utilities", match: /gas|electric|utility|water|chase|credit card/i },
];

function categorize(title: string, subtitle: string): string {
  const hay = `${title} ${subtitle}`;
  for (const c of CATEGORIES) if (c.match.test(hay)) return c.label;
  return "Other";
}

export async function GET() {
  // Outbound spend only (card + bill + ramp out).
  const spend = db.transactions.filter(
    (t) => t.direction === "out" && (t.category === "card" || t.category === "bill")
  );

  const byCategory = new Map<string, { amount: number; count: number }>();
  const byMerchant = new Map<string, number>();

  for (const t of spend) {
    const cat = categorize(t.title, t.subtitle);
    const c = byCategory.get(cat) ?? { amount: 0, count: 0 };
    c.amount += t.amountUsd;
    c.count += 1;
    byCategory.set(cat, c);
    byMerchant.set(t.title, (byMerchant.get(t.title) ?? 0) + t.amountUsd);
  }

  const totalSpent = spend.reduce((s, t) => s + t.amountUsd, 0);

  const categories = Array.from(byCategory.entries())
    .map(([label, v]) => ({
      label,
      amount: Number(v.amount.toFixed(2)),
      count: v.count,
      pct: totalSpent > 0 ? Math.round((v.amount / totalSpent) * 100) : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  const topMerchants = Array.from(byMerchant.entries())
    .map(([name, amount]) => ({ name, amount: Number(amount.toFixed(2)) }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);

  return NextResponse.json({
    period: "Last 30 days",
    totalSpent: Number(totalSpent.toFixed(2)),
    transactionCount: spend.length,
    categories,
    topMerchants,
  });
}
