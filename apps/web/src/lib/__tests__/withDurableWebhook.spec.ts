import { describe, expect, it, vi, beforeEach } from "vitest";

// Drive the reusable durable-webhook wrapper against a controlled webhookEvents
// double, proving the ordering + failure semantics every financial route relies
// on: claim before effect, mark processed only after success, fail closed on a
// store outage, never re-run effects for a duplicate, never process a mismatch.

const m = vi.hoisted(() => ({
  claim: vi.fn(),
  processed: vi.fn(),
  failed: vi.fn(),
  backend: "supabase" as string,
}));

vi.mock("../webhookEvents", () => ({
  webhookPayloadHash: (b: string) => `hash(${b})`,
  claimWebhookEvent: m.claim,
  markWebhookProcessed: m.processed,
  markWebhookFailed: m.failed,
}));
vi.mock("../supabase", () => ({
  get supabaseBackend() {
    return m.backend;
  },
}));
vi.mock("../log", () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { withDurableWebhook } from "../withDurableWebhook";

const base = {
  provider: "stripe",
  eventId: "evt_1",
  rawBody: '{"id":"evt_1"}',
  onDuplicate: (s: string) => ({ kind: "duplicate", s }),
  onMismatch: () => ({ kind: "mismatch" }),
  onUnavailable: () => ({ kind: "unavailable" }),
};

beforeEach(() => {
  m.claim.mockReset();
  m.processed.mockReset().mockResolvedValue(undefined);
  m.failed.mockReset().mockResolvedValue(undefined);
  m.backend = "supabase";
});

describe("withDurableWebhook", () => {
  it("bypasses the durable layer (runs handler) when the store is not provisioned (dev/test)", async () => {
    m.backend = "memory";
    const handler = vi.fn().mockResolvedValue({ kind: "ok" });
    const r = await withDurableWebhook({ ...base, handler });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(m.claim).not.toHaveBeenCalled();
    expect(r).toEqual({ kind: "ok" });
  });

  it("runs the handler once and marks processed on a fresh claim", async () => {
    m.claim.mockResolvedValueOnce({ claimed: true, duplicate: false, existingStatus: "processing", payloadMismatch: false });
    const handler = vi.fn().mockResolvedValue({ kind: "ok" });
    const r = await withDurableWebhook({ ...base, handler });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(m.processed).toHaveBeenCalledWith("stripe", "evt_1");
    expect(r).toEqual({ kind: "ok" });
  });

  it("does NOT run the handler for a duplicate", async () => {
    m.claim.mockResolvedValueOnce({ claimed: false, duplicate: true, existingStatus: "processed", payloadMismatch: false });
    const handler = vi.fn();
    const r = await withDurableWebhook({ ...base, handler });
    expect(handler).not.toHaveBeenCalled();
    expect(m.processed).not.toHaveBeenCalled();
    expect(r).toEqual({ kind: "duplicate", s: "processed" });
  });

  it("does NOT run the handler on payload mismatch (forged replay)", async () => {
    m.claim.mockResolvedValueOnce({ claimed: false, duplicate: true, existingStatus: "processed", payloadMismatch: true });
    const handler = vi.fn();
    const r = await withDurableWebhook({ ...base, handler });
    expect(handler).not.toHaveBeenCalled();
    expect(r).toEqual({ kind: "mismatch" });
  });

  it("FAILS CLOSED without running the handler when the store is unavailable", async () => {
    m.claim.mockRejectedValueOnce(new Error("supabase down"));
    const handler = vi.fn();
    const r = await withDurableWebhook({ ...base, handler });
    expect(handler).not.toHaveBeenCalled();
    expect(m.processed).not.toHaveBeenCalled();
    expect(r).toEqual({ kind: "unavailable" });
  });

  it("marks FAILED and rethrows when the handler throws (retryable)", async () => {
    m.claim.mockResolvedValueOnce({ claimed: true, duplicate: false, existingStatus: "processing", payloadMismatch: false });
    const handler = vi.fn().mockRejectedValue(new Error("effect boom"));
    await expect(withDurableWebhook({ ...base, handler })).rejects.toThrow("effect boom");
    expect(m.failed).toHaveBeenCalledWith("stripe", "evt_1", "effect boom");
    expect(m.processed).not.toHaveBeenCalled();
  });

  it("never marks processed before the handler resolves (ordering)", async () => {
    const order: string[] = [];
    m.claim.mockResolvedValueOnce({ claimed: true, duplicate: false, existingStatus: "processing", payloadMismatch: false });
    m.processed.mockImplementationOnce(async () => { order.push("processed"); });
    const handler = vi.fn().mockImplementation(async () => { order.push("effect"); return { kind: "ok" }; });
    await withDurableWebhook({ ...base, handler });
    expect(order).toEqual(["effect", "processed"]);
  });
});
