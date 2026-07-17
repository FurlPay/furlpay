import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Regression guard for the "Property 'crypto' doesn't exist" device crash.
//
// Hermes has no global crypto; Node and jest-expo both DO, which is why 99
// green unit tests missed a bug that broke every network call on a real phone.
// This test recreates the device condition (no global crypto) and proves the
// polyfill wires expo-crypto's implementations into global.crypto.
//
// expo-crypto is stubbed deterministically — jest-expo's auto-mock returns
// undefined, which would only test the mock, not our wiring.
// ---------------------------------------------------------------------------

jest.mock("expo-crypto", () => ({
  randomUUID: jest.fn(() => "11111111-2222-4333-8444-555555555555"),
  getRandomValues: jest.fn((arr: Uint8Array) => {
    for (let i = 0; i < arr.length; i++) arr[i] = 7;
    return arr;
  }),
}));

describe("crypto polyfill", () => {
  it("installs crypto.randomUUID + getRandomValues when the runtime has none", () => {
    const original = (globalThis as { crypto?: unknown }).crypto;
    try {
      // Reproduce Hermes: no global crypto at all.
      delete (globalThis as { crypto?: unknown }).crypto;
      jest.resetModules();
      require("../cryptoPolyfill");

      const c = (globalThis as unknown as { crypto: Crypto }).crypto;
      expect(typeof c.randomUUID).toBe("function");
      expect(c.randomUUID()).toBe("11111111-2222-4333-8444-555555555555");

      expect(typeof c.getRandomValues).toBe("function");
      const arr = new Uint8Array(16);
      c.getRandomValues(arr);
      expect(Array.from(arr).every((b) => b === 7)).toBe(true);
    } finally {
      (globalThis as { crypto?: unknown }).crypto = original;
    }
  });

  it("does not clobber an existing crypto implementation", () => {
    const original = (globalThis as { crypto?: unknown }).crypto;
    try {
      const sentinel = () => "sentinel-uuid";
      (globalThis as unknown as { crypto: Record<string, unknown> }).crypto = {
        randomUUID: sentinel,
      };
      jest.resetModules();
      require("../cryptoPolyfill");
      // An already-present method is preserved (only missing ones are filled).
      expect((globalThis as unknown as { crypto: { randomUUID: () => string } }).crypto.randomUUID()).toBe(
        "sentinel-uuid"
      );
      // ...and the missing one is added.
      expect(
        typeof (globalThis as unknown as { crypto: { getRandomValues?: unknown } }).crypto.getRandomValues
      ).toBe("function");
    } finally {
      (globalThis as { crypto?: unknown }).crypto = original;
    }
  });

  it("is wired into the entry point BEFORE expo-router/entry", () => {
    // The polyfill only helps if it runs before any app module loads. index.js
    // must import it first; the order is load-bearing, so pin it.
    const entry = fs.readFileSync(path.join(__dirname, "..", "..", "index.js"), "utf8");
    const polyfillIdx = entry.indexOf("cryptoPolyfill");
    const routerIdx = entry.indexOf("expo-router/entry");
    expect(polyfillIdx).toBeGreaterThanOrEqual(0);
    expect(routerIdx).toBeGreaterThan(polyfillIdx);
  });
});
