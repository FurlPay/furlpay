import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isTrustedCheckoutUrl, parseRampAmount, quoteSourceLabel, rampErrorMessage } from "../ramp";

describe("isTrustedCheckoutUrl — the background opens only Coinbase's checkout", () => {
  it.each([
    "https://pay.coinbase.com/buy/select-asset?sessionToken=abc",
    "https://pay.coinbase.com/v3/sell/input?sessionToken=abc",
  ])("opens %s", (u) => expect(isTrustedCheckoutUrl(u)).toBe(true));

  it.each([
    "http://pay.coinbase.com/buy",
    "https://pay.coinbase.com.evil.example/buy",
    "https://evil.example/?u=https://pay.coinbase.com",
    "https://user:pw@pay.coinbase.com/buy",
    "javascript:alert(1)",
    "not a url",
  ])("refuses %s", (u) => expect(isTrustedCheckoutUrl(u)).toBe(false));
});

describe("amounts and labels", () => {
  it("bounds the amount", () => {
    expect(parseRampAmount("50")).toBe(50);
    expect(parseRampAmount("0.5")).toBeNull();
    expect(parseRampAmount("50001")).toBeNull();
  });

  it("labels a demo estimate as not a price", () => {
    expect(quoteSourceLabel({ source: "demo_schedule" })).toMatch(/not a real price/);
    expect(quoteSourceLabel({ source: "coinbase" })).toMatch(/^Quote from Coinbase/);
  });

  it("maps codes, and step-up policy prose, to actionable text", () => {
    expect(rampErrorMessage("not_available", "sell")).toBe("Selling crypto isn't available yet.");
    expect(rampErrorMessage("Amount >= $5000 requires step-up MFA", "buy")).toMatch(/extra security check/);
    expect(rampErrorMessage("untrusted_checkout_url", "buy")).toMatch(/not opened/);
    expect(rampErrorMessage("anything else", "buy")).toMatch(/Nothing was charged/);
  });
});

describe("RampPanel honesty", () => {
  const src = readFileSync(join(__dirname, "..", "..", "entrypoints", "popup", "components", "RampPanel.tsx"), "utf8");

  it("names the real provider and never frames the checkout", () => {
    expect(src).toMatch(/processed by Coinbase/);
    expect(src).not.toMatch(/<iframe|FurlGateway|furlgateway/);
  });

  it("makes no fee or speed promise", () => {
    expect(src).not.toMatch(/0% fee|zero fee|instant(ly)? deliver|guaranteed/i);
  });
});
