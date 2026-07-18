import { sbInsert, supabaseBackend } from "@/lib/supabase";
import { log } from "@/lib/log";

// ---------------------------------------------------------------------------
// Durable sink for the audit trail.
//
// WHY THIS EXISTS: audit() recorded events to an in-memory ring buffer and a
// log line, and `audit_log` — the table migration 0002 created specifically so
// the trail would OUTLIVE account deletion — was never written to. Production
// held 0 rows against 35 call sites. The compliance evidence store existed on
// paper only.
//
// Design constraints, in priority order:
//   1. NEVER break the action being audited. A failed audit write must not
//      turn a successful payment into a 500.
//   2. Never lose an event silently. Failures are counted and logged loudly;
//      auditFlushStats() exposes them for a health endpoint.
//   3. Never block the response by default — but let callers that need
//      durability await it (flushAudit), the same way the order route awaits
//      persistAccount.
//
// Next 14 has no `after()` (that is 15.1+) and @vercel/functions is not a
// dependency here, so there is no supported way to run work AFTER the response
// on this runtime. A bare fire-and-forget promise can be killed when the
// lambda freezes. Hence: writes are enqueued immediately and callers on
// money/security paths await flushAudit() before returning.
// ---------------------------------------------------------------------------

/** Row shape for public.audit_log. `id` is GENERATED ALWAYS AS IDENTITY and
 *  must NOT be supplied; Postgres rejects the insert if it is. */
interface AuditRow {
  user_id: string | null;
  action: string;
  details: Record<string, unknown>;
  ip_address: string | null;
  created_at: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// A backlog is better than unbounded memory growth during a Postgres outage.
// Oldest entries are dropped first and the loss is counted, so the gap is
// visible rather than silent.
const MAX_QUEUE = 1_000;
const MAX_ATTEMPTS = 3;

const g = globalThis as unknown as {
  __furlpayAuditQueue?: AuditRow[];
  __furlpayAuditChain?: Promise<void>;
  __furlpayAuditStats?: { written: number; failed: number; dropped: number };
};

const queue = (): AuditRow[] => (g.__furlpayAuditQueue ??= []);
const stats = () => (g.__furlpayAuditStats ??= { written: 0, failed: 0, dropped: 0 });

/** Counters for a health endpoint. A non-zero `failed` or `dropped` means the
 *  compliance trail has holes and someone must look. */
export function auditFlushStats(): { written: number; failed: number; dropped: number; pending: number } {
  return { ...stats(), pending: queue().length };
}

/**
 * Queue one entry for durable write.
 *
 * `actor` is NOT always a user id — call sites pass "system", a session id, or
 * an email. user_id is a uuid column, so a non-uuid actor would fail the whole
 * insert. Those are written as NULL and preserved in details.actor instead, so
 * the identity survives without breaking the row.
 */
export function enqueueAudit(params: {
  event: string;
  actor: string;
  fields?: Record<string, unknown>;
  ip?: string | null;
  ts?: string;
}): void {
  if (supabaseBackend !== "supabase") return; // no DB configured (local/dev)

  const isUuid = UUID.test(params.actor ?? "");
  const details: Record<string, unknown> = { ...(params.fields ?? {}) };
  if (!isUuid && params.actor) details.actor = params.actor;

  const q = queue();
  q.push({
    user_id: isUuid ? params.actor : null,
    action: params.event,
    details,
    // inet rejects a malformed address and would fail the batch; only pass
    // through something that at least looks like an address.
    ip_address: params.ip && /^[0-9a-fA-F.:]+$/.test(params.ip) ? params.ip : null,
    // Record when the event HAPPENED, not when the flush ran — otherwise a
    // delayed flush reorders the trail.
    created_at: params.ts ?? new Date().toISOString(),
  });

  while (q.length > MAX_QUEUE) {
    q.shift();
    stats().dropped += 1;
    log.error("audit queue overflow — oldest entry dropped", auditFlushStats());
  }

  void flushAudit();
}

/**
 * Drain the queue. Serialized through one chain so concurrent callers never
 * interleave inserts or double-write the same batch.
 *
 * Resolves rather than rejects: an audit failure must never propagate into the
 * business action. Awaiting this only guarantees the attempt completed.
 */
export function flushAudit(): Promise<void> {
  const prev = g.__furlpayAuditChain ?? Promise.resolve();
  const next = prev.then(drain);
  g.__furlpayAuditChain = next;
  return next;
}

async function drain(): Promise<void> {
  const q = queue();
  if (!q.length) return;

  const batch = q.splice(0, q.length);
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await sbInsert<AuditRow>("audit_log", batch);
      stats().written += batch.length;
      return;
    } catch (e) {
      const message = (e as Error).message ?? "";
      // A malformed row (bad uuid/inet/jsonb) will fail identically forever —
      // retrying only delays the loss. Report it and move on rather than
      // blocking every later entry behind a poison batch.
      const permanent = /22P02|23502|23514|invalid input syntax/i.test(message);
      if (permanent || attempt === MAX_ATTEMPTS) {
        stats().failed += batch.length;
        log.error("audit_log write FAILED — compliance trail has a gap", {
          entries: batch.length,
          attempt,
          permanent,
          error: message.slice(0, 300),
          ...auditFlushStats(),
        });
        return;
      }
      await new Promise((r) => setTimeout(r, 100 * attempt));
    }
  }
}
