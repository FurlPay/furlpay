import { afterEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ impl: (() => new Promise(() => undefined)) as (q: { name: string }) => Promise<{ hits: unknown[] }>, factoryThrows: false }));
vi.mock("@/lib/compliance/providers/factory", () => ({
  getScreeningProvider: async () => {
    if (m.factoryThrows) throw new Error("no provider");
    return { name: "furlpay", screenSanctions: (q: { name: string }) => m.impl(q) };
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

  it("the timeout is one budget for the whole run, not one per name", async () => {
    vi.useFakeTimers();
    expect(screeningSubjects(state())!.length).toBeGreaterThan(1);
    // Each name alone answers inside the timeout; together they do not.
    m.impl = () => new Promise((r) => setTimeout(() => r({ hits: [] }), SCREENING_TIMEOUT_MS * 0.6));
    const p = runScreening(state(), "r");
    await vi.advanceTimersByTimeAsync(SCREENING_TIMEOUT_MS + 1);
    expect((await p)?.result).toMatchObject({ status: "failed", error: "The screening service timed out." });
  });

  it("a fresh run keeps an officer decision only for the exact candidates it reviewed", async () => {
    const hit = { matchScore: 0.91, sources: ["OFAC SDN"] };
    m.impl = async (q) => ({ hits: q.name === "Avery Quinn" ? [hit] : [] });
    const t0 = Date.parse("2026-10-08T00:00:00Z");
    const first = (await runScreening(state(), "r", t0))!.result;
    expect(first.status).toBe("potential_match");
    const review = { by: "officer-1", at: "2026-10-09T09:00:00Z", reason: "Different date of birth" };
    const cleared = { ...first, status: "cleared_by_review" as const, review };
    const later = t0 + REUSE_MS + 1;

    // Expired, so the provider is asked again; same inputs, same candidates → the clearance stands.
    const again = (await runScreening({ ...state(), screening: cleared }, "r", later))!;
    expect(again.reused).toBe(false);
    expect(again.result).toMatchObject({ status: "cleared_by_review", review, screenedAt: new Date(later).toISOString() });

    // A candidate the officer never saw is not covered by that decision.
    m.impl = async () => ({ hits: [hit] });
    expect((await runScreening({ ...state(), screening: cleared }, "r", later))!.result.status).toBe("potential_match");

    // A confirmed match stays confirmed when an officer re-screens the same inputs.
    m.impl = async (q) => ({ hits: q.name === "Avery Quinn" ? [hit] : [] });
    expect((await runScreening({ ...state(), screening: { ...first, status: "confirmed_match" } }, "r", later, { force: true }))!.result.status).toBe("confirmed_match");

    // Changed inputs (new request key) never inherit a decision.
    const renamed = { ...state(), business: { ...state().business!, legalName: "Other Ltd" }, screening: cleared };
    expect((await runScreening(renamed, "r", later))!.result.status).toBe("potential_match");
  });

  it("the request key covers names, entity types, DOB and country", () => {
    const subjects = screeningSubjects(state())!;
    const k = requestKey(subjects, "GB", "furlpay");
    expect(requestKey(subjects, "GB", "furlpay")).toBe(k);
    expect(requestKey(subjects, "FR", "furlpay")).not.toBe(k);
    expect(requestKey(subjects.map((x) => ({ ...x, dateOfBirth: "1990-01-01" })), "GB", "furlpay")).not.toBe(k);
  });
});
