import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { middleware } from "../../middleware";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("FURLPAY_SESSION_SECRET", "test-fixture-session-secret-0123456789abcdef");
});
afterEach(() => vi.unstubAllEnvs());

describe("public stablecoin report", () => {
  it.each([
    "/research",
    "/reports",
    "/research/global-stablecoin-report-2026",
    "/reports/global-stablecoin-report-2026",
    "/reports/global-stablecoin-report-2026.pdf",
  ])("allows an anonymous request to %s", async (path) => {
    const res = await middleware(new NextRequest(`https://furlpay.com${path}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it.each(["/profile", "/cards", "/reports/private-draft", "/research/admin"])(
    "keeps %s behind authentication",
    async (path) => {
      const res = await middleware(new NextRequest(`https://furlpay.com${path}`));
      expect(res.status).toBe(307);
      expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
    },
  );

  it("ships the complete, unmodified PDF approved for public release", () => {
    const pdf = readFileSync(new URL("../../../public/reports/global-stablecoin-report-2026.pdf", import.meta.url));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBe(29_815_276);
    expect(createHash("sha256").update(pdf).digest("hex")).toBe(
      "441219ab3739cabd01bc63a5f6cbc1c5bf0da5bb536b55714f741430e0de2d03",
    );
  });
});
