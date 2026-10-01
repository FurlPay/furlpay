import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAlertTransport } from "../alertSink";
import { FINANCIAL_ALERTS, buildFinancialAlert, raiseFinancialAlert, scrubAlertContext } from "../financialAlerts";

// T-O1 (audit P1-10): a fault reaches the alert sink, signed, routed, and with
// nothing sensitive in it.

const sent: { headers: Record<string, string>; body: Record<string, unknown> }[] = [];

beforeEach(() => {
  sent.length = 0;
  process.env.FURLPAY_ALERT_WEBHOOK = "https://alerts.example.com/hook";
  process.env.FURLPAY_ALERT_WEBHOOK_SECRET = "s".repeat(32);
  setAlertTransport(async (_url, init) => {
    sent.push({ headers: init.headers, body: JSON.parse(init.body) });
    return { status: 200 };
  });
});
afterEach(() => {
  setAlertTransport(null);
  delete process.env.FURLPAY_ALERT_WEBHOOK;
  delete process.env.FURLPAY_ALERT_WEBHOOK_SECRET;
});

describe("scrubAlertContext", () => {
  it("drops secret-bearing keys, masks emails and raw key material, truncates", () => {
    const out = scrubAlertContext({
      provider: "stripe",
      eventId: "evt_1",
      webhookSecret: "whsec_live_abc",
      authorization: "Bearer x",
      mnemonic: "abandon abandon",
      email: "alice.smith@example.com",
      note: "sig 0x" + "ab".repeat(65),
      long: "x".repeat(500),
    });
    expect(out).not.toHaveProperty("webhookSecret");
    expect(out).not.toHaveProperty("authorization");
    expect(out).not.toHaveProperty("mnemonic");
    expect(out.email).toBe("a***@example.com");
    expect(out.note).toBe("sig 0x[redacted]");
    expect(out.long.length).toBeLessThanOrEqual(201);
  });
});

describe("fault injection → delivered alert", () => {
  it.each([
    ["webhook_ack_failed", { provider: "stripe", eventId: "evt_9" }],
    ["account_flush_failed", { userId: "u_1" }],
    ["financial_effect_failed", { op: "credit", userId: "u_1", effectKey: "stripe:pi:pi_1" }],
    ["webhook_payload_mismatch", { provider: "stripe", eventId: "evt_10" }],
    ["admin_action", { userId: "u_admin", method: "POST", path: "/api/admin/x" }],
  ] as const)("%s is delivered, signed, with its routing class", async (kind, ctx) => {
    const outcome = await raiseFinancialAlert(kind, ctx);
    expect(outcome).toMatchObject({ delivered: true });
    expect(sent).toHaveLength(1);
    expect(sent[0].headers["x-furlpay-signature"]).toMatch(/^[0-9a-f]{64}$|^sha256=/);
    expect(String(sent[0].body.detail)).toContain(`[${FINANCIAL_ALERTS[kind].route}]`);
    expect(sent[0].body.kind).toBe(`financial.${kind}`);
  });

  it("one incident pages once (same kind + context in the same minute)", async () => {
    await raiseFinancialAlert("ledger_imbalance", { diffCents: 12 });
    await raiseFinancialAlert("ledger_imbalance", { diffCents: 12 });
    expect(sent).toHaveLength(1);
  });

  it("the id is stable for the same incident and different for different ones", () => {
    const now = new Date("2026-09-30T12:00:30Z");
    expect(buildFinancialAlert("rpc_failure", { chain: "base" }, now).id).toBe(buildFinancialAlert("rpc_failure", { chain: "base" }, now).id);
    expect(buildFinancialAlert("rpc_failure", { chain: "base" }, now).id).not.toBe(buildFinancialAlert("rpc_failure", { chain: "arb" }, now).id);
  });

  it("never throws into the caller, even when delivery blows up", async () => {
    setAlertTransport(async () => {
      throw new Error("network down");
    });
    await expect(raiseFinancialAlert("rpc_failure", { chain: "base" })).resolves.toBeDefined();
  });
});

describe("wiring: the durable webhook ack failure raises the page", () => {
  it("withDurableWebhook raises webhook_ack_failed when the ack fails after success", async () => {
    vi.resetModules();
    const raised: string[] = [];
    vi.doMock("../financialAlerts", () => ({ raiseFinancialAlert: (k: string) => (raised.push(k), Promise.resolve(undefined)) }));
    vi.doMock("../../supabase", () => ({ supabaseBackend: "supabase", sbRpc: async () => undefined }));
    vi.doMock("../../webhookEvents", () => ({
      webhookPayloadHash: () => "h",
      claimWebhookEvent: async () => ({ claimed: true, duplicate: false, existingStatus: "processing", payloadMismatch: false }),
      markWebhookProcessed: async () => {
        throw new Error("504");
      },
      markWebhookFailed: async () => undefined,
    }));
    const { withDurableWebhook } = await import("../../withDurableWebhook");
    const r = await withDurableWebhook({
      provider: "stripe",
      eventId: "evt_x",
      rawBody: "{}",
      handler: async () => "ok",
      onDuplicate: () => "dup",
      onMismatch: () => "mm",
      onUnavailable: () => "down",
    });
    expect(r).toBe("ok");
    expect(raised).toEqual(["webhook_ack_failed"]);
  });
});
