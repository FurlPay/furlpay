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
    "/reports/global-stablecoin-report-2026-lite.pdf",
  ])("allows an anonymous request to %s", async (path) => {
    const res = await middleware(new NextRequest(`https://furlpay.com${path}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it.each(["/profile", "/cards", "/reports/private-draft", "/research/admin", "/reports/global-stablecoin-report-2026-lite.pdf.bak", "/reports/other-report-lite.pdf"])(
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
    expect(pdf.length).toBe(16_353_216);
    expect(createHash("sha256").update(pdf).digest("hex")).toBe(
      "1597d0542661896dd561a8588e8d5d71012b09486d3f5b6aeedd9bc8e2fb401d",
    );
  });

  it("ships the validated lite PDF: same report, images downsampled, nothing else changed", () => {
    // Built by downsampling images to 150 DPI at their displayed size with
    // transparency masks preserved; validated page-by-page against the full
    // PDF (identical text on all 87 pages, 88/88 soft masks, no darkened
    // regions). Any replacement must be re-validated and this pin updated.
    const pdf = readFileSync(new URL("../../../public/reports/global-stablecoin-report-2026-lite.pdf", import.meta.url));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBe(5_876_092);
    expect(createHash("sha256").update(pdf).digest("hex")).toBe(
      "4b2f55cd47cdd4e870f4881048a994ecc16216c8bbbfc10274ad788685af8f42",
    );
  });
});
