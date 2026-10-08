import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac, randomBytes } from "crypto";

const db = vi.hoisted(() => ({
  endpoints: new Map<string, { merchant_id: string; url: string; secret_enc: string; secret_last4: string }>(),
  claim: [] as unknown[],
  updates: [] as { query: string; patch: Record<string, unknown> }[],
}));
vi.mock("@/lib/supabase", () => ({
  supabaseBackend: "supabase",
  sbRpc: vi.fn(async () => db.claim),
  sbSelect: vi.fn(async (_t: string, q: string) => {
    const id = decodeURIComponent(/merchant_id=eq\.([^&]+)/.exec(q)![1]);
    return db.endpoints.has(id) ? [db.endpoints.get(id)] : [];
  }),
  sbUpsert: vi.fn(async (_t: string, row: { merchant_id: string; url: string; secret_enc: string; secret_last4: string }) => (db.endpoints.set(row.merchant_id, row), [row])),
  sbUpdate: vi.fn(async (_t: string, query: string, patch: Record<string, unknown>) => (db.updates.push({ query, patch }), [])),
  sbDelete: vi.fn(async () => undefined),
  sbSelectOne: vi.fn(),
}));
vi.mock("@/lib/property/safeFetch", () => ({
  checkUrl: vi.fn(async (raw: string) => (/127\.0\.0\.1|localhost|10\.0\./.test(raw) ? { ok: false, reason: "private_address" } : { ok: true, address: "93.184.216.34" })),
  pinnedFetch: vi.fn(),
}));

import { openSealedWebhookSecret, sealWebhookSecret } from "@/lib/ramp/partnerConfig";
import { BACKOFF_S, deliverDue, MAX_ATTEMPTS, redeliver, setEndpoint } from "../webhooks";

const M = "6f1c2a7e-0000-4000-8000-000000000001";
const row = (attempts = 1) => ({ id: "0b8d6c1e-0000-4000-8000-0000000000aa", merchant_id: M, intent_id: "x", type: "payment.succeeded", payload: { id: "pi_1", net_units: "992500000" }, created_at: "2026-10-09T00:00:00Z", attempts });

beforeEach(() => {
  process.env.FURLPAY_PARTNER_WEBHOOK_KEY = randomBytes(32).toString("base64");
  db.endpoints.clear();
  db.updates.length = 0;
  db.claim = [];
});
afterEach(() => vi.clearAllMocks());

describe("merchant webhook endpoints", () => {
  it("issues a secret once, stores it only sealed, and refuses http or private URLs", async () => {
    const r = await setEndpoint(M, "https://hooks.example.com/furlpay");
    if ("refused" in r) throw new Error(r.refused);
    expect(r.secret).toMatch(/^whsec_/);
    const stored = db.endpoints.get(M)!;
    expect(stored.secret_enc.startsWith("v1:")).toBe(true);
    expect(stored.secret_enc).not.toContain(r.secret);
    expect(openSealedWebhookSecret(stored.secret_enc, `merchant:${M}`)).toBe(r.secret);
    expect(await setEndpoint(M, "http://hooks.example.com")).toMatchObject({ refused: expect.stringContaining("https") });
    expect(await setEndpoint(M, "https://127.0.0.1/hook")).toMatchObject({ refused: expect.stringContaining("private") });
  });

  it("a sealed secret cannot be opened under another owner's label", () => {
    const sealed = sealWebhookSecret("whsec_abc", `merchant:${M}`);
    expect(() => openSealedWebhookSecret(sealed, "merchant:someone-else")).toThrow();
    expect(() => openSealedWebhookSecret(sealed, M)).toThrow(); // a partner id label
  });
});

describe("outbox delivery", () => {
  it("signs t.body with the merchant's secret and marks the event delivered", async () => {
    const r = await setEndpoint(M, "https://hooks.example.com/furlpay");
    if ("refused" in r) throw new Error(r.refused);
    db.claim = [row()];
    const sent: { headers: Record<string, string>; body: string }[] = [];
    const transport = vi.fn(async (_u: URL, _a: string, o: { headers: Record<string, string>; body?: string }) => (sent.push({ headers: o.headers, body: o.body! }), new Response("ok", { status: 200 })));
    const now = () => Date.parse("2026-10-09T00:00:10Z");
    const out = await deliverDue(20, transport as never, now);
    expect(out).toEqual([{ id: row().id, delivered: true }]);
    const { headers, body } = sent[0];
    expect(headers["x-furlpay-event-id"]).toBe(row().id);
    const [, t, v1] = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(headers["x-furlpay-signature"])!;
    expect(v1).toBe(createHmac("sha256", r.secret).update(`${t}.${body}`).digest("hex"));
    expect(JSON.parse(body)).toMatchObject({ id: row().id, type: "payment.succeeded", data: { net_units: "992500000" } });
    expect(db.updates[0]).toMatchObject({ query: expect.stringContaining("delivered_at=is.null"), patch: { delivered_at: expect.any(String) } });
  });

  it("a failed delivery is rescheduled on the backoff, never marked delivered", async () => {
    await setEndpoint(M, "https://hooks.example.com/furlpay");
    db.claim = [row(2)];
    const transport = vi.fn(async () => new Response("down", { status: 503 }));
    const t0 = Date.parse("2026-10-09T00:00:00Z");
    const out = await deliverDue(20, transport as never, () => t0);
    expect(out[0]).toMatchObject({ delivered: false, reason: "http_503" });
    expect(db.updates[0].patch).toMatchObject({ last_error: "http_503", next_attempt_at: new Date(t0 + BACKOFF_S[1] * 1000).toISOString() });
    expect(db.updates[0].patch).not.toHaveProperty("delivered_at");
  });

  it("an event for a merchant without an endpoint is not sent anywhere", async () => {
    db.claim = [row()];
    const transport = vi.fn();
    const out = await deliverDue(20, transport as never);
    expect(out[0]).toMatchObject({ delivered: false, reason: "no_endpoint" });
    expect(transport).not.toHaveBeenCalled();
  });
});

describe("redelivery", () => {
  it("re-queues only this merchant's own exhausted, undelivered event", async () => {
    await redeliver(M, row().id);
    const { query, patch } = db.updates[0];
    expect(query).toContain(`merchant_id=eq.${M}`);
    expect(query).toContain(`id=eq.${row().id}`);
    expect(query).toContain("delivered_at=is.null");
    expect(query).toContain(`attempts=gte.${MAX_ATTEMPTS}`);
    expect(patch).toMatchObject({ attempts: 0, last_error: null });
  });
});
