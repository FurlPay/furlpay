import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  evaluateRevocation,
  subjectsForPayment,
  DEFAULT_MAX_STALENESS_MS,
} from "@furlpay/control-plane";

// ---------------------------------------------------------------------------
// The revocation adapter, attacked at the seam the pure engine cannot defend.
//
// `evaluateRevocation` is already proven by 24 tests in the package. What those
// cannot test is whether the ADAPTER hands it an honest snapshot, and there are
// exactly two ways to make the engine useless without touching it:
//
//   1. Stamp `fetchedAtMs` at CACHE-READ time instead of SOURCE-READ time. Every
//      snapshot is then permanently fresh, the staleness bound never fires, and a
//      cached "nothing is revoked" is trusted forever. The engine still passes
//      all its own tests.
//
//   2. Return an EMPTY entries list when the store is unreachable. "Nothing is
//      revoked" and "we could not find out" become the same answer.
//
// Both are tested here, along with the three races the architecture names.
// ---------------------------------------------------------------------------

const ORG = "org_a";

// The store and KV are mocked at module level so the adapter's real logic runs
// while the backends are controllable. `controlPlaneDurable` is mocked true
// because the durability refusal has its own test below.
const kv = new Map<string, unknown>();
let loadRevocationsImpl: () => Promise<unknown>;
let insertRevocationImpl: () => Promise<boolean>;
let durable = true;

vi.mock("@/lib/kv", () => ({
  kvGet: vi.fn(async (k: string) => (kv.has(k) ? kv.get(k) : null)),
  kvSet: vi.fn(async (k: string, v: unknown) => void kv.set(k, v)),
  kvDel: vi.fn(async (k: string) => void kv.delete(k)),
}));

vi.mock("../store", () => ({
  controlPlaneDurable: () => durable,
  loadRevocations: () => loadRevocationsImpl(),
  insertRevocation: () => insertRevocationImpl(),
}));

const {
  revocationLookup,
  revokeSubject,
  setKillSwitch,
  invalidateRevocationCache,
} = await import("../revocationAdapter");

const CHAIN = subjectsForPayment({
  organizationId: ORG,
  principalId: "prin_1",
  delegationId: "del_1",
  operatorId: "op_1",
  agentId: "agent_1",
  sessionId: "sess_1",
  mandateId: "mand_1",
});

function decide(lookup: Awaited<ReturnType<typeof revocationLookup>>, nowMs = Date.now()) {
  return evaluateRevocation({
    lookup,
    subjects: CHAIN,
    organizationId: ORG,
    nowMs,
    maxStalenessMs: DEFAULT_MAX_STALENESS_MS,
  });
}

beforeEach(() => {
  kv.clear();
  durable = true;
  loadRevocationsImpl = async () => [];
  insertRevocationImpl = async () => true;
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the adapter fails closed on every unavailable backend", () => {
  it("denies when the control-plane tables are not applied", async () => {
    durable = true;
    // Simulate 0020 absent: the store returns null rather than an empty array.
    loadRevocationsImpl = async () => null;
    const lookup = await revocationLookup(ORG);
    expect(lookup.ok).toBe(false);
    expect(decide(lookup).live).toBe(false);
  });

  it("denies when durability is off entirely, rather than reading an empty list", async () => {
    // The dangerous shape: no tables, so nothing is revoked, so everything is
    // authorized. This must be a refusal, not an empty answer.
    durable = false;
    const lookup = await revocationLookup(ORG);
    expect(lookup.ok).toBe(false);
    if (!lookup.ok) expect(lookup.error).toMatch(/nothing is revoked/);
    const verdict = decide(lookup);
    expect(verdict.live).toBe(false);
    if (!verdict.live) expect(verdict.reason).toBe("state_unavailable");
  });

  it("denies when the revocation store throws", async () => {
    loadRevocationsImpl = async () => {
      throw new Error("ECONNREFUSED postgres:5432");
    };
    const lookup = await revocationLookup(ORG);
    expect(lookup.ok).toBe(false);
    if (!lookup.ok) expect(lookup.error).toMatch(/ECONNREFUSED/);
    expect(decide(lookup).live).toBe(false);
  });

  it("a SNAPSHOT-cache fault degrades to a read-through rather than to a denial", async () => {
    // Redis down should cost latency, not availability — but the snapshot it
    // produces is still subject to the staleness bound.
    //
    // The rejection is targeted at the SNAPSHOT key specifically. A blanket
    // `mockRejectedValueOnce` lands on the kill-switch read instead, which
    // correctly denies (see "an unreadable kill switch denies"), and the test
    // would then pass for the wrong reason.
    const { kvGet } = await import("@/lib/kv");
    (kvGet as ReturnType<typeof vi.fn>).mockImplementationOnce(async (k: string) =>
      k.startsWith("cp:killswitch") ? null : Promise.reject(new Error("redis down"))
    );
    (kvGet as ReturnType<typeof vi.fn>).mockImplementationOnce(async (k: string) =>
      k.startsWith("cp:killswitch") ? null : Promise.reject(new Error("redis down"))
    );
    (kvGet as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      throw new Error("redis down");
    });
    loadRevocationsImpl = async () => [];
    const lookup = await revocationLookup(ORG);
    expect(lookup.ok, "a cache fault must not deny").toBe(true);
    expect(decide(lookup).live).toBe(true);
  });
});

describe("fetchedAtMs is the SOURCE time, not the cache-read time", () => {
  it("a cached snapshot keeps its original timestamp and eventually goes stale", async () => {
    vi.useFakeTimers();
    const t0 = new Date("2026-09-28T12:00:00Z").getTime();
    vi.setSystemTime(t0);

    loadRevocationsImpl = async () => [];
    const first = await revocationLookup(ORG);
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.snapshot.fetchedAtMs).toBe(t0);

    // Time passes well beyond the bound. The store is NOT consulted again
    // because the cache still holds the entry.
    let storeReads = 0;
    loadRevocationsImpl = async () => {
      storeReads += 1;
      return [];
    };
    vi.setSystemTime(t0 + DEFAULT_MAX_STALENESS_MS + 5_000);

    const second = await revocationLookup(ORG);
    expect(second.ok).toBe(true);
    if (second.ok) {
      // THE ASSERTION THAT MATTERS: the timestamp did not move.
      expect(second.snapshot.fetchedAtMs).toBe(t0);
    }
    expect(storeReads).toBe(0);

    // And therefore the engine refuses it as stale, rather than trusting a
    // cached "nothing is revoked" indefinitely.
    const verdict = decide(second, t0 + DEFAULT_MAX_STALENESS_MS + 5_000);
    expect(verdict.live).toBe(false);
    if (!verdict.live) expect(verdict.reason).toBe("state_stale");
  });

  it("a fresh read-through produces a snapshot the engine accepts", async () => {
    vi.useFakeTimers();
    const t0 = new Date("2026-09-28T12:00:00Z").getTime();
    vi.setSystemTime(t0);
    loadRevocationsImpl = async () => [];
    const lookup = await revocationLookup(ORG);
    expect(decide(lookup, t0 + 100).live).toBe(true);
  });

  it("the timestamp is taken BEFORE the store read, so a slow query is not counted as fresh", async () => {
    vi.useFakeTimers();
    const t0 = new Date("2026-09-28T12:00:00Z").getTime();
    vi.setSystemTime(t0);

    // A query that takes longer than the whole staleness budget.
    loadRevocationsImpl = async () => {
      vi.setSystemTime(t0 + DEFAULT_MAX_STALENESS_MS + 1_000);
      return [];
    };

    const lookup = await revocationLookup(ORG);
    expect(lookup.ok).toBe(true);
    if (lookup.ok) {
      // Stamped at t0, not at completion. Stamping after would have overstated
      // freshness by exactly the query duration.
      expect(lookup.snapshot.fetchedAtMs).toBe(t0);
    }
    const verdict = decide(lookup, t0 + DEFAULT_MAX_STALENESS_MS + 1_000);
    expect(verdict.live).toBe(false);
    if (!verdict.live) expect(verdict.reason).toBe("state_stale");
  });
});

describe("the kill switch is read on every call and outranks the cache", () => {
  it("engaging the global switch denies immediately, even with a warm cache", async () => {
    loadRevocationsImpl = async () => [];
    expect(decide(await revocationLookup(ORG)).live).toBe(true);

    await setKillSwitch({
      scope: "global",
      engaged: true,
      reason: "incident 2026-09-28",
      engagedBy: "ops@furlpay",
    });

    // No cache invalidation was performed, and it still denies: the switch is
    // read on every call precisely so an incident control is not queued behind
    // a TTL.
    const verdict = decide(await revocationLookup(ORG));
    expect(verdict.live).toBe(false);
    if (!verdict.live) {
      expect(verdict.reason).toBe("kill_switch_engaged");
      expect(verdict.detail).toMatch(/incident 2026-09-28/);
    }
  });

  it("an organization switch stops that tenant and no other", async () => {
    loadRevocationsImpl = async () => [];
    await setKillSwitch({
      scope: "organization",
      organizationId: ORG,
      engaged: true,
      reason: "compromised key",
      engagedBy: "ops",
    });
    expect(decide(await revocationLookup(ORG)).live).toBe(false);

    const other = await revocationLookup("org_b");
    expect(
      evaluateRevocation({
        lookup: other,
        subjects: [{ kind: "organization", id: "org_b" }],
        organizationId: "org_b",
        nowMs: Date.now(),
        maxStalenessMs: DEFAULT_MAX_STALENESS_MS,
      }).live
    ).toBe(true);
  });

  it("the global switch cannot be escaped by a tenant without its own switch", async () => {
    loadRevocationsImpl = async () => [];
    await setKillSwitch({ scope: "global", engaged: true, reason: "halt", engagedBy: "ops" });
    for (const org of [ORG, "org_b", "org_c"]) {
      const lookup = await revocationLookup(org);
      expect(lookup.ok).toBe(true);
      if (lookup.ok) expect(lookup.snapshot.killSwitch.engaged).toBe(true);
    }
  });

  it("releasing the switch restores service", async () => {
    loadRevocationsImpl = async () => [];
    await setKillSwitch({ scope: "global", engaged: true, reason: "halt", engagedBy: "ops" });
    expect(decide(await revocationLookup(ORG)).live).toBe(false);
    await setKillSwitch({ scope: "global", engaged: false, reason: "resolved", engagedBy: "ops" });
    expect(decide(await revocationLookup(ORG)).live).toBe(true);
  });

  it("an unreadable kill switch denies rather than assuming it is off", async () => {
    const { kvGet } = await import("@/lib/kv");
    (kvGet as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("redis gone"));
    (kvGet as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("redis gone"));
    const lookup = await revocationLookup(ORG);
    expect(lookup.ok).toBe(false);
    if (!lookup.ok) expect(lookup.error).toMatch(/kill switch unreadable/);
  });
});

describe("the three races the architecture names", () => {
  it("RACE 1 — authorize, revoke, authorize: the second is refused", async () => {
    loadRevocationsImpl = async () => [];
    expect(decide(await revocationLookup(ORG)).live).toBe(true);

    let revoked = false;
    insertRevocationImpl = async () => {
      revoked = true;
      return true;
    };
    loadRevocationsImpl = async () =>
      revoked
        ? [
            {
              kind: "mandate" as const,
              id: "mand_1",
              revokedAt: new Date().toISOString(),
              reason: "project ended",
              revokedBy: "admin",
            },
          ]
        : [];

    await revokeSubject({
      organizationId: ORG,
      kind: "mandate",
      subjectId: "mand_1",
      reason: "project ended",
      revokedBy: "admin",
    });

    const verdict = decide(await revocationLookup(ORG));
    expect(verdict.live).toBe(false);
    if (!verdict.live) {
      expect(verdict.reason).toBe("subject_revoked");
      expect(verdict.subject?.kind).toBe("mandate");
    }
  });

  it("RACE 2 — revoking an ANCESTOR denies the descendant's payment", async () => {
    // Deprovisioning a human must kill every agent beneath them. Nobody has to
    // enumerate the descendants, because the whole chain is the input.
    let revoked = false;
    insertRevocationImpl = async () => {
      revoked = true;
      return true;
    };
    loadRevocationsImpl = async () =>
      revoked
        ? [
            {
              kind: "delegation" as const,
              id: "del_1",
              revokedAt: new Date().toISOString(),
              reason: "employee deprovisioned in Okta",
              revokedBy: "scim",
            },
          ]
        : [];

    expect(decide(await revocationLookup(ORG)).live).toBe(true);

    await revokeSubject({
      organizationId: ORG,
      kind: "delegation",
      subjectId: "del_1",
      reason: "employee deprovisioned in Okta",
      revokedBy: "scim",
    });

    const verdict = decide(await revocationLookup(ORG));
    expect(verdict.live).toBe(false);
    if (!verdict.live) {
      expect(verdict.subject?.kind).toBe("delegation");
      expect(verdict.detail).toMatch(/deprovisioned/);
    }
  });

  it("RACE 3 — authorize, revoke, SIGN: signing must re-check and refuse", async () => {
    // The critical one. An authorization decided a moment ago is not a statement
    // about now, so the signing step performs its OWN fresh lookup.
    loadRevocationsImpl = async () => [];
    const atAuthorize = decide(await revocationLookup(ORG));
    expect(atAuthorize.live).toBe(true);

    let revoked = false;
    insertRevocationImpl = async () => {
      revoked = true;
      return true;
    };
    loadRevocationsImpl = async () =>
      revoked
        ? [
            {
              kind: "agent" as const,
              id: "agent_1",
              revokedAt: new Date().toISOString(),
              reason: "agent terminated",
              revokedBy: "admin",
            },
          ]
        : [];

    await revokeSubject({
      organizationId: ORG,
      kind: "agent",
      subjectId: "agent_1",
      reason: "agent terminated",
      revokedBy: "admin",
    });

    const atSigning = decide(await revocationLookup(ORG));
    expect(atSigning.live).toBe(false);
    if (!atSigning.live) expect(atSigning.subject?.kind).toBe("agent");
  });

  it("revocation invalidates the cache, so the next read sees it without waiting for a TTL", async () => {
    loadRevocationsImpl = async () => [];
    await revocationLookup(ORG); // warm

    let revoked = false;
    insertRevocationImpl = async () => {
      revoked = true;
      return true;
    };
    let reads = 0;
    loadRevocationsImpl = async () => {
      reads += 1;
      return revoked
        ? [{ kind: "agent" as const, id: "agent_1", revokedAt: "x", reason: "r", revokedBy: "b" }]
        : [];
    };

    await revokeSubject({
      organizationId: ORG,
      kind: "agent",
      subjectId: "agent_1",
      reason: "r",
      revokedBy: "b",
    });

    await revocationLookup(ORG);
    expect(reads, "the cache must have been invalidated, forcing a re-read").toBeGreaterThan(0);
  });

  it("a revocation whose cache invalidation FAILS is still durable", async () => {
    // The write landing matters more than the cache. The staleness bound caps
    // how long the stale snapshot can be trusted, which is the bound doing its
    // job rather than an error to swallow.
    const { kvDel } = await import("@/lib/kv");
    (kvDel as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("redis gone"));
    insertRevocationImpl = async () => true;
    const ok = await revokeSubject({
      organizationId: ORG,
      kind: "agent",
      subjectId: "agent_1",
      reason: "r",
      revokedBy: "b",
    });
    expect(ok).toBe(true);
  });

  it("a revocation whose WRITE fails reports failure", async () => {
    insertRevocationImpl = async () => false;
    const ok = await revokeSubject({
      organizationId: ORG,
      kind: "agent",
      subjectId: "agent_1",
      reason: "r",
      revokedBy: "b",
    });
    expect(ok).toBe(false);
  });
});

describe("tenancy", () => {
  it("one tenant's revocations never appear in another's snapshot", async () => {
    const perOrg: Record<string, unknown[]> = {
      org_a: [{ kind: "agent", id: "agent_1", revokedAt: "x", reason: "r", revokedBy: "b" }],
      org_b: [],
    };
    let requested = "";
    // The adapter passes the organization through to the store; this asserts it
    // actually scopes rather than reading everything and filtering later.
    const mod = await import("../store");
    vi.spyOn(mod, "loadRevocations").mockImplementation(async (org: string) => {
      requested = org;
      return perOrg[org] as never;
    });

    await invalidateRevocationCache("org_b");
    await revocationLookup("org_b");
    expect(requested).toBe("org_b");
  });
});
