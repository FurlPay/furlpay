import { NextRequest, NextResponse } from "next/server";
import { optionalUser } from "@/lib/authz";
import { log } from "@/lib/log";
import { tokenFromRequest } from "@/lib/session";
import { ingestClientEvents, IngestStorageError } from "./ingest";

// Shared tail of the two ingestion routes. The ROUTE does the rate limit and
// the body validation (the route-security scanner checks for both in-file).
//
// KILL SWITCH: FURLPAY_ANALYTICS_INGEST=off answers 503 "disabled"; clients
// treat any non-2xx as "keep or drop per queue policy" and never block on it.
export async function ingestResponse(req: NextRequest, events: unknown[]): Promise<NextResponse> {
  if (process.env.FURLPAY_ANALYTICS_INGEST === "off") {
    return NextResponse.json({ error: "analytics_disabled" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
  const who = await optionalUser(req);
  // A credential that was offered but is revoked/expired/locked is refused,
  // never quietly downgraded to anonymous.
  if (who.kind === "rejected") return who.res;
  const userId = who.kind === "user" ? who.account.user.id : null;
  try {
    const r = await ingestClientEvents(events, { userId });
    return NextResponse.json(r, { status: 202, headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof IngestStorageError) {
      log.warn("analytics ingest storage failed", { error: e.message });
      return NextResponse.json({ error: "analytics_unavailable" }, { status: 503, headers: { "cache-control": "no-store", "retry-after": "60" } });
    }
    throw e;
  }
}

/**
 * Which rate budget applies. Exactly the test optionalUser uses
 * (tokenFromRequest): anything else, e.g. `Authorization: Basic …` or an
 * empty cookie, is anonymous and must not buy the wider signed-in budget.
 * A token that is offered but invalid gets the wider budget and then a 401.
 */
export function hasCredential(req: NextRequest): boolean {
  return Boolean(tokenFromRequest(req));
}
