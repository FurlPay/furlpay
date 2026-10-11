import { describe, expect, it } from "vitest";
import { BodyTooLarge, readBoundedBody } from "../boundedBody";
import { DRAFT_SCHEMAS } from "../onboardingDraft";
import { emptyState, requiredDocumentKinds, resumeStep, screeningIsFresh, stepBlockers, stepStatuses } from "../onboarding";
import { activity, decodeCursor, encodeCursor } from "../overview";
import * as fx from "./fixtures";

describe("audit regressions", () => {
  it("caps chunked bodies without trusting content length", async () => {
    const response = new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(6)); c.enqueue(new Uint8Array(6)); c.close(); } }));
    await expect(readBoundedBody(response, 10)).rejects.toBeInstanceOf(BodyTooLarge);
  });
  it("accepts unfinished forms but rejects arbitrary keys and invalid nested types", () => {
    expect(DRAFT_SCHEMAS.business.safeParse({ legalName: "", address: { city: "" } }).success).toBe(true);
    expect(DRAFT_SCHEMAS.business.safeParse({ legalName: "", security: { totpSecret: "secret" } }).success).toBe(false);
    expect(DRAFT_SCHEMAS.details.safeParse({ owners: "broken" }).success).toBe(false);
  });
  it("rejects stale, invalid and future screening timestamps", () => {
    const now = Date.now();
    const screening = { screenedAt: new Date(now).toISOString(), status: "clear" as const, list: "test", names: 1, matches: [] };
    expect(screeningIsFresh(screening, now)).toBe(true);
    for (const at of ["invalid", new Date(now + 3_600_000).toISOString(), new Date(now - 86_400_000).toISOString()]) {
      expect(screeningIsFresh({ ...screening, screenedAt: at }, now)).toBe(false);
      expect(stepBlockers({ ...emptyState(), screening: { ...screening, screenedAt: at } }, "compliance")).toHaveLength(1);
    }
  });
  it("individual KYC uses the same document requirements and companies cannot select KYC to bypass KYB", () => {
    const s = { ...emptyState(), business: { ...fx.business, type: "individual" as const }, identity: { ...fx.identity, verification: "kyc" as const } };
    expect(requiredDocumentKinds(s)).toEqual(["id_front"]);
    expect(requiredDocumentKinds({ ...s, business: fx.business })).toHaveLength(4);
    expect(stepBlockers({ ...s, business: fx.business }, "identity")[0]).toContain("KYB");
  });
  it("resumes the invalidated identity step and blocks subsequent completed flags", () => {
    const s = { ...emptyState(), completed: ["business", "identity", "details"] as const };
    const state = { ...s, completed: [...s.completed] };
    expect(resumeStep(state)).toBe("identity");
    expect(stepStatuses(state).details).toBe("BLOCKED");
  });
  it("partial activity buckets match totals and exclude future entries", () => {
    const now = Date.parse("2026-10-08T12:30:00Z");
    const tx = (at: number) => ({ id: String(at), timestamp: new Date(at).toISOString(), amountUsd: 10, direction: "in" as const, category: "transfer", status: "settled" });
    const result = activity([tx(now - 86_400_000 + 1), tx(now - 1), tx(now + 1)], "24h", now);
    expect(result.settledUsd).toBe(20);
    expect(result.series.reduce((n, b) => n + b.usd, 0)).toBe(20);
    expect(decodeCursor(encodeCursor({ id: "", ts: "not a date" }))).toBeNull();
  });
});
