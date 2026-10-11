// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// The published 2026 report must LINK its public PDF. The preview of PR #93
// rendered "open to read on this page" with no link at all, so the file
// existed at its URL but no reader could find it (FP-REL-01 follow-up).
vi.mock("next/navigation", async (orig) => ({
  ...(await orig<typeof import("next/navigation")>()),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ push() {}, replace() {}, prefetch() {}, back() {}, refresh() {} }),
  usePathname: () => "/reports/global-stablecoin-report-2026",
  useSearchParams: () => new URLSearchParams(),
}));

import ReportPage from "@/app/reports/[slug]/page";

describe("/reports/global-stablecoin-report-2026", () => {
  it("renders read and download links to the verified public PDF", async () => {
    const el = await ReportPage({ params: Promise.resolve({ slug: "global-stablecoin-report-2026" }) });
    const html = renderToStaticMarkup(el);
    const links = [...html.matchAll(/<a[^>]*href="\/reports\/global-stablecoin-report-2026\.pdf"[^>]*>/g)].map((m) => m[0]);
    expect(links.length).toBe(2);
    expect(links.some((a) => / download(=""|\s|>)/.test(a))).toBe(true);
    expect(html).toContain("87-page PDF");
    expect(html).toContain("To be confirmed");
  });

  it("a draft slug is a 404, not a page", async () => {
    await expect(ReportPage({ params: Promise.resolve({ slug: "example-draft-report" }) })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
