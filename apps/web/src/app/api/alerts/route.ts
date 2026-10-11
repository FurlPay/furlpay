import { NextRequest, NextResponse } from "next/server";
import { readJsonBody } from "@/lib/validate";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { parse } from "@/lib/schemas";
import { AlertError, createAlert, deleteAlert, listAlerts } from "@/lib/alerts/userAlerts";
import { quoteFor } from "@/lib/markets/quotes";

// Reads live alert state — never statically cached.
export const dynamic = "force-dynamic";

// /api/alerts — a user's price alerts.
//
// GET    list the caller's alerts
// POST   create one
// DELETE remove one (?id=alr_...)
//
// THE CURRENT PRICE IS READ SERVER-SIDE, NOT TAKEN FROM THE BODY, and that is the
// security decision in this file rather than a convenience.
//
// createAlert refuses a condition the market already satisfies, because an
// already-satisfied alert fires instantly and notifies the user about a move that
// happened before they asked. That check is only as trustworthy as the price it
// compares against — so if `currentPrice` came from the request, a client could
// send any number and arm an alert that fires on the very next tick. The check
// would still run, pass, and mean nothing.
//
// So the price is fetched here. A client cannot influence the arming decision.

const CreateAlertSchema = z.object({
  symbol: z.string().min(1).max(20),
  direction: z.enum(["above", "below"]),
  targetPrice: z.number().positive().max(100_000_000),
  frequency: z.enum(["once", "recurring"]).optional(),
  note: z.string().max(200).optional(),
});

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const limited = await rateLimitOr429(req, "alerts.list", { limit: 60, windowMs: 60_000 }, auth.account.user.id);
  if (limited) return limited;

  return NextResponse.json(
    { alerts: await listAlerts(auth.account.user.id) },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  // Tighter than the middleware baseline: each create does a quote lookup and
  // several KV writes, and the per-user quota bounds the total but not the rate.
  const limited = await rateLimitOr429(req, "alerts.create", { limit: 20, windowMs: 60_000 }, auth.account.user.id);
  if (limited) return limited;

  const parsed = parse(CreateAlertSchema, await readJsonBody(req).catch(() => ({})));
  if (!parsed.ok) return parsed.res;
  const { symbol, direction, targetPrice, frequency, note } = parsed.data;

  // Server-side price — see the header note on why this cannot come from the body.
  const quote = await quoteFor(symbol);
  if (!quote) {
    return NextResponse.json(
      {
        error: "unknown_symbol",
        detail: `No price is available for "${symbol}", so an alert on it cannot be armed.`,
      },
      { status: 404 }
    );
  }

  try {
    const alert = await createAlert({
      userId: auth.account.user.id,
      symbol,
      direction,
      targetPrice,
      frequency,
      note,
      currentPrice: quote.price,
    });
    return NextResponse.json({ alert, currentPrice: quote.price }, { status: 201 });
  } catch (e) {
    if (e instanceof AlertError) {
      // 409, not 400: the request is well-formed, it conflicts with the current
      // state of the market (or the user's quota). The message names the current
      // price so the client can suggest a workable target.
      return NextResponse.json(
        { error: "alert_rejected", detail: e.message, currentPrice: quote.price },
        { status: 409 }
      );
    }
    throw e;
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const limited = await rateLimitOr429(req, "alerts.delete", { limit: 60, windowMs: 60_000 }, auth.account.user.id);
  if (limited) return limited;

  const id = req.nextUrl.searchParams.get("id")?.trim();
  if (!id) return NextResponse.json({ error: "id query parameter is required" }, { status: 400 });

  // deleteAlert checks ownership and reports a foreign id as not-found, so this
  // route cannot be used to probe whether someone else's alert id exists.
  const deleted = await deleteAlert(auth.account.user.id, id);
  if (!deleted) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
