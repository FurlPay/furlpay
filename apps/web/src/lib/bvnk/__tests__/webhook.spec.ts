import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BvnkEventInvalid, MAX_EVENT_AGE_MS, parseBvnkEvent, verifyBvnkSignature } from "../webhook";

// The vector published in BVNK's "Configure webhooks" guide
// (docs.bvnk.com/bvnk/get-started/create-webhook-listener), verbatim.
const DOC_SECRET = "JUL5QkQrpZYwW+Kf03QSrb70CG+ea/j8E/JfslENaXhd0AGBDbAtYYP2MdjkYDqiwjBtrtQXsUIbtAf7IGEGfg==";
const DOC_SIGNATURE = "VWEtiJu/7dLrq0ZtXS0HbGDPy6Re86oZeTnEEc9mlxg=";
const DOC_PAYLOAD = '{"event":"bvnk:ledger:report:ready","eventId":"0198a8bb-7d56-79ef-92b2-2aed247c21b4","timestamp":"2025-08-14T13:18:36.374620938Z","data":{"id":"8d942264-e27e-44d9-a048-5ed66ac5129f","url":"https://bvnk-staging-reports.s3.eu-west-1.amazonaws.com/transaction/8d942264-e27e-44d9-a048-5ed66ac5129f_7b2f87b9-1335-4b1e-bbeb-6a59ba1dc6df.csv?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Date=20250814T131836Z&X-Amz-SignedHeaders=host&X-Amz-Credential=AKIAZP6R7NJUFAGFGMNA%2F20250814%2Feu-west-1%2Fs3%2Faws4_request&X-Amz-Expires=604800&X-Amz-Signature=5c861e552b3e253be28f8e02c818b3c5e00269b9b50b6d4957d5281825d31a67","type":"TRANSACTION","status":"READY"}}';

// Example payloads from BVNK's published webhook definitions (api-explorer,
// bvnk-webhooks). They are documentation examples, not captured traffic.
const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", `${name}.json`), "utf8").trim();
const at = (raw: string) => Date.parse(JSON.parse(raw).timestamp) + 1000;

describe("x-signature verification", () => {
  it("accepts BVNK's published vector", () => {
    expect(verifyBvnkSignature(DOC_PAYLOAD, DOC_SIGNATURE, DOC_SECRET)).toBe(true);
  });

  it("rejects a wrong secret, a changed byte, and a re-serialised body", () => {
    expect(verifyBvnkSignature(DOC_PAYLOAD, DOC_SIGNATURE, DOC_SECRET.slice(1))).toBe(false);
    expect(verifyBvnkSignature(DOC_PAYLOAD.replace("READY", "READZ"), DOC_SIGNATURE, DOC_SECRET)).toBe(false);
    // Parsing and re-stringifying changes the bytes (here: whitespace), and the
    // signature is over the bytes — the reason the route keeps the raw body.
    expect(verifyBvnkSignature(JSON.stringify(JSON.parse(DOC_PAYLOAD), null, 1), DOC_SIGNATURE, DOC_SECRET)).toBe(false);
  });

  it("rejects missing, hex, truncated, padded-wrong and oversized signatures before comparing", () => {
    const hex = createHmac("sha256", DOC_SECRET).update(DOC_PAYLOAD).digest("hex");
    for (const bad of [null, "", hex, DOC_SIGNATURE.slice(0, 40), DOC_SIGNATURE.replace("=", ""), DOC_SIGNATURE + "AAAA", ` ${DOC_SIGNATURE}`, "!".repeat(44)]) {
      expect(verifyBvnkSignature(DOC_PAYLOAD, bad, DOC_SECRET), String(bad)).toBe(false);
    }
  });

  it("uses the secret's UTF-8 bytes, not a base64 decode (as BVNK's samples do)", () => {
    const decodedKey = createHmac("sha256", Buffer.from(DOC_SECRET, "base64")).update(DOC_PAYLOAD).digest("base64");
    expect(verifyBvnkSignature(DOC_PAYLOAD, decodedKey, DOC_SECRET)).toBe(false);
  });
});

describe("event contracts", () => {
  it.each([
    ["payment-payin-status-change-v-2", "payin", "COMPLETED"],
    ["payment-payout-status-change-v-2", "payout", "PROCESSING"],
    ["payment-transfer-status-change-v-3", "transfer", "COMPLETED"],
    ["ledger-wallet-status-change-v-2", "wallet", "ACTIVE"],
    ["platform-customer-status-change", "customer", "VERIFIED"],
  ])("parses BVNK's documented %s example", (name, kind, status) => {
    const raw = fixture(name);
    const p = parseBvnkEvent(raw, at(raw));
    expect(p.kind).toBe(kind);
    expect((p.event.data as { status: string }).status).toBe(status);
  });

  it("returns an event type it has no contract for as unhandled, not as an error", () => {
    const p = parseBvnkEvent(DOC_PAYLOAD, Date.parse("2025-08-14T13:18:40Z"));
    expect(p.kind).toBe("unhandled");
  });

  it("refuses a documented event that breaks its contract (unknown status)", () => {
    const raw = fixture("payment-transfer-status-change-v-3").replace('"COMPLETED"', '"SETTLED"');
    expect(() => parseBvnkEvent(raw, at(raw))).toThrow(BvnkEventInvalid);
  });

  it("refuses non-JSON, a missing eventId, a stale event and a future one", () => {
    expect(() => parseBvnkEvent("not json")).toThrow(BvnkEventInvalid);
    const raw = fixture("payment-payout-status-change-v-2");
    const noId = JSON.stringify({ ...JSON.parse(raw), eventId: undefined });
    expect(() => parseBvnkEvent(noId, at(raw))).toThrow(BvnkEventInvalid);
    expect(() => parseBvnkEvent(raw, at(raw) + MAX_EVENT_AGE_MS + 1)).toThrow(/redelivery window/);
    expect(() => parseBvnkEvent(raw, at(raw) - 10 * 60_000)).toThrow(/future/);
  });
});
