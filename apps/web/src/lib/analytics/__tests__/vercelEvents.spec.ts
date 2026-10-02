import { beforeEach, describe, expect, it, vi } from "vitest";

const sent: unknown[][] = [];
vi.mock("@vercel/analytics", () => ({ track: (...a: unknown[]) => sent.push(a) }));

import { resetTrackedEventsForTest, trackEvent } from "@/lib/analytics/vercelEvents";

beforeEach(() => {
  sent.length = 0;
  resetTrackedEventsForTest();
});

describe("trackEvent", () => {
  it("sends a schema event with no properties", () => {
    expect(trackEvent("scheduler_opened")).toBe(true);
    expect(sent).toEqual([["scheduler_opened", undefined]]);
  });
  it("dedupes by key for the life of the page (e.g. a Cal booking uid)", () => {
    expect(trackEvent("founder_call_booked", {}, "uid-1")).toBe(true);
    expect(trackEvent("founder_call_booked", {}, "uid-1")).toBe(false);
    expect(trackEvent("founder_call_booked", {}, "uid-2")).toBe(true);
    expect(sent).toHaveLength(2);
  });
  it("refuses more than the 2 properties Pro allows, and non-primitive values", () => {
    expect(trackEvent("scheduler_opened", { a: 1, b: 2, c: 3 } as never)).toBe(false);
    expect(trackEvent("scheduler_opened", { a: { nested: true } } as never)).toBe(false);
    expect(trackEvent("scheduler_opened", { a: "x".repeat(65) } as never)).toBe(false);
    expect(sent).toHaveLength(0);
  });
  it("never throws when the SDK does", async () => {
    vi.resetModules();
    vi.doMock("@vercel/analytics", () => ({
      track: () => {
        throw new Error("boom");
      },
    }));
    const m = await import("@/lib/analytics/vercelEvents");
    expect(m.trackEvent("scheduler_opened")).toBe(false);
  });
});
