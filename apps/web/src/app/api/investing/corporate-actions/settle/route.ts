import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import crypto from "crypto";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { withLock } from "@/lib/locks";
import { requireUser } from "@/lib/authz";
import {
  loadCorporateActions,
  loadSettledReorgIds,
  newTx,
  persistAccount,
  recordTransaction,
  saveReorgEvents,
} from "@/lib/store";
import { recordMovement } from "@/lib/ledger";
import { settleReorgs } from "@/lib/corporateActions/reorgSettlement";
import { log } from "@/lib/log";

// POST /api/investing/corporate-actions/settle — apply the caller's pending
// cash-bearing reorganizations (cash-out mergers, liquidating delistings,
// cash-in-lieu fractions) to their ledger and pay out the cash.
//
// The projection deliberately leaves these UNAPPLIED (see paysCash() in
// projector.ts) because a pure read model cannot credit cash. This is where
// they actually happen. Money-moving, so the rate limit is tight and the write
// order is the same as dividend settlement: RECORD first, then mutate.
//
// No body: it settles everything currently due for the authenticated user.

export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "investing.ca.settle", {
    limit: 10,
    windowMs: 600_000,
  });
  if (limited) return limited;

  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const account = auth.account;
  const userId = account.user.id;

  // Serialise settlement per user. The database UNIQUE constraint
  // (reorg_once_per_user) is what GUARANTEES a corporate action is never
  // settled twice and remains the guarantee — this lock does not replace it
  // (a Redis lock has a TTL and fails open; a constraint does not).
  //
  // What the lock adds is what the constraint cannot cover: this handler
  // mutates an account that is flushed WHOLE (storeDb.saveAccount). Two
  // concurrent runs on different instances each hydrate their own copy and
  // the second flush overwrites the first, so the constraint correctly
  // rejects the duplicate record while the surviving snapshot loses the lot
  // changes that went with it.
  return withLock(
    `settle:reorgs:${userId}`,
    30,
    async () => {

    // The ledger must be readable before anything settles — settling against a
    // ledger that failed to load would supersede lots that aren't really there.
    if (account.lotsReadable === false) {
      return NextResponse.json(
        { error: "ledger_unavailable", detail: "Lot ledger could not be read; refusing to settle." },
        { status: 503 },
      );
    }

    const symbols = [...new Set(account.tradeLots.map((l) => l.symbol))];
    if (!symbols.length) {
      return NextResponse.json({ settled: 0, cashCredited: 0, events: [] });
    }

    // Already-settled set. Throws rather than degrading to empty — an empty set
    // after a failed read re-runs every reorg the user has ever had.
    let alreadySettled: Set<string>;
    try {
      alreadySettled = await loadSettledReorgIds(userId);
    } catch (e) {
      log.error("reorg settlement aborted — settled-set unreadable", {
        userId,
        error: (e as Error).message,
      });
      return NextResponse.json(
        { error: "settlement_state_unavailable", detail: "Cannot confirm prior settlements." },
        { status: 503 },
      );
    }

    const actions = await loadCorporateActions(symbols);

    const result = settleReorgs(userId, account.tradeLots, actions, alreadySettled, {
      newEventId: (a) => `reorg_${crypto.randomBytes(6).toString("hex")}_${a.id}`,
    });

    if (!result.events.length) {
      return NextResponse.json({
        settled: 0,
        cashCredited: 0,
        skipped: result.skipped.length,
        events: [],
      });
    }

    // ---- Record BEFORE mutating -----------------------------------------------
    //
    // Same discipline as dividend settlement, and it matters more here because a
    // reorg both moves cash AND rewrites the ledger. If the record write fails,
    // NOTHING has changed — the in-memory result is discarded and the next run
    // retries cleanly. Swapping the ledger first and failing to record would
    // leave lots superseded with no settlement row to explain it, and the next
    // run would re-settle against a ledger that no longer holds the original
    // position — unrecoverable without manual repair.
    try {
      await saveReorgEvents(result.events);
    } catch (e) {
      log.error("reorg settlement write failed — ledger untouched", {
        userId,
        error: (e as Error).message,
      });
      return NextResponse.json(
        { error: "settlement_write_failed", detail: "Nothing was settled; retry is safe." },
        { status: 503 },
      );
    }

    // Only now does the ledger change and cash move. The result carries the fully
    // transformed lot set — swap it in wholesale (it already contains the
    // superseded/closed originals for the audit trail).
    account.tradeLots.splice(0, account.tradeLots.length, ...result.lots);

    if (result.cashToCredit > 0) {
      await recordMovement("in", result.cashToCredit, "Corporate action payout", userId);
      recordTransaction(
        userId,
        newTx({
          category: "invest",
          direction: "in",
          title: "Corporate action payout",
          subtitle: `${result.events.length} settlement(s)`,
          amountUsd: result.cashToCredit,
          status: "settled",
        }),
      );
    }

    // Durability confirmed before the response claims settlement, as elsewhere:
    // the transformed lots are the tax record.
    await persistAccount(userId);

    return NextResponse.json({
      settled: result.events.length,
      cashCredited: result.cashToCredit,
      realizedGain: result.realizedGain,
      skipped: result.skipped.length,
      events: result.events.map((e) => ({
        symbol: e.symbol,
        type: e.type,
        corporateActionId: e.corporateActionId,
        cashProceeds: e.cashProceeds,
        realizedGain: e.realizedGain,
      })),
    });
    },
    () =>
      NextResponse.json(
        { error: "settlement_in_flight", detail: "A settlement run is already in progress." },
        { status: 409 },
      ),
  );

}
