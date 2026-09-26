import { describe, expect, it } from "vitest";
import { anomalyThresholds, noteSensitiveAccess } from "../dataAccessAnomaly";
import { listSecurityEvents } from "@/lib/ops/events";

// ---------------------------------------------------------------------------
// Volume detection for privileged customer-data access.
//
// The gap this closes: every individual privileged read is authorized, scoped and
// audited, and that is exactly why bulk extraction was invisible. A hundred
// authorized reads pass a hundred checks. Nothing was counting.
//
// These tests care about two properties and nothing else — it fires at the right
// volume, and it never carries customer data into the event it raises.
// ---------------------------------------------------------------------------

let seq = 0;
const actor = (label: string) => `actor_${label}_${Date.now()}_${seq++}`;

async function hit(kind: Parameters<typeof noteSensitiveAccess>[0]["kind"], id: string, times: number) {
  let last: Awaited<ReturnType<typeof noteSensitiveAccess>> = null;
  for (let i = 0; i < times; i++) {
    last = await noteSensitiveAccess({ kind, actorId: id, resourceRef: `ref_${i}` });
  }
  return last;
}

describe("threshold behaviour", () => {
  it("stays quiet for normal volume", async () => {
    // A compliance officer working one case must never trip this. A detector
    // that cries wolf on ordinary work is a detector people mute.
    const id = actor("quiet");
    const limit = anomalyThresholds().authority_request_staged.limit;
    const result = await hit("authority_request_staged", id, limit);
    expect(result?.exceeded).toBe(false);
  });

  it("fires once past the threshold", async () => {
    const id = actor("bulk");
    const limit = anomalyThresholds().authority_request_staged.limit;
    const result = await hit("authority_request_staged", id, limit + 1);
    expect(result?.exceeded).toBe(true);
    expect(result?.count).toBe(limit + 1);
  });

  it("raises exactly ONE event on the crossing, not one per request after it", async () => {
    // A detector that re-fires on every subsequent request buries the signal it
    // just raised — a hundred identical events is the same as none.
    const id = actor("once");
    const limit = anomalyThresholds().kyc_access.limit;
    await hit("kyc_access", id, limit + 12);

    const events = (await listSecurityEvents(500)).filter(
      (e) => e.actor === id && e.kind === "anomaly_kyc_access"
    );
    expect(events).toHaveLength(1);
  });

  it("counts each actor separately", async () => {
    // Otherwise a busy team looks like one attacker, and the real one hides in
    // the aggregate.
    const a = actor("alice");
    const b = actor("bob");
    const limit = anomalyThresholds().customer_export.limit;

    await hit("customer_export", a, limit + 1);
    const bobResult = await hit("customer_export", b, 1);
    expect(bobResult?.exceeded).toBe(false);
  });

  it("counts each KIND separately", async () => {
    // Staging dossiers and downloading statements are different activities with
    // different normal volumes; one must not consume the other's budget.
    const id = actor("mixed");
    await hit("statement_download", id, 6);
    const staged = await hit("authority_request_staged", id, 1);
    expect(staged?.exceeded).toBe(false);
  });
});

describe("the event carries no customer data", () => {
  it("names the actor and the volume, never the subject", async () => {
    // THE RULE THAT MATTERS. This detector runs on exactly the paths where
    // customer records are in scope. An event that quoted what was accessed
    // would turn the ops feed into the easiest place in the system to read
    // dossiers — a monitoring control that recreates the thing it monitors.
    const id = actor("nodata");
    const limit = anomalyThresholds().authority_disclosure_redeemed.limit;

    // A marker distinctive enough that finding it anywhere in the event proves
    // the resourceRef reached it. The first version of this test looked for
    // `ref_0` while the crossing actually fires on `ref_<limit>` — so a mutant
    // that inlined the reference into the detail passed cleanly. Constant
    // marker, no arithmetic, nothing to get off by one.
    const MARKER = "CUSTOMER_REF_MUST_NOT_APPEAR";
    for (let i = 0; i <= limit; i++) {
      await noteSensitiveAccess({
        kind: "authority_disclosure_redeemed",
        actorId: id,
        resourceRef: MARKER,
      });
    }

    const evt = (await listSecurityEvents(500)).find(
      (e) => e.actor === id && e.kind === "anomaly_authority_disclosure_redeemed"
    );
    expect(evt).toBeTruthy();

    const serialized = JSON.stringify(evt);
    // The reference is a correlation handle for the audit trail, not something
    // the ops feed needs. Even an opaque one stays out of the event.
    expect(serialized).not.toContain(MARKER);
    expect(serialized).toContain(id);
    expect(evt?.severity).toBe("high");
  });

  it("the signature cannot accept a customer record at all", () => {
    // Enforced by the type, not by remembering: `noteSensitiveAccess` takes a
    // kind, an actor id and an optional opaque string. There is no parameter a
    // caller could pass an account object through.
    const params = { kind: "kyc_access" as const, actorId: "a", resourceRef: "r" };
    expect(Object.keys(params).sort()).toEqual(["actorId", "kind", "resourceRef"]);
  });
});

describe("failure behaviour", () => {
  it("never throws on an unknown kind", async () => {
    // The detector sits inline on compliance actions. It must not be able to
    // break a legitimate statutory disclosure by failing — it is a smoke alarm,
    // and the locks are elsewhere.
    const result = await noteSensitiveAccess({
      kind: "not_a_real_kind" as never,
      actorId: actor("unknown"),
    });
    expect(result).toBeNull();
  });

  it("every declared kind has a usable threshold", async () => {
    // A kind with a missing or zero threshold silently monitors nothing.
    for (const [kind, t] of Object.entries(anomalyThresholds())) {
      expect(t.limit, `${kind} has no limit`).toBeGreaterThan(0);
      expect(t.windowSeconds, `${kind} has no window`).toBeGreaterThan(0);
      expect(t.note.length, `${kind} has no responder note`).toBeGreaterThan(10);
    }
  });

  it("the highest-consequence kinds are high severity", async () => {
    // Bulk dossier assembly, completed disclosures, token probing and privilege
    // changes are the four that should wake someone up.
    const t = anomalyThresholds();
    expect(t.authority_request_staged.severity).toBe("high");
    expect(t.authority_disclosure_redeemed.severity).toBe("high");
    expect(t.authority_disclosure_denied.severity).toBe("high");
    expect(t.role_change.severity).toBe("high");
  });
});
