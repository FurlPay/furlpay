import { describe, it, expect, beforeEach } from "vitest";
import {
  alertMessage,
  AlertError,
  createAlert,
  deleteAlert,
  evaluateTick,
  listAlerts,
  MAX_ALERTS_PER_USER,
  RECURRING_COOLDOWN_MS,
} from "@/lib/alerts/userAlerts";

// ---------------------------------------------------------------------------
// The price-alert matching engine.
//
// Three properties carry the design, and each has a test that would fail if the
// property were merely assumed:
//
//   1. EXACTLY-ONCE across concurrent evaluators, with no lock. The claim is the
//      ZREM's return count, so two instances evaluating the same tick cannot both
//      deliver. Tested by racing them.
//   2. AN ALREADY-SATISFIED ALERT IS REFUSED AT CREATION, so the engine never
//      fires for a move that happened before the user asked.
//   3. A RECURRING ALERT RE-ARMS but does not flap — it is claimed, suppressed
//      inside the cooldown, and put back rather than silently deleted.
//
// These run against the in-memory KV fallback, which implements real sorted-set
// semantics precisely so the engine's correctness can be tested without Redis.
// ---------------------------------------------------------------------------

const g = globalThis as unknown as { __furlpayKv?: Map<string, unknown> };

beforeEach(() => {
  // Each test starts from an empty store; alert ids are random so leakage would
  // not collide, but a shared quota count would.
  g.__furlpayKv = new Map();
});

let seq = 0;
const nextUser = () => `user_alerts_${++seq}`;

describe("creating an alert", () => {
  it("stores an above-alert and lists it back", async () => {
    const userId = nextUser();
    const alert = await createAlert({
      userId,
      symbol: "eurusd",
      direction: "above",
      targetPrice: 1.1,
      currentPrice: 1.05,
    });
    expect(alert.symbol).toBe("EURUSD"); // normalised
    expect(alert.frequency).toBe("once"); // conservative default
    expect(await listAlerts(userId)).toHaveLength(1);
  });

  it("REFUSES an above-alert the price already satisfies", async () => {
    // The correctness decision. "Tell me when it goes above 1.10" asked while it
    // is already 1.15 is satisfied the instant it is stored, so the engine would
    // fire about a move that happened before the user asked. They meant
    // "crossing", and the crossing already happened.
    await expect(
      createAlert({
        userId: nextUser(),
        symbol: "EURUSD",
        direction: "above",
        targetPrice: 1.1,
        currentPrice: 1.15,
      })
    ).rejects.toThrow(/would fire immediately/);
  });

  it("REFUSES a below-alert the price already satisfies", async () => {
    await expect(
      createAlert({
        userId: nextUser(),
        symbol: "EURUSD",
        direction: "below",
        targetPrice: 1.1,
        currentPrice: 1.05,
      })
    ).rejects.toThrow(/would fire immediately/);
  });

  it("REFUSES an alert exactly AT the current price, in both directions", async () => {
    // The boundary. `>=` and `<=` mean an at-the-money alert is also already
    // satisfied, and an off-by-one here would let it through to fire instantly.
    for (const direction of ["above", "below"] as const) {
      await expect(
        createAlert({
          userId: nextUser(),
          symbol: "EURUSD",
          direction,
          targetPrice: 1.1,
          currentPrice: 1.1,
        })
      ).rejects.toThrow(AlertError);
    }
  });

  it("refuses non-finite or non-positive prices", async () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(
        createAlert({
          userId: nextUser(),
          symbol: "EURUSD",
          direction: "above",
          targetPrice: bad,
          currentPrice: 1.05,
        })
      ).rejects.toThrow(AlertError);
    }
  });

  it("enforces the per-user quota", async () => {
    const userId = nextUser();
    for (let i = 0; i < MAX_ALERTS_PER_USER; i++) {
      await createAlert({
        userId,
        symbol: "EURUSD",
        direction: "above",
        targetPrice: 2 + i,
        currentPrice: 1.05,
      });
    }
    await expect(
      createAlert({ userId, symbol: "EURUSD", direction: "above", targetPrice: 99, currentPrice: 1.05 })
    ).rejects.toThrow(/maximum is 50/);
  });
});

describe("matching a tick", () => {
  it("fires an above-alert once the price reaches the target", async () => {
    const userId = nextUser();
    await createAlert({ userId, symbol: "EURUSD", direction: "above", targetPrice: 1.1, currentPrice: 1.05 });

    expect(await evaluateTick("EURUSD", 1.09), "below target must not fire").toHaveLength(0);

    const fired = await evaluateTick("EURUSD", 1.1); // exactly at target counts
    expect(fired).toHaveLength(1);
    expect(fired[0].price).toBe(1.1);
    expect(fired[0].alert.direction).toBe("above");
  });

  it("fires a below-alert once the price falls to the target", async () => {
    const userId = nextUser();
    await createAlert({ userId, symbol: "EURUSD", direction: "below", targetPrice: 1.0, currentPrice: 1.05 });

    expect(await evaluateTick("EURUSD", 1.01)).toHaveLength(0);
    expect(await evaluateTick("EURUSD", 0.99)).toHaveLength(1);
  });

  it("returns ONLY the alerts the price actually crossed", async () => {
    // The point of the sorted set: the work is proportional to the answer. A
    // price at 1.10 must not surface the 1.20 and 1.30 alerts.
    const userId = nextUser();
    for (const target of [1.1, 1.2, 1.3]) {
      await createAlert({ userId, symbol: "EURUSD", direction: "above", targetPrice: target, currentPrice: 1.05 });
    }
    const fired = await evaluateTick("EURUSD", 1.1);
    expect(fired).toHaveLength(1);
    expect(fired[0].alert.targetPrice).toBe(1.1);

    // And a bigger jump surfaces every target it passed, not just the nearest.
    const jump = await evaluateTick("EURUSD", 1.35);
    expect(jump.map((f) => f.alert.targetPrice).sort()).toEqual([1.2, 1.3]);
  });

  it("does not leak alerts across symbols", async () => {
    const userId = nextUser();
    await createAlert({ userId, symbol: "EURUSD", direction: "above", targetPrice: 1.1, currentPrice: 1.05 });
    expect(await evaluateTick("GBPUSD", 99), "a different symbol must not fire it").toHaveLength(0);
  });

  it("ignores a non-finite or non-positive tick rather than firing everything", async () => {
    // A bad feed value must not be treated as "crossed every target".
    const userId = nextUser();
    await createAlert({ userId, symbol: "EURUSD", direction: "below", targetPrice: 1.0, currentPrice: 1.05 });
    for (const bad of [Number.NaN, 0, -5]) {
      expect(await evaluateTick("EURUSD", bad), String(bad)).toHaveLength(0);
    }
    // Still armed afterwards.
    expect(await evaluateTick("EURUSD", 0.99)).toHaveLength(1);
  });
});

describe("exactly-once delivery under concurrency", () => {
  it("claims each alert for exactly ONE of two racing evaluators", async () => {
    // THE PROPERTY THE WHOLE DESIGN RESTS ON. Several instances may evaluate the
    // same tick and all read the same triggered members. The claim is the ZREM's
    // return count, so only the evaluator that actually removed the member
    // delivers. Without this the user gets one notification per instance.
    const userId = nextUser();
    await createAlert({ userId, symbol: "EURUSD", direction: "above", targetPrice: 1.1, currentPrice: 1.05 });

    const [a, b] = await Promise.all([evaluateTick("EURUSD", 1.15), evaluateTick("EURUSD", 1.15)]);
    expect(a.length + b.length, "exactly one evaluator may claim it").toBe(1);
  });

  it("splits a batch between racers without duplicating or dropping any", async () => {
    // Five alerts, two evaluators: every alert delivered once, none twice.
    const userId = nextUser();
    for (const target of [1.1, 1.2, 1.3, 1.4, 1.5]) {
      await createAlert({ userId, symbol: "EURUSD", direction: "above", targetPrice: target, currentPrice: 1.05 });
    }
    const [a, b] = await Promise.all([evaluateTick("EURUSD", 2), evaluateTick("EURUSD", 2)]);
    const ids = [...a, ...b].map((f) => f.alert.id);
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size, "no alert delivered twice").toBe(5);
  });
});

describe("once vs recurring", () => {
  it("retires a `once` alert so it cannot fire again", async () => {
    const userId = nextUser();
    await createAlert({ userId, symbol: "EURUSD", direction: "above", targetPrice: 1.1, currentPrice: 1.05 });

    expect(await evaluateTick("EURUSD", 1.15)).toHaveLength(1);
    expect(await evaluateTick("EURUSD", 1.20), "a fired once-alert must be gone").toHaveLength(0);
    expect(await listAlerts(userId), "and must not linger in the user's list").toHaveLength(0);
  });

  it("re-arms a `recurring` alert after its cooldown", async () => {
    const userId = nextUser();
    const created = await createAlert({
      userId,
      symbol: "EURUSD",
      direction: "above",
      targetPrice: 1.1,
      currentPrice: 1.05,
      frequency: "recurring",
    });

    const first = await evaluateTick("EURUSD", 1.15);
    expect(first).toHaveLength(1);
    expect(first[0].alert.lastFiredAt).toBeTruthy();

    // Inside the cooldown: claimed, suppressed, and PUT BACK. The re-arm is the
    // part that matters — a flapping price must not silently delete the alert.
    expect(await evaluateTick("EURUSD", 1.16), "must not flap").toHaveLength(0);
    expect(await listAlerts(userId), "must still exist after suppression").toHaveLength(1);

    // Past the cooldown, it fires again.
    const stored = (await listAlerts(userId))[0];
    const { kvSet } = await import("@/lib/kv");
    await kvSet(`alerts:meta:${created.id}`, {
      ...stored,
      lastFiredAt: new Date(Date.now() - RECURRING_COOLDOWN_MS - 1000).toISOString(),
    });
    expect(await evaluateTick("EURUSD", 1.17)).toHaveLength(1);
  });
});

describe("ownership", () => {
  it("refuses to delete another user's alert, and reports it as not found", async () => {
    // IDOR. A foreign id is "not found" rather than "forbidden": confirming that
    // someone else's alert exists is itself a disclosure, and the caller has no
    // legitimate use for the distinction.
    const owner = nextUser();
    const thief = nextUser();
    const alert = await createAlert({
      userId: owner,
      symbol: "EURUSD",
      direction: "above",
      targetPrice: 1.1,
      currentPrice: 1.05,
    });

    expect(await deleteAlert(thief, alert.id)).toBe(false);
    expect(await listAlerts(owner), "the owner's alert must survive").toHaveLength(1);

    expect(await deleteAlert(owner, alert.id)).toBe(true);
    expect(await listAlerts(owner)).toHaveLength(0);
  });

  it("a deleted alert no longer fires", async () => {
    const userId = nextUser();
    const alert = await createAlert({
      userId,
      symbol: "EURUSD",
      direction: "above",
      targetPrice: 1.1,
      currentPrice: 1.05,
    });
    await deleteAlert(userId, alert.id);
    expect(await evaluateTick("EURUSD", 1.5)).toHaveLength(0);
  });

  it("one user's list never contains another's alerts", async () => {
    const a = nextUser();
    const b = nextUser();
    await createAlert({ userId: a, symbol: "EURUSD", direction: "above", targetPrice: 1.1, currentPrice: 1.05 });
    await createAlert({ userId: b, symbol: "EURUSD", direction: "above", targetPrice: 1.2, currentPrice: 1.05 });

    const listA = await listAlerts(a);
    expect(listA).toHaveLength(1);
    expect(listA[0].userId).toBe(a);
  });
});

describe("the message shown to the user", () => {
  it("names the direction, target and current price", async () => {
    const userId = nextUser();
    await createAlert({
      userId,
      symbol: "EURUSD",
      direction: "above",
      targetPrice: 1.1,
      currentPrice: 1.05,
      note: "watch the ECB",
    });
    const [fired] = await evaluateTick("EURUSD", 1.12);
    const msg = alertMessage(fired);
    expect(msg.title).toBe("EURUSD rose above 1.1");
    expect(msg.body).toContain("1.12");
    expect(msg.body).toContain("watch the ECB");
  });

  it("says `fell below` for a below-alert", async () => {
    const userId = nextUser();
    await createAlert({ userId, symbol: "EURUSD", direction: "below", targetPrice: 1.0, currentPrice: 1.05 });
    const [fired] = await evaluateTick("EURUSD", 0.98);
    expect(alertMessage(fired).title).toContain("fell below");
  });
});
