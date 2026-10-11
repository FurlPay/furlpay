import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The route with the durable store and the record RPC replaced by in-memory
// stand-ins. Asserts what reaches storage — and that nothing but the BVNK
// record RPC ever does (no ledger, no balance, no payment call).
const h = vi.hoisted(() => ({
  claims: new Map<string, { status: string; hash: string }>(),
  rpc: vi.fn(),
  storeDown: false,
}));
vi.mock("@/lib/supabase", () => ({ supabaseBackend: "supabase", sbRpc: h.rpc, sbSelect: vi.fn(), sbUpdate: vi.fn() }));
const alerts = vi.hoisted(() => ({ raise: vi.fn(async () => undefined) }));
vi.mock("@/lib/ops/financialAlerts", () => ({ raiseFinancialAlert: alerts.raise }));
vi.mock("@/lib/webhookEvents", async (orig) => {
  const real = await orig<typeof import("@/lib/webhookEvents")>();
  return {
    ...real,
    claimWebhookEvent: vi.fn(async ({ provider, eventId, payloadHash }: { provider: string; eventId: string; payloadHash: string }) => {
      if (h.storeDown) throw new Error("store unavailable");
      const key = `${provider}:${eventId}`;
      const prev = h.claims.get(key);
      if (!prev) { h.claims.set(key, { status: "processing", hash: payloadHash }); return { claimed: true, duplicate: false, existingStatus: "processing", payloadMismatch: false }; }
      if (prev.hash !== payloadHash) return { claimed: false, duplicate: true, existingStatus: prev.status, payloadMismatch: true };
      if (prev.status === "failed") { prev.status = "processing"; return { claimed: true, duplicate: false, existingStatus: "failed", payloadMismatch: false }; }
      return { claimed: false, duplicate: true, existingStatus: prev.status, payloadMismatch: false };
    }),
    markWebhookProcessed: vi.fn(async (p: string, id: string) => { h.claims.get(`${p}:${id}`)!.status = "processed"; }),
    markWebhookFailed: vi.fn(async (p: string, id: string) => { h.claims.get(`${p}:${id}`)!.status = "failed"; }),
  };
});

import { POST } from "../route";

const SECRET = "test-webhook-secret-0123456789abcdef";
const fixture = (name: string) => readFileSync(join(__dirname, "../../../../../lib/bvnk/__tests__/fixtures", `${name}.json`), "utf8").trim();
// Documentation examples carry fixed past timestamps; re-date them to now.
const fresh = (name: string, over: Record<string, unknown> = {}) => JSON.stringify({ ...JSON.parse(fixture(name)), timestamp: new Date().toISOString(), ...over });
const sign = (raw: string, secret = SECRET) => createHmac("sha256", Buffer.from(secret, "utf8")).update(raw, "utf8").digest("base64");
const post = (raw: string, signature: string | null = sign(raw)) =>
  POST(new NextRequest("https://furlpay.com/api/webhooks/bvnk", { method: "POST", body: raw, headers: { "content-type": "application/json", ...(signature ? { "x-signature": signature } : {}) } }));

beforeEach(() => {
  process.env.BVNK_WEBHOOK_SECRET = SECRET;
  h.claims.clear();
  h.storeDown = false;
  h.rpc.mockReset().mockResolvedValue("inserted");
  alerts.raise.mockClear();
});

describe("POST /api/webhooks/bvnk", () => {
  it("fails closed (503) with no secret configured, before reading anything", async () => {
    delete process.env.BVNK_WEBHOOK_SECRET;
    expect((await post(fresh("payment-payin-status-change-v-2"))).status).toBe(503);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("rejects a missing or wrong signature with 401 (not retried by BVNK) and stores nothing", async () => {
    const raw = fresh("payment-payin-status-change-v-2");
    expect((await post(raw, null)).status).toBe(401);
    expect((await post(raw, sign(raw, "another-secret-0123456789abcdef"))).status).toBe(401);
    expect((await post(raw.replace("COMPLETED", "COMPLETEd"), sign(raw))).status).toBe(401);
    expect(h.claims.size).toBe(0);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("records a verified pay-in through bvnk_record_upsert and nothing else", async () => {
    const res = await post(fresh("payment-payin-status-change-v-2"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, outcome: "recorded" });
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc.mock.calls[0][0]).toBe("bvnk_record_upsert");
    expect(h.rpc.mock.calls[0][1].p).toMatchObject({ kind: "payin", status: "COMPLETED", source: "webhook" });
  });

  it("processes a redelivered event once (same eventId)", async () => {
    const raw = fresh("payment-transfer-status-change-v-3");
    await post(raw);
    const again = await post(raw);
    expect(again.status).toBe(200);
    expect((await again.json()).outcome).toBe("duplicate");
    expect(h.rpc).toHaveBeenCalledTimes(1);
  });

  it("handles concurrent duplicate deliveries: one record call", async () => {
    const raw = fresh("payment-payout-status-change-v-2");
    const results = await Promise.all(Array.from({ length: 6 }, () => post(raw)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(h.rpc).toHaveBeenCalledTimes(1);
  });

  it("refuses a reused eventId carrying a different signed body (409), without recording it", async () => {
    const a = fresh("payment-payout-status-change-v-2");
    await post(a);
    const b = JSON.stringify({ ...JSON.parse(a), data: { ...JSON.parse(a).data, status: "COMPLETED" } });
    expect((await post(b)).status).toBe(409);
    expect(h.rpc).toHaveBeenCalledTimes(1);
  });

  it("answers 503 when the durable store is down, so BVNK retries, and records nothing", async () => {
    h.storeDown = true;
    expect((await post(fresh("payment-payin-status-change-v-2"))).status).toBe(503);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("releases a failed processing attempt so BVNK's retry is processed", async () => {
    const raw = fresh("payment-payin-status-change-v-2");
    h.rpc.mockRejectedValueOnce(new Error("rpc timeout"));
    expect((await post(raw)).status).toBe(503);
    expect((await post(raw)).status).toBe(200);
    expect(h.rpc).toHaveBeenCalledTimes(2);
  });

  it("acknowledges a stale (out-of-order) report without changing state", async () => {
    h.rpc.mockResolvedValueOnce("stale");
    const res = await post(fresh("payment-payout-status-change-v-2"));
    expect(res.status).toBe(200);
    expect((await res.json()).outcome).toBe("stale");
  });

  it("acknowledges a report that contradicts a final status (recorded as an exception) and alerts", async () => {
    h.rpc.mockResolvedValueOnce("conflict");
    const res = await post(fresh("payment-transfer-status-change-v-3"));
    expect(res.status).toBe(200);
    expect((await res.json()).outcome).toBe("conflict");
    expect(alerts.raise).toHaveBeenCalledWith("bvnk_provider_discrepancy", expect.objectContaining({ kind: "transfer", source: "webhook" }));
  });

  it("alerts on a reused eventId with a different body (possible forgery)", async () => {
    const a = fresh("payment-payout-status-change-v-2");
    await post(a);
    await post(JSON.stringify({ ...JSON.parse(a), data: { ...JSON.parse(a).data, status: "FAILED" } }));
    expect(alerts.raise).toHaveBeenCalledWith("webhook_payload_mismatch", expect.objectContaining({ provider: "bvnk" }));
  });

  it("refuses with 422 (not retried) a signed event that is stale, off-contract or has a bad amount", async () => {
    const stale = fresh("payment-payin-status-change-v-2", { timestamp: "2020-01-01T00:00:00Z" });
    expect((await post(stale)).status).toBe(422);
    const offContract = fresh("payment-transfer-status-change-v-3").replace('"COMPLETED"', '"SETTLED"');
    expect((await post(offContract)).status).toBe(422);
    const p = JSON.parse(fresh("payment-payin-status-change-v-2"));
    p.data.beneficiary.amount = -5;
    expect((await post(JSON.stringify(p))).status).toBe(422);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("records the delivery of an event it has no contract for, with no state change", async () => {
    const raw = JSON.stringify({ event: "bvnk:ledger:report:ready", eventId: "0198a8bb-7d56-79ef-92b2-2aed247c21b4", timestamp: new Date().toISOString(), data: { status: "READY" } });
    const res = await post(raw);
    expect(res.status).toBe(200);
    expect((await res.json()).outcome).toBe("unhandled");
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("refuses an oversized body with 413", async () => {
    const big = JSON.stringify({ event: "x", eventId: "y", timestamp: new Date().toISOString(), data: { pad: "x".repeat(300 * 1024) } });
    expect((await post(big)).status).toBe(413);
  });
});
