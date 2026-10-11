import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ sbSelect: vi.fn(), alerts: [] as { kind: string; severity: string; dimensions?: Record<string, unknown> }[] }));
vi.mock("@/lib/supabase", () => ({ sbSelect: h.sbSelect, sbRpc: vi.fn(), sbUpdate: vi.fn(), sbUpsert: vi.fn(), sbDelete: vi.fn(), supabaseBackend: "supabase" }));
vi.mock("@/lib/alerts", () => ({ raiseAlert: vi.fn(async (a: { kind: string; severity: string }) => { h.alerts.push(a); return {}; }) }));

import { alertWebhookHealth, MAX_ATTEMPTS } from "../webhooks";

// Webhook delivery monitoring: operators hear about exhausted deliveries and a stopped dispatcher.
let exhausted: object[] = [], stalled: object[] = [];
const queries: string[] = [];
beforeEach(() => {
  h.alerts.length = 0; queries.length = 0; exhausted = []; stalled = [];
  h.sbSelect.mockImplementation(async (_t: string, q: string) => { queries.push(q); return q.includes(`attempts=gte.${MAX_ATTEMPTS}`) ? exhausted : stalled; });
});

describe("webhook delivery monitoring", () => {
  it("is quiet when everything is delivered, and never counts merchants without an endpoint", async () => {
    expect(await alertWebhookHealth()).toEqual({ exhaustedMerchants: 0, exhaustedEvents: 0, stalled: false });
    expect(queries[0]).toContain("last_error=neq.no_endpoint");
    expect(h.alerts).toEqual([]);
  });
  it("raises one alert per merchant with exhausted deliveries", async () => {
    exhausted = [{ merchant_id: "m1", last_error: "http_500" }, { merchant_id: "m1", last_error: "http_500" }, { merchant_id: "m2", last_error: "url_refused" }];
    expect(await alertWebhookHealth()).toMatchObject({ exhaustedMerchants: 2, exhaustedEvents: 3 });
    expect(h.alerts.map(a => [a.kind, a.dimensions?.merchant])).toEqual([["merchant.webhook_exhausted", "m1"], ["merchant.webhook_exhausted", "m2"]]);
  });
  it("pages critically when a due event was never claimed (dispatcher stopped)", async () => {
    stalled = [{ id: "e1", next_attempt_at: "2026-10-09T10:00:00Z" }];
    await alertWebhookHealth();
    expect(h.alerts).toEqual([expect.objectContaining({ kind: "merchant.webhook_dispatcher_stalled", severity: "critical" })]);
  });
});
