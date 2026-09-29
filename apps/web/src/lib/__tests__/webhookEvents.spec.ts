import { describe, expect, it, vi, beforeEach } from "vitest";

// The durable webhook registry (migration 0022) is the third dedupe layer. These
// tests drive the lib wrapper against a controlled Supabase RPC double, asserting
// the claim/duplicate/mismatch/fail-closed contract the financial webhooks rely
// on. The atomic-race guarantee itself lives in Postgres (INSERT ... ON CONFLICT
// in claim_webhook_event); here we prove the wrapper reports it faithfully.

const h = vi.hoisted(() => ({ rpc: vi.fn(), backend: "supabase" as string }));

vi.mock("../supabase", () => ({
  get supabaseBackend() {
    return h.backend;
  },
  sbRpc: h.rpc,
}));

import {
  claimWebhookEvent,
  markWebhookProcessed,
  markWebhookFailed,
  webhookPayloadHash,
} from "../webhookEvents";

beforeEach(() => {
  h.rpc.mockReset();
  h.backend = "supabase";
});

describe("webhookPayloadHash", () => {
  it("is a stable sha256 hex of the raw body", () => {
    const a = webhookPayloadHash('{"id":"evt_1","amount":50}');
    const b = webhookPayloadHash('{"id":"evt_1","amount":50}');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs when the body differs by a single byte", () => {
    expect(webhookPayloadHash('{"amount":50}')).not.toBe(webhookPayloadHash('{"amount":51}'));
  });
});

describe("claimWebhookEvent", () => {
  it("reports a fresh claim as claimed, not duplicate, no mismatch", async () => {
    h.rpc.mockResolvedValueOnce([
      { claimed: true, duplicate: false, existing_status: "processing", payload_mismatch: false },
    ]);
    const r = await claimWebhookEvent({ provider: "stripe", eventId: "evt_1", payloadHash: "abc" });
    expect(r).toEqual({
      claimed: true,
      duplicate: false,
      existingStatus: "processing",
      payloadMismatch: false,
    });
    expect(h.rpc).toHaveBeenCalledWith("claim_webhook_event", {
      p_provider: "stripe",
      p_provider_event_id: "evt_1",
      p_event_type: null,
      p_payload_hash: "abc",
    });
  });

  it("reports a live redelivery as duplicate and NOT claimed", async () => {
    h.rpc.mockResolvedValueOnce([
      { claimed: false, duplicate: true, existing_status: "processed", payload_mismatch: false },
    ]);
    const r = await claimWebhookEvent({ provider: "stripe", eventId: "evt_1", payloadHash: "abc" });
    expect(r.claimed).toBe(false);
    expect(r.duplicate).toBe(true);
  });

  it("surfaces a same-id-different-body replay as payloadMismatch", async () => {
    h.rpc.mockResolvedValueOnce([
      { claimed: false, duplicate: true, existing_status: "processed", payload_mismatch: true },
    ]);
    const r = await claimWebhookEvent({ provider: "stripe", eventId: "evt_1", payloadHash: "DIFFERENT" });
    expect(r.payloadMismatch).toBe(true);
  });

  it("passes event_type through when provided", async () => {
    h.rpc.mockResolvedValueOnce([
      { claimed: true, duplicate: false, existing_status: "processing", payload_mismatch: false },
    ]);
    await claimWebhookEvent({ provider: "persona", eventId: "e", eventType: "inquiry.completed", payloadHash: "h" });
    expect(h.rpc).toHaveBeenCalledWith(
      "claim_webhook_event",
      expect.objectContaining({ p_event_type: "inquiry.completed" })
    );
  });

  it("FAILS CLOSED when Supabase is not configured (never returns a claim)", async () => {
    h.backend = "memory";
    await expect(
      claimWebhookEvent({ provider: "stripe", eventId: "evt_1", payloadHash: "abc" })
    ).rejects.toThrow(/fail closed|not configured/i);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("FAILS CLOSED when the RPC returns no row (infra fault, not go-ahead)", async () => {
    h.rpc.mockResolvedValueOnce([]);
    await expect(
      claimWebhookEvent({ provider: "stripe", eventId: "evt_1", payloadHash: "abc" })
    ).rejects.toThrow(/no row/i);
  });
});

describe("mark* helpers", () => {
  it("markWebhookProcessed calls the right RPC", async () => {
    h.rpc.mockResolvedValueOnce(undefined);
    await markWebhookProcessed("stripe", "evt_1");
    expect(h.rpc).toHaveBeenCalledWith("mark_webhook_processed", {
      p_provider: "stripe",
      p_provider_event_id: "evt_1",
    });
  });

  it("markWebhookFailed forwards a sanitized error", async () => {
    h.rpc.mockResolvedValueOnce(undefined);
    await markWebhookFailed("stripe", "evt_1", "boom");
    expect(h.rpc).toHaveBeenCalledWith("mark_webhook_failed", {
      p_provider: "stripe",
      p_provider_event_id: "evt_1",
      p_error: "boom",
    });
  });

  it("mark helpers also fail closed without Supabase", async () => {
    h.backend = "memory";
    await expect(markWebhookProcessed("stripe", "evt_1")).rejects.toThrow(/fail closed|not configured/i);
  });
});
