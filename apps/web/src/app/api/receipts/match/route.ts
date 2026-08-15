import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { db } from "@/lib/store";
import type { Transaction } from "@/lib/types";

export const dynamic = "force-dynamic";

// Auto receipt matching — connect an email inbox (Gmail-style ingest) and match
// booking/purchase confirmations to the card transactions that paid for them.
// FurlPay angle: travel confirmations (hotel + flight) auto-reconcile to the
// virtual-card charge, so the ledger carries proof-of-purchase.
//
// POST body: { receipts: Receipt[] } — a batch of parsed emails. Each is matched
// to the closest outgoing transaction within an amount tolerance and a date
// window. GET returns the current reconciliation coverage.

interface Receipt {
  merchant: string;
  amountUsd: number;
  date: string; // ISO
  reference?: string;
}

const AMOUNT_TOLERANCE = 0.02; // 2% — covers FX rounding / tips
const DATE_WINDOW_MS = 3 * 86_400_000; // ±3 days

function outgoing(): Transaction[] {
  return db.transactions.filter((t) => t.direction === "out" && t.status !== "declined");
}

function scoreMatch(r: Receipt, t: Transaction): number | null {
  const amtDiff = Math.abs(t.amountUsd - r.amountUsd);
  if (amtDiff > Math.max(0.5, r.amountUsd * AMOUNT_TOLERANCE)) return null;
  const dt = Math.abs(new Date(t.timestamp).getTime() - new Date(r.date).getTime());
  if (dt > DATE_WINDOW_MS) return null;

  // Prefer merchant-name overlap, then amount closeness, then date closeness.
  const hay = `${t.title} ${t.subtitle}`.toLowerCase();
  const tokens = r.merchant.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const nameHits = tokens.filter((w) => hay.includes(w)).length;
  return nameHits * 100 + (1 - amtDiff / (r.amountUsd || 1)) * 10 + (1 - dt / DATE_WINDOW_MS);
}

// Module-level record of which tx ids are reconciled (demo persistence).
const g = globalThis as unknown as { __receipts?: Record<string, Receipt> };
const matched = g.__receipts ?? (g.__receipts = {});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const receipts: Receipt[] = Array.isArray(body?.receipts) ? body.receipts : [];
  if (receipts.length === 0) {
    return NextResponse.json({ error: "no_receipts" }, { status: 400 });
  }

  const txns = outgoing();
  const usedTx = new Set<string>();
  const results = receipts.map((r) => {
    let best: { tx: Transaction; score: number } | null = null;
    for (const t of txns) {
      if (usedTx.has(t.id)) continue;
      const score = scoreMatch(r, t);
      if (score !== null && (!best || score > best.score)) best = { tx: t, score };
    }
    if (best) {
      usedTx.add(best.tx.id);
      matched[best.tx.id] = r;
      return {
        matched: true,
        receipt: r,
        transactionId: best.tx.id,
        transactionTitle: best.tx.title,
        confidence: best.score >= 100 ? "high" : "medium",
      };
    }
    return { matched: false, receipt: r };
  });

  const hits = results.filter((r) => r.matched).length;
  return NextResponse.json({
    processed: receipts.length,
    matched: hits,
    unmatched: receipts.length - hits,
    results,
  });
}

export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "receipts.match", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const txns = outgoing();
  const reconciled = txns.filter((t) => matched[t.id]);
  return NextResponse.json({
    totalOutgoing: txns.length,
    reconciled: reconciled.length,
    coverage: txns.length ? Math.round((reconciled.length / txns.length) * 100) : 0,
    matches: reconciled.map((t) => ({
      transactionId: t.id,
      title: t.title,
      amountUsd: t.amountUsd,
      receipt: matched[t.id],
    })),
  });
}
