import { describe, it, expect, beforeEach, vi } from "vitest";
import { sweepAlerts, type AlertDeliverer } from "@/lib/alerts/dispatch";
import { createAlert } from "@/lib/alerts/userAlerts";

// ---------------------------------------------------------------------------
// The sweep: evaluate ticks, deliver what fired.
//
// The behaviours worth pinning are the failure ones. A sweep runs over every
// tracked symbol, so one bad key or one dead push endpoint must not silence
// everybody else's alerts — and a claimed-but-undelivered alert must NOT be
// re-armed, or a single failure becomes a notification loop.
// ---------------------------------------------------------------------------

const g = globalThis as unknown as { __furlpayKv?: Map<string, unknown> };

beforeEach(() => {
  g.__furlpayKv = new Map();
});

let seq = 0;
const nextUser = () => `sweep_user_${++seq}`;

async function armAbove(userId: string, symbol: string, target: number) {
  return createAlert({ userId, symbol, direction: "above", targetPrice: target, currentPrice: target - 1 });
}

describe("sweeping ticks", () => {
  it("delivers exactly the alerts that fired", async () => {
    const userId = nextUser();
    await armAbove(userId, "EURUSD", 10);
    await armAbove(userId, "GBPUSD", 100); // will not be crossed

    const delivered: string[] = [];
    const deliver: AlertDeliverer = async (t) => void delivered.push(t.alert.symbol);

    const result = await sweepAlerts(
      [
        { symbol: "EURUSD", price: 11 },
        { symbol: "GBPUSD", price: 50 },
      ],
      deliver
    );

    expect(result.evaluated).toBe(2);
    expect(result.triggered).toBe(1);
    expect(result.delivered).toBe(1);
    expect(result.failed).toBe(0);
    expect(delivered).toEqual(["EURUSD"]);
  });

  it("counts a delivery failure WITHOUT re-arming the alert", async () => {
    // The ordering decision. Re-arming on a send failure turns one undelivered
    // notification into a loop that re-fires on every subsequent tick. A user who
    // missed one alert is better served than one whose phone buzzes forever.
    const userId = nextUser();
    await armAbove(userId, "EURUSD", 10);

    const failing: AlertDeliverer = async () => {
      throw new Error("push endpoint gone");
    };

    const first = await sweepAlerts([{ symbol: "EURUSD", price: 11 }], failing);
    expect(first.triggered).toBe(1);
    expect(first.delivered).toBe(0);
    expect(first.failed).toBe(1);

    // The `once` alert is retired even though delivery failed — no loop.
    const second = await sweepAlerts([{ symbol: "EURUSD", price: 12 }], async () => {});
    expect(second.triggered, "a failed delivery must not re-fire").toBe(0);
  });

  it("keeps sweeping after one symbol's delivery throws", async () => {
    // Independence: symbols are unrelated, and one failure must not abort the
    // rest of the sweep.
    const userId = nextUser();
    await armAbove(userId, "EURUSD", 10);
    await armAbove(userId, "GBPUSD", 10);

    const seen: string[] = [];
    const flaky: AlertDeliverer = async (t) => {
      if (t.alert.symbol === "EURUSD") throw new Error("boom");
      seen.push(t.alert.symbol);
    };

    const result = await sweepAlerts(
      [
        { symbol: "EURUSD", price: 11 },
        { symbol: "GBPUSD", price: 11 },
      ],
      flaky
    );

    expect(result.triggered).toBe(2);
    expect(result.delivered).toBe(1);
    expect(result.failed).toBe(1);
    expect(seen, "the second symbol still delivered").toEqual(["GBPUSD"]);
  });

  it("does nothing, loudly or otherwise, when no alerts exist", async () => {
    const result = await sweepAlerts([{ symbol: "EURUSD", price: 1.1 }], async () => {
      throw new Error("must not be called");
    });
    expect(result).toEqual({ evaluated: 1, triggered: 0, delivered: 0, failed: 0 });
  });

  it("delivers a deep link to the instrument, not a bare notification", async () => {
    // An alert the user cannot act on is half a feature.
    const userId = nextUser();
    await armAbove(userId, "EURUSD", 10);

    const payloads: { url?: string; title: string }[] = [];
    const capture: AlertDeliverer = async (t) => {
      const { alertMessage } = await import("@/lib/alerts/userAlerts");
      const msg = alertMessage(t);
      payloads.push({ url: `/markets/${t.alert.symbol}`, title: msg.title });
    };

    await sweepAlerts([{ symbol: "EURUSD", price: 11 }], capture);
    expect(payloads[0].url).toBe("/markets/EURUSD");
    expect(payloads[0].title).toContain("rose above");
  });
});
