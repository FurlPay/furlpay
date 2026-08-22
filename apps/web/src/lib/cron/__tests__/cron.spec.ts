import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Cron authentication, the job runner, and alert suppression.
//
// The three properties that matter, and each has a specific disaster behind it:
//
//   1. An unconfigured cron endpoint must REFUSE, not run. The opposite default
//      is how a mutation endpoint ends up open to the internet.
//   2. Two concurrent runs must not both proceed over financial state.
//   3. Alerts must be suppressed by fingerprint, or the channel becomes noise
//      and the one alert that mattered arrives into something nobody reads.
// ---------------------------------------------------------------------------

const store = new Map<string, unknown>();
const counters = new Map<string, number>();
let kvBroken = false;

vi.mock("@/lib/kv", () => ({
  kvBackend: "redis",
  kvGet: async (k: string) => {
    if (kvBroken) throw new Error("kv down");
    return store.has(k) ? store.get(k) : null;
  },
  kvSet: async (k: string, v: unknown) => {
    if (kvBroken) throw new Error("kv down");
    store.set(k, v);
  },
  kvDel: async (k: string) => {
    store.delete(k);
  },
  kvSetNx: async (k: string, v: unknown) => {
    if (kvBroken) throw new Error("kv down");
    if (store.has(k)) return false;
    store.set(k, v);
    return true;
  },
  kvIncr: async (k: string) => {
    if (kvBroken) throw new Error("kv down");
    const next = (counters.get(k) ?? 0) + 1;
    counters.set(k, next);
    return next;
  },
  kvListPush: async () => {},
  kvListRange: async () => [],
}));

vi.mock("@/lib/log", () => ({ log: { error: () => {}, warn: () => {}, info: () => {} } }));

const { requireCron, cronConfigured } = await import("../auth");
const { runJob, lastRun, isJobHealthy } = await import("../runner");
const { fingerprint, raiseAlert, notifierConfigured } = await import("@/lib/alerts");

/** A NextRequest-shaped stub — only `headers.get` is read. */
function req(headers: Record<string, string> = {}) {
  return {
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
  } as unknown as Parameters<typeof requireCron>[0];
}

const ENV_KEYS = ["CRON_SECRET", "FURLPAY_CRON_SECRET", "FURLPAY_ALERT_SLACK_WEBHOOK", "FURLPAY_ALERT_WEBHOOK_URL"];
const original: Record<string, string | undefined> = {};

beforeEach(() => {
  store.clear();
  counters.clear();
  kvBroken = false;
  for (const k of ENV_KEYS) {
    original[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (original[k] === undefined) delete process.env[k];
    else process.env[k] = original[k];
  }
});

describe("requireCron", () => {
  it("REFUSES when no secret is configured", async () => {
    // The critical default. "No secret means no check" is how these endpoints
    // end up open — the secret is added later and nobody notices it was absent.
    const result = requireCron(req({ authorization: "Bearer anything" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.res.status).toBe(503);
      const body = await result.res.json();
      expect(body.error).toBe("cron_not_configured");
    }
    expect(cronConfigured()).toBe(false);
  });

  it("accepts a correct Vercel Cron bearer token", () => {
    process.env.CRON_SECRET = "s3cret-value";
    expect(requireCron(req({ authorization: "Bearer s3cret-value" })).ok).toBe(true);
  });

  it("accepts a correct external scheduler key", () => {
    process.env.FURLPAY_CRON_SECRET = "external-key";
    const result = requireCron(req({ "x-furlpay-cron-key": "external-key" }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.caller).toBe("external");
  });

  it("rejects a wrong secret", () => {
    process.env.CRON_SECRET = "right";
    expect(requireCron(req({ authorization: "Bearer wrong" })).ok).toBe(false);
  });

  it("rejects a secret of a different length without throwing", () => {
    // timingSafeEqual throws on a length mismatch; an uncaught throw would turn
    // a failed auth into a 500.
    process.env.CRON_SECRET = "right";
    expect(() => requireCron(req({ authorization: "Bearer x" }))).not.toThrow();
    expect(requireCron(req({ authorization: "Bearer x" })).ok).toBe(false);
  });

  it("rejects a request with no credential at all", () => {
    process.env.CRON_SECRET = "right";
    expect(requireCron(req()).ok).toBe(false);
  });

  it("does NOT treat the x-vercel-cron header as a credential", () => {
    // Vercel sets it on its own requests, which makes it tempting. It is a
    // header; anyone can send it.
    process.env.CRON_SECRET = "right";
    const result = requireCron(req({ "x-vercel-cron": "1" }));
    expect(result.ok).toBe(false);
  });
});

describe("runJob", () => {
  it("runs the body and records the outcome", async () => {
    const outcome = await runJob("test.job", async (ctx) => {
      ctx.metric("processed", 3);
      ctx.note("did the thing");
    });

    expect(outcome.status).toBe("completed");
    if (outcome.status === "completed") {
      expect(outcome.record.ok).toBe(true);
      expect(outcome.record.metrics.processed).toBe(3);
      expect(outcome.record.notes).toContain("did the thing");
    }
    expect((await lastRun("test.job"))?.ok).toBe(true);
  });

  it("refuses to run concurrently with itself", async () => {
    // Two reconcilers on one account race each other into contradictory
    // conclusions.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));

    const first = runJob("test.lock", async () => {
      await gate;
    });
    // Give the first run a tick to take the lock.
    await new Promise((r) => setTimeout(r, 10));

    const second = await runJob("test.lock", async () => {
      throw new Error("must not run");
    });
    expect(second.status).toBe("skipped_locked");

    release();
    expect((await first).status).toBe("completed");
  });

  it("releases the lock so the next run can proceed", async () => {
    await runJob("test.release", async () => {});
    const again = await runJob("test.release", async () => {});
    expect(again.status).toBe("completed");
  });

  it("refuses to run when the lock store is unavailable", async () => {
    // Without exclusivity we cannot rule out two concurrent passes over
    // financial state, so not running is the safe answer.
    kvBroken = true;
    const outcome = await runJob("test.nolock", async () => {
      throw new Error("must not run");
    });
    expect(outcome.status).toBe("skipped_locked");
  });

  it("catches a throwing body instead of propagating a 500", async () => {
    // A 500 makes the scheduler retry work that may have half-completed.
    const outcome = await runJob("test.throws", async () => {
      throw new Error("boom");
    });
    expect(outcome.status).toBe("failed");
    if (outcome.status === "failed") {
      expect(outcome.record.ok).toBe(false);
      expect(outcome.record.error).toBe("boom");
    }
  });

  it("records a run that the deadline cut short as PARTIAL", async () => {
    // A partial pass that reports being partial is worth far more than a
    // complete pass that vanishes when the platform kills the function.
    const outcome = await runJob(
      "test.budget",
      async (ctx) => {
        while (!ctx.expired()) {
          await new Promise((r) => setTimeout(r, 5));
        }
        ctx.metric("looped", 1);
      },
      { budgetMs: 40 }
    );
    expect(outcome.status).toBe("completed");
    if (outcome.status === "completed") expect(outcome.record.partial).toBe(true);
  });

  it("bounds the notes it stores", async () => {
    const outcome = await runJob("test.notes", async (ctx) => {
      for (let i = 0; i < 500; i++) ctx.note(`note ${i}`);
    });
    if (outcome.status === "completed") expect(outcome.record.notes.length).toBeLessThanOrEqual(200);
  });
});

describe("isJobHealthy", () => {
  it("reports a job that has never run as unhealthy", async () => {
    // The silent failure: a job that stops running generates no errors.
    const health = await isJobHealthy("never.ran", 3600);
    expect(health.healthy).toBe(false);
    expect(health.detail).toContain("no recorded run");
  });

  it("reports a recent successful run as healthy", async () => {
    await runJob("test.fresh", async () => {});
    expect((await isJobHealthy("test.fresh", 3600)).healthy).toBe(true);
  });

  it("reports a stale run as unhealthy", async () => {
    await runJob("test.stale", async () => {});
    const record = store.get("cron:last:test.stale") as { finishedAt: string };
    store.set("cron:last:test.stale", {
      ...record,
      finishedAt: new Date(Date.now() - 10 * 3600 * 1000).toISOString(),
    });
    expect((await isJobHealthy("test.stale", 3600)).healthy).toBe(false);
  });

  it("reports a failed last run as unhealthy even when recent", async () => {
    await runJob("test.failed", async () => {
      throw new Error("nope");
    });
    expect((await isJobHealthy("test.failed", 3600)).healthy).toBe(false);
  });
});

describe("alert fingerprinting and suppression", () => {
  it("gives the same problem the same fingerprint", () => {
    const a = fingerprint("recon.mismatch", { userId: "u1", provider: "alpaca" });
    const b = fingerprint("recon.mismatch", { provider: "alpaca", userId: "u1" });
    expect(a).toBe(b); // key order must not matter
  });

  it("gives different problems different fingerprints", () => {
    expect(fingerprint("recon.mismatch", { userId: "u1" })).not.toBe(
      fingerprint("recon.mismatch", { userId: "u2" })
    );
    expect(fingerprint("a", { x: 1 })).not.toBe(fingerprint("b", { x: 1 }));
  });

  it("notifies on the first occurrence and suppresses the rest", async () => {
    // Fifty mismatches on one account is one alert with a count, not fifty
    // pages.
    const args = {
      kind: "recon.mismatch",
      severity: "critical" as const,
      title: "Mismatch",
      detail: "positions disagree",
      dimensions: { userId: "u1" },
    };

    const first = await raiseAlert(args);
    expect(first.notified).toBe(true);
    expect(first.delivered).toContain("log");

    const second = await raiseAlert(args);
    expect(second.notified).toBe(false);
    expect(second.suppressedBy).toBe("cooldown");
    // Suppression is not silence — the count still rises.
    expect(second.occurrences).toBe(2);
  });

  it("does not let one problem suppress a different one", async () => {
    const base = { kind: "recon.mismatch", severity: "critical" as const, title: "t", detail: "d" };
    expect((await raiseAlert({ ...base, dimensions: { userId: "u1" } })).notified).toBe(true);
    expect((await raiseAlert({ ...base, dimensions: { userId: "u2" } })).notified).toBe(true);
  });

  it("notifies anyway when the suppression store is unavailable", async () => {
    // During an infrastructure incident the wrong side to err on is silence.
    kvBroken = true;
    const result = await raiseAlert({
      kind: "infra.down",
      severity: "critical",
      title: "KV down",
      detail: "everything is on fire",
    });
    expect(result.notified).toBe(true);
  });

  it("always includes the log sink, so an alert is never lost", async () => {
    expect(notifierConfigured()).toBe(false);
    const result = await raiseAlert({
      kind: "test.nosink",
      severity: "high",
      title: "t",
      detail: "d",
    });
    expect(result.delivered).toEqual(["log"]);
  });

  it("counts a real notifier as configured only when one is set", () => {
    expect(notifierConfigured()).toBe(false);
    process.env.FURLPAY_ALERT_SLACK_WEBHOOK = "https://hooks.slack.com/services/x";
    expect(notifierConfigured()).toBe(true);
  });

  it("ignores a non-https notifier URL", () => {
    process.env.FURLPAY_ALERT_SLACK_WEBHOOK = "http://insecure.example/hook";
    expect(notifierConfigured()).toBe(false);
  });
});
