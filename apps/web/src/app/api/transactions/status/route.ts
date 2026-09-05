import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { requireUser } from "@/lib/authz";
import { readIdempotencyRecord } from "@/lib/idempotency";
import { rateLimitOr429 } from "@/lib/rateLimit";

// ---------------------------------------------------------------------------
// GET /api/transactions/status?idempotencyKey=...&scope=...
//
// RECONCILIATION. Resolves an idempotency key to the authoritative outcome the
// server already recorded.
//
// THE PROBLEM THIS SOLVES. A client submits a transfer, the server accepts it,
// and the reply is lost — a dropped cellular hand-off, a stalled load balancer,
// the app being killed. The client is left holding a key and no outcome. Its
// only safe options are to wait forever or to ask; without this route it could
// only re-submit, which is how one intent becomes two payments.
//
// WHY IT READS THE IDEMPOTENCY STORE. withIdempotency() already pins the exact
// 2xx response body to (scope, principal, key) for 24 hours. That record IS the
// authoritative outcome — the same bytes the client would have received. No
// second source of truth is introduced, and no new write path exists.
//
// SECURITY.
//   * requireUser() — authenticated only.
//   * The principal in the cache key is the AUTHENTICATED user's id, taken from
//     the session, never from the query string. A caller cannot name another
//     user, so a key belonging to someone else simply reads as unknown.
//   * `scope` is validated against an allowlist rather than passed through, so
//     the parameter cannot be used to probe unrelated key namespaces.
//   * Rate limited: this is an unauthenticated-shaped lookup by a
//     caller-supplied key, so it is the natural place to grind for hits.
// ---------------------------------------------------------------------------

/**
 * Scopes a client may reconcile.
 *
 * An allowlist, not a pass-through. `scope` is a namespace selector for the
 * key-value store; accepting arbitrary strings would let a caller aim the
 * lookup at any namespace the app uses, and confirm the existence of keys in
 * it. Every entry here is a money route the mobile client actually submits.
 */
// VERIFIED against the routes: these are exactly the scopes that actually call
// withIdempotency() today (grep `withIdempotency(` under app/api). A scope that
// no route writes could never produce a hit, so listing one would be a
// reconciliation promise the server cannot keep.
//
// NOT LISTED, and deliberately so: /api/swaps, /api/bills and /api/offramp do
// not wrap themselves in withIdempotency, so there is no record to resolve a
// key against. Swap is protected instead by a server-issued single-use quoteId
// (a replay is refused, not double-executed), which is safe but is NOT
// reconcilable — the client cannot learn the outcome of a lost reply. Wrapping
// those three routes is the follow-up that makes them reconcilable too.
const RECONCILABLE_SCOPES = new Set([
  "wallets.transfer",
  "earn.deposit",
  "earn.withdraw",
  "investing.order",
  "investing.schedule",
  "cards.order",
  "cards.reissue",
  "cards.issue",
  "topup.applePay",
  "banking.provision",
]);

/** Mirrors the client's TxState. */
type TxState = "PROCESSING" | "COMPLETED" | "FAILED" | "UNKNOWN";

const KEY_PATTERN = /^[A-Za-z0-9_-]{8,255}$/;

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  // Tighter than the middleware baseline: a lookup keyed by a caller-supplied
  // string is the shape of endpoint people enumerate.
  const limited = await rateLimitOr429(
    req,
    "transactions.status",
    { limit: 60, windowMs: 60_000 },
    auth.account.user.id
  );
  if (limited) return limited;

  const key = req.nextUrl.searchParams.get("idempotencyKey") ?? "";
  const scope = req.nextUrl.searchParams.get("scope") ?? "";

  if (!KEY_PATTERN.test(key)) {
    return NextResponse.json(
      { error: "invalid_idempotency_key", detail: "idempotencyKey must be 8-255 URL-safe characters." },
      { status: 400 }
    );
  }
  if (!RECONCILABLE_SCOPES.has(scope)) {
    return NextResponse.json(
      { error: "invalid_scope", detail: "Unknown reconciliation scope." },
      { status: 400 }
    );
  }

  // The principal comes from the session. This is the line that makes
  // cross-tenant reads impossible.
  const record = await readIdempotencyRecord(key, scope, auth.account.user.id);

  if (!record) {
    // Genuinely unknown — and NOT the same as failed. The request may never
    // have reached the server, or its 24h window may have passed. The client
    // must not read this as "it did not happen".
    return NextResponse.json({ state: "UNKNOWN" satisfies TxState, known: false });
  }

  if (record.status === "processing") {
    return NextResponse.json({ state: "PROCESSING" satisfies TxState, known: true });
  }

  const status = record.response?.status ?? 0;
  const body = record.response?.body ?? null;

  // Only 2xx bodies are ever pinned to a key (see withIdempotency), so a
  // completed record is a success. The original body is returned verbatim so
  // the client can finish the exact flow it started — including reading a
  // transactionHash it never received the first time.
  const state: TxState = status >= 200 && status < 300 ? "COMPLETED" : "FAILED";

  return NextResponse.json({ state, known: true, status, result: body });
}
