import { describe, expect, it } from "vitest";
import { DeviceSignalsSchema, TransferSchema } from "@/lib/schemas";

// Audit F-8: deviceSignals was z.record(z.any()) on the transfer route.
const fingerprint = {
  canvasHash: "a1b2c3", webglRenderer: "ANGLE", webglVendor: "Google", webglUnmasked: "x", audioHash: "f00",
  screenWidth: 1440, screenHeight: 900, colorDepth: 24, pixelRatio: 2, touchPoints: 0, cpuCores: 8, deviceMemory: 8,
  userAgent: "Mozilla/5.0", platform: "MacIntel", language: "en-GB", languages: ["en-GB", "en"], timezone: "Europe/London",
  timezoneOffset: 0, visitorId: "v_123", automation: false, vpn: false,
  behavior: { sessionMs: 5400, clickCount: 3, isLikelyAgent: false, signals: ["paste"], agentScore: 0.1 },
};

describe("deviceSignals is bounded (F-8)", () => {
  it("accepts what the fingerprint and behaviour collectors actually send", () => {
    expect(DeviceSignalsSchema.safeParse(fingerprint).success).toBe(true);
    expect(DeviceSignalsSchema.safeParse({ note: "rent" }).success).toBe(true);
  });

  it("refuses nesting deeper than the one behaviour object", () => {
    expect(DeviceSignalsSchema.safeParse({ behavior: { inner: { deeper: 1 } } }).success).toBe(false);
    expect(DeviceSignalsSchema.safeParse({ list: [{ a: 1 }] }).success).toBe(false);
  });

  it("refuses oversized strings, long arrays and too many keys", () => {
    expect(DeviceSignalsSchema.safeParse({ ua: "x".repeat(2049) }).success).toBe(false);
    expect(DeviceSignalsSchema.safeParse({ langs: Array(65).fill("en") }).success).toBe(false);
    const wide = Object.fromEntries(Array.from({ length: 97 }, (_, i) => [`k${i}`, 1]));
    expect(DeviceSignalsSchema.safeParse(wide).success).toBe(false);
  });

  it("refuses keys that are not plain identifiers", () => {
    for (const key of ["__proto__", "constructor.prototype", "a b", "1abc", "x".repeat(65)]) {
      expect(DeviceSignalsSchema.safeParse(JSON.parse(`{"${key}": 1}`)).success, key).toBe(false);
    }
  });

  it("refuses non-finite numbers", () => {
    expect(DeviceSignalsSchema.safeParse({ n: Number.POSITIVE_INFINITY }).success).toBe(false);
  });

  it("is the schema the transfer route validates against", () => {
    const base = { destination: "0x" + "1".repeat(40), amount: 5, token: "USDC", chain: "base", signature: "0xsig" };
    expect(TransferSchema.safeParse({ ...base, deviceSignals: fingerprint }).success).toBe(true);
    expect(TransferSchema.safeParse({ ...base, deviceSignals: { a: { b: { c: 1 } } } }).success).toBe(false);
  });
});
