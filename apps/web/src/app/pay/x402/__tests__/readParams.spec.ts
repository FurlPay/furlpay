import { describe, expect, it } from "vitest";
import { readParams } from "../X402Checkout";

describe("/pay/x402 link parsing", () => {
  it("reads resource and origin from the extension's link", () => {
    expect(readParams(new URLSearchParams("resource=https%3A%2F%2Fapi.example.com%2Fr&origin=https%3A%2F%2Fexample.com"))).toEqual({ resource: "https://api.example.com/r", origin: "https://example.com" });
  });
  it("reads the legacy /developer?x402=<encoded params> form", () => {
    const legacy = new URLSearchParams({ x402: new URLSearchParams({ resource: "https://api.example.com/r", origin: "https://example.com" }).toString() });
    expect(readParams(legacy)).toEqual({ resource: "https://api.example.com/r", origin: "https://example.com" });
  });
  it("never reads an amount or recipient from the link", () => {
    const r = readParams(new URLSearchParams("resource=https%3A%2F%2Fa.example%2Fr&amount=1&payTo=0x1"));
    expect(Object.keys(r).sort()).toEqual(["origin", "resource"]);
  });
});
