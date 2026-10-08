import { afterEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ impl: (() => new Promise(() => undefined)) as () => Promise<{ hits: unknown[] }>, factoryThrows: false }));
vi.mock("@/lib/compliance/providers/factory", () => ({
  getScreeningProvider: async () => {
    if (m.factoryThrows) throw new Error("no provider");
    return { name: "furlpay", screenSanctions: () => m.impl() };
  },
}));

import { emptyState, type OnboardingState } from "../onboarding";
import { REUSE_MS, requestKey, runScreening, SCREENING_TIMEOUT_MS, screeningSubjects } from "../screening";
import * as fx from "./fixtures";

const state = (): OnboardingState => ({
  ...emptyState(),
  business: fx.business as OnboardingState["business"],
  identity: fx.identity as OnboardingState["identity"],
  details: fx.details as OnboardingState["details"],
});

afterEach(() => {
  vi.useRealTimers();
  m.factoryThrows = false;
});

describe("runScreening", () => {
  it("returns null until the screened steps exist", async () => {
    expect(await runScreening(emptyState(), "r")).toBeNull();
  });

  it("times out as failed (Screening unavailable), never clear", async () => {
    vi.useFakeTimers();
    m.impl = () => new Promise(() => undefined);
    const p = runScreening(state(), "r");
    await vi.advanceTimersByTimeAsync(SCREENING_TIMEOUT_MS + 1);
    const o = await p;
    expect(o?.result.status).toBe("failed");
    expect(o?.result.error).toBe("The screening service timed out.");
  });

  it("a missing provider is failed, not clear", async () => {
    m.factoryThrows = true;
    expect((await runScreening(state(), "r"))?.result).toMatchObject({ status: "failed", error: "The screening service is unavailable." });
  });

  it("reuses a conclusive result only for identical inputs within the window", async () => {
    m.impl = async () => ({ hits: [] });
    const now = Date.parse("2026-10-08T00:00:00Z");
    const first = (await runScreening(state(), "r", now))!;
    expect(first.reused).toBe(false);
    const s = { ...state(), screening: first.result };
    expect((await runScreening(s, "r", now + 1000))!.reused).toBe(true);
    expect((await runScreening(s, "r", now + REUSE_MS + 1))!.reused).toBe(false);
    const renamed = { ...s, business: { ...s.business!, legalName: "Other Ltd" } };
    expect((await runScreening(renamed, "r", now + 1000))!.reused).toBe(false);
  });

  it("the request key covers names, entity types, DOB and country", () => {
    const subjects = screeningSubjects(state())!;
    const k = requestKey(subjects, "GB", "furlpay");
    expect(requestKey(subjects, "GB", "furlpay")).toBe(k);
    expect(requestKey(subjects, "FR", "furlpay")).not.toBe(k);
    expect(requestKey(subjects.map((x) => ({ ...x, dateOfBirth: "1990-01-01" })), "GB", "furlpay")).not.toBe(k);
  });
});
