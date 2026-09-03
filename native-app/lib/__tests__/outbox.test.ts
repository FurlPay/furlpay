import { readFileSync } from "fs";
import { join } from "path";
import { backoffMs, isRetryable } from "../sync";
import { ApiError, NetworkError } from "../api";

// The outbox is what makes FurlPay's money rails survive a bad network and a
// dead process. Both competitor teardowns flag the absence of exactly these
// three properties in their own apps:
//
//   1. crash recovery — a request interrupted mid-flight is re-attempted
//      safely, not silently lost (Tangem recommendation #1)
//   2. spaced retries — failures back off instead of hammering a struggling
//      server on every connectivity flap (recommendation #3)
//   3. visible outcomes — a rejected write is announced with a reference code,
//      not deleted in silence (recommendations #2 and #5)
//
// The pure functions are tested directly; the SQLite-backed flush is pinned at
// source level, the same way sendSafety.test.ts guards the send screen, because
// expo-sqlite has no usable in-process driver under jest-expo.

const root = join(__dirname, "..", "..");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const syncSrc = strip(readFileSync(join(root, "lib", "sync.ts"), "utf8"));
const dbSrc = strip(readFileSync(join(root, "lib", "db.ts"), "utf8"));

describe("backoff", () => {
  it("grows exponentially", () => {
    const ceilingAt = (attempt: number) => backoffMs(attempt, () => 0.999999);
    expect(ceilingAt(1)).toBeLessThan(ceilingAt(2));
    expect(ceilingAt(2)).toBeLessThan(ceilingAt(3));
    expect(ceilingAt(3)).toBeLessThan(ceilingAt(4));
  });

  it("caps, so a long-queued action still retries within ten minutes", () => {
    expect(backoffMs(50, () => 0.999999)).toBeLessThanOrEqual(10 * 60 * 1000);
  });

  it("jitters across the whole window rather than firing on the beat", () => {
    // Every client that queued during one outage must not retry at the same
    // instant. Full jitter means the delay spans [0, ceiling).
    expect(backoffMs(4, () => 0)).toBe(0);
    expect(backoffMs(4, () => 0.5)).toBeGreaterThan(0);
    expect(backoffMs(4, () => 0.5)).toBeLessThan(backoffMs(4, () => 0.99));
  });

  it("never returns a negative or fractional delay", () => {
    for (let attempt = 0; attempt < 12; attempt++) {
      for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
        const ms = backoffMs(attempt, () => r);
        expect(ms).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(ms)).toBe(true);
      }
    }
  });
});

describe("retry classification", () => {
  it("retries transport failures", () => {
    expect(isRetryable(new NetworkError("offline"))).toBe(true);
  });

  it("retries 5xx and 429", () => {
    expect(isRetryable(new ApiError(500, "boom"))).toBe(true);
    expect(isRetryable(new ApiError(503, "unavailable"))).toBe(true);
    expect(isRetryable(new ApiError(429, "slow down"))).toBe(true);
  });

  it("does NOT retry a 4xx — it will fail identically forever", () => {
    expect(isRetryable(new ApiError(400, "bad request"))).toBe(false);
    expect(isRetryable(new ApiError(401, "unauthorized"))).toBe(false);
    expect(isRetryable(new ApiError(409, "conflict"))).toBe(false);
    expect(isRetryable(new ApiError(422, "invalid"))).toBe(false);
  });

  it("does not retry an unrecognised throw", () => {
    expect(isRetryable(new Error("???"))).toBe(false);
    expect(isRetryable("nope")).toBe(false);
  });
});

describe("flush semantics (source-pinned)", () => {
  it("marks a row as sending BEFORE the request leaves", () => {
    // The whole crash-recovery story depends on this ordering: if the mark
    // happened after the await, a process killed mid-POST would leave a row
    // that looks untouched.
    const markIndex = syncSrc.indexOf("markActionSending");
    const awaitIndex = syncSrc.indexOf("await api(");
    expect(markIndex).toBeGreaterThan(-1);
    expect(awaitIndex).toBeGreaterThan(-1);
    expect(markIndex).toBeLessThan(awaitIndex);
  });

  it("recovers interrupted rows before attempting new work", () => {
    // Scoped to the function body — the import block names both symbols and
    // would otherwise decide this ordering test for us.
    const body = syncSrc.slice(syncSrc.indexOf("export async function flushPendingActions"));
    const recoverIndex = body.indexOf("recoverStuckActions");
    const listIndex = body.indexOf("listDueActions");
    expect(recoverIndex).toBeGreaterThan(-1);
    expect(listIndex).toBeGreaterThan(-1);
    expect(recoverIndex).toBeLessThan(listIndex);
  });

  it("re-queues interrupted rows rather than failing them", () => {
    // The request may already have landed. The idempotency key makes replay
    // safe; failing would strand a payment that actually succeeded.
    expect(dbSrc).toMatch(/recoverStuckActions[\s\S]*?SET state = 'queued'/);
  });

  it("reuses one idempotency key for every attempt", () => {
    // Minting per attempt would defeat the mechanism entirely.
    expect(syncSrc).toMatch(/"Idempotency-Key": action\.idempotencyKey/);
    expect(syncSrc).not.toMatch(/Idempotency-Key.*randomUUID/);
    expect(dbSrc).toMatch(/idempotencyKey: crypto\.randomUUID\(\)/);
  });

  it("keeps a terminally failed action instead of deleting it", () => {
    expect(syncSrc).toMatch(/markActionFailed\(/);
    expect(dbSrc).toMatch(/markActionFailed[\s\S]*?SET state = 'failed'/);
    // And tells the user, with a reference they can quote.
    expect(syncSrc).toMatch(/announceFailure/);
    expect(syncSrc).toMatch(/Reference \$\{correlationId\}/);
  });

  it("stops the pass on a transport error instead of burning the queue", () => {
    expect(syncSrc).toMatch(/e instanceof NetworkError[\s\S]{0,400}break;/);
  });

  it("does not count an offline deferral as a failed attempt", () => {
    // rescheduleAction bumps retry_count, so the offline branch must reschedule
    // for `now` and break — never consume one of the six attempts.
    const offlineBranch = syncSrc.slice(syncSrc.indexOf("e instanceof NetworkError"));
    expect(offlineBranch).toMatch(/rescheduleAction\(action\.id, now,/);
  });

  it("still expires stale consent", () => {
    // A biometric confirmation does not stay valid for days.
    expect(syncSrc).toMatch(/MAX_PENDING_AGE_MS = 24 \* 60 \* 60 \* 1000/);
    expect(syncSrc).toMatch(/expire\(action\)/);
  });

  it("carries the correlation id across retries", () => {
    expect(dbSrc).toMatch(/correlation_id = COALESCE\(\?, correlation_id\)/);
  });
});

describe("outbox is multi-rail", () => {
  it("posts to the action's own endpoint, not a hardcoded transfer path", () => {
    expect(syncSrc).toMatch(/await api\(action\.endpoint,/);
    expect(syncSrc).not.toMatch(/await api\("\/wallets\/transfer"/);
  });

  it("no longer filters the queue down to transfers", () => {
    expect(syncSrc).not.toMatch(/action\.type !== "transfer"/);
  });

  it("indexes the due-work query", () => {
    expect(dbSrc).toMatch(/idx_outbox_due ON pending_actions\(state, next_attempt_at\)/);
  });
});
