import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
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
//
// SECURITY HISTORY. Both handlers used to run on the seeded demo account's
// transactions for every caller, with no requireUser, no body validation, and
// ONE process-global map of matches — so any signed-in user's GET listed every
// other user's matched receipts (merchant, amount, date, reference). The route
// now requires a session, validates the batch, matches only against the
// caller's own transactions, and keeps matches per user.
//
// NOT DURABLE. Matches live in process memory: a restart or a different
// serverless instance loses them. That is recorded as a gap in
// docs/audit/PRODUCTION_GAP_AUDIT.md rather than papered over here.

const Receipt = z
  .object({
    merchant: z.string().trim().min(1).max(200),
    amountUsd: z.number().positive().max(1_000_000),
    date: z.string().datetime({ offset: true }).or(z.string().date()),
    reference: z.string().max(200).optional(),
  })
  .strip();

const Body = z.object({ receipts: z.array(Receipt).min(1).max(100) }).strip();

type Receipt = z.infer<typeof Receipt>;

const AMOUNT_TOLERANCE = 0.02; // 2% — covers FX rounding / tips
const DATE_WINDOW_MS = 3 * 86_400_000; // ±3 days

function outgoing(transactions: readonly Transaction[]): Transaction[] {
  return transactions.filter((t) => t.direction === "out" && t.status !== "declined");
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

// Per-user: userId -> (transactionId -> receipt). Keyed by user so the shape
// itself makes a cross-tenant read unrepresentable.
const g = globalThis as unknown as { __receiptsByUser?: Map<string, Map<string, Receipt>> };
const byUser = g.__receiptsByUser ?? (g.__receiptsByUser = new Map());

function matchesFor(userId: string): Map<string, Receipt> {
  let m = byUser.get(userId);
  if (!m) {
    m = new Map();
    byUser.set(userId, m);
  }
  return m;
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const limited = await rateLimitOr429(req, "receipts.match", { limit: 20, windowMs: 60_000 }, auth.account.user.id);
  if (limited) return limited;

  const body = await validateBody(req, Body);
  if (body instanceof NextResponse) return body;

  const matched = matchesFor(auth.account.user.id);
  const txns = outgoing(auth.account.transactions);
  const usedTx = new Set<string>();
  const results = body.receipts.map((r) => {
    let best: { tx: Transaction; score: number } | null = null;
    for (const t of txns) {
      if (usedTx.has(t.id)) continue;
      const score = scoreMatch(r, t);
      if (score !== null && (!best || score > best.score)) best = { tx: t, score };
    }
    if (best) {
      usedTx.add(best.tx.id);
      matched.set(best.tx.id, r);
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
    processed: body.receipts.length,
    matched: hits,
    unmatched: body.receipts.length - hits,
    results,
  });
}

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const limited = await rateLimitOr429(req, "receipts.match", { limit: 60, windowMs: 60_000 }, auth.account.user.id);
  if (limited) return limited;

  const matched = matchesFor(auth.account.user.id);
  const txns = outgoing(auth.account.transactions);
  const reconciled = txns.filter((t) => matched.has(t.id));
  return NextResponse.json({
    totalOutgoing: txns.length,
    reconciled: reconciled.length,
    coverage: txns.length ? Math.round((reconciled.length / txns.length) * 100) : 0,
    matches: reconciled.map((t) => ({
      transactionId: t.id,
      title: t.title,
      amountUsd: t.amountUsd,
      receipt: matched.get(t.id),
    })),
  });
}
