import * as fs from "fs";
import * as path from "path";
import { ApiError } from "../api";
import { parseRampAmount, quoteSourceLabel, rampErrorMessage } from "../ramp";

describe("parseRampAmount", () => {
  it.each([
    ["50", 50],
    ["1,250.50", 1250.5],
    ["1", 1],
    ["50000", 50000],
  ])("accepts %j", (text, n) => expect(parseRampAmount(text)).toBe(n));

  it.each(["", "0", "0.5", "50000.01", "1e3", "-5", "12.345", "abc"])("rejects %j", (text) => {
    expect(parseRampAmount(text)).toBeNull();
  });
});

describe("quoteSourceLabel", () => {
  it("names Coinbase for a real quote", () => {
    expect(quoteSourceLabel({ source: "coinbase", company: "Coinbase" })).toMatch(/^Quote from Coinbase/);
  });
  it("never lets a demo estimate read as a price", () => {
    expect(quoteSourceLabel({ source: "demo_schedule" })).toMatch(/not a real price/);
  });
});

describe("rampErrorMessage", () => {
  const err = (status: number, data: object) => new ApiError(status, "x", data);

  it("maps server codes, not server prose", () => {
    expect(rampErrorMessage(err(503, { error: "not_available" }))).toBe("Buying crypto isn't available yet.");
    expect(rampErrorMessage(err(503, { error: "not_available" }), "sell")).toBe("Selling crypto isn't available yet.");
    expect(rampErrorMessage(err(502, { error: "provider_error" }))).toMatch(/Nothing was charged/);
  });

  it("explains step-up instead of pretending it passed", () => {
    expect(rampErrorMessage(err(401, { stepUpRequired: true }))).toMatch(/extra security check/);
  });

  it("an unknown failure is never phrased as success", () => {
    const msg = rampErrorMessage(err(500, {}));
    expect(msg).toMatch(/went wrong/);
    expect(rampErrorMessage(new Error("offline"))).toMatch(/Couldn't reach FurlPay/);
  });
});

describe("ramp screen honesty", () => {
  const src = fs
    .readFileSync(path.join(__dirname, "..", "..", "app", "ramp.tsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("attributes the checkout to the real provider, not an internal name", () => {
    expect(src).toMatch(/processed by Coinbase/);
    expect(src).not.toMatch(/FurlGateway|furlgateway/);
  });

  it("makes no fee or speed promise the server cannot back", () => {
    expect(src).not.toMatch(/0% fee|zero fee|instant(ly)? deliver|guaranteed/i);
  });

  it("gates money movement on device-owner authentication and opens the system browser", () => {
    expect(src).toMatch(/authenticateDeviceOwner\(/);
    expect(src).toMatch(/WebBrowser\.openBrowserAsync\(/);
    expect(src).not.toMatch(/<WebView/);
  });
});
