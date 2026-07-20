import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { z } from "zod";
import crypto from "crypto";
import { validateBody } from "@/lib/validate";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { requireUser } from "@/lib/authz";
import {
  loadCorporateActions,
  loadSettledDividendIds,
  newTx,
  persistAccount,
  recordTransaction,
  saveDividendEvents,
} from "@/lib/store";
import { recordMovement } from "@/lib/ledger";
import { quoteFor } from "@/lib/markets/quotes";
import { settleDividends } from "@/lib/corporateActions/dividends";
import { log } from "@/lib/log";

// POST /api/investing/dividends/settle — pay out the caller's unsettled cash
// dividends, or reinvest them (DRIP).
//
// Dividends were computed but never PAID: projectDividends() is a pure
// projection recomputed on every portfolio read, which is right for display and
// impossible for money — a function that runs on every GET would pay a holder
// once per page view. This route is the settlement step, and the whole design
// is about making it safe to run twice.
//
// Rate limit is tight (money-moving, per AGENTS.md rule 2). Self-scoped: a user
// can only settle their own dividends, so no admin role is required.

const Body = z
  .object({
    /** Reinvest into new lots instead of crediting cash. */
    drip: z.boolean().optional(),
  })
  .strip();

export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "investing.dividends.settle", {
    limit: 10,
    windowMs: 600_000,
  });
  if (limited) return limited;

  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const account = auth.account;
  const userId = account.user.id;

  const body = await validateBody(req, Body);
  if (body instanceof NextResponse) return body;

  // The ledger must be READABLE before anything settles. An account hydrated
  // without its lots (migration not applied, table unreachable) reports zero
  // shares held, which would silently settle nothing and mark the run
  // successful — indistinguishable from "no dividends due".
  if (account.lotsReadable === false) {
    return NextResponse.json(
      { error: "ledger_unavailable", detail: "Lot ledger could not be read; refusing to settle." },
      { status: 503 },
    );
  }

  const symbols = [...new Set(account.tradeLots.map((l) => l.symbol))];
  if (!symbols.length) {
    return NextResponse.json({ settled: 0, cashCredited: 0, reinvested: 0, events: [] });
  }

  // What has ALREADY been paid. This read throws rather than degrading to an
  // empty set (see loadSettledDividendIds) — an empty set after a failed read
  // means "nothing paid yet" and would re-pay every dividend in history.
  let alreadySettled: Set<string>;
  try {
    alreadySettled = await loadSettledDividendIds(userId);
  } catch (e) {
    log.error("dividend settlement aborted — settled-set unreadable", {
      userId,
      error: (e as Error).message,
    });
    return NextResponse.json(
      { error: "settlement_state_unavailable", detail: "Cannot confirm prior payouts." },
      { status: 503 },
    );
  }

  const actions = await loadCorporateActions(symbols);

  // DRIP needs a live price per symbol; a symbol without one settles as cash
  // rather than inventing a share count.
  let dripPrice: ((symbol: string) => number | undefined) | undefined;
  if (body.drip) {
    const quotes = new Map<string, number>();
    await Promise.all(
      symbols.map(async (s) => {
        const q = await quoteFor(s).catch(() => undefined);
        if (q?.price && q.price > 0) quotes.set(s, q.price);
      }),
    );
    dripPrice = (s: string) => quotes.get(s);
  }

  const result = settleDividends(userId, account.tradeLots, actions, alreadySettled, {
    residency: account.user.taxResidency,
    drip: body.drip,
    dripPrice,
    newEventId: (a) => `div_${crypto.randomBytes(6).toString("hex")}_${a.id}`,
    newLotId: (a) => `lot_drip_${crypto.randomBytes(6).toString("hex")}_${a.id}`,
  });

  if (!result.events.length) {
    return NextResponse.json({
      settled: 0,
      cashCredited: 0,
      reinvested: 0,
      skipped: result.skipped.length,
      events: [],
    });
  }

  // ---- Write order is the whole ballgame -----------------------------------
  //
  // The settlement RECORD is written first, before any cash moves. If this
  // write fails, nothing was paid and the next run retries cleanly. If it
  // succeeds and the credit below somehow fails, the user is under-paid by a
  // known, queryable amount — recoverable.
  //
  // The reverse order is not recoverable: cash credited without a record would
  // be paid again on every subsequent run, with nothing in the database to say
  // it had already happened. Under-paying is fixable; double-paying is a
  // clawback.
  //
  // The UNIQUE (user_id, corporate_action_id) constraint from 0006 is what
  // makes this safe under concurrency: two simultaneous runs both reading an
  // empty settled-set will both attempt the insert, and the database rejects
  // the loser instead of paying twice.
  try {
    await saveDividendEvents(result.events);
  } catch (e) {
    log.error("dividend settlement write failed — no cash moved", {
      userId,
      error: (e as Error).message,
    });
    return NextResponse.json(
      { error: "settlement_write_failed", detail: "No dividends were paid; retry is safe." },
      { status: 503 },
    );
  }

  // Only now does money move.
  if (result.dripLots.length) {
    account.tradeLots.push(...result.dripLots);
  }

  if (result.cashToCredit > 0) {
    recordMovement("in", result.cashToCredit, "Dividend payout", userId);
    recordTransaction(
      userId,
      newTx({
        category: "invest",
        direction: "in",
        title: "Dividend payout",
        subtitle: `${result.events.filter((e) => !e.reinvested).length} dividend(s)`,
        amountUsd: result.cashToCredit,
        status: "settled",
      }),
    );
  }

  // Durability confirmed before the response claims payment, for the same
  // reason the order route awaits it: the lots and balance behind a "settled"
  // response are the tax record.
  await persistAccount(userId);

  return NextResponse.json({
    settled: result.events.length,
    cashCredited: result.cashToCredit,
    reinvested: result.dripLots.length,
    withheld: result.totalWithheld,
    skipped: result.skipped.length,
    events: result.events.map((e) => ({
      symbol: e.symbol,
      corporateActionId: e.corporateActionId,
      sharesHeld: e.sharesHeld,
      grossAmount: e.grossAmount,
      withholdingTax: e.withholdingTax,
      netAmount: e.netAmount,
      reinvested: e.reinvested,
      status: e.status,
    })),
  });
}
