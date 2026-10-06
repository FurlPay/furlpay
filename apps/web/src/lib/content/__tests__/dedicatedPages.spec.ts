import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEDICATED_REPORT_PAGES } from "../dedicatedPages";
import { generateStaticParams } from "@/app/reports/[slug]/page";

// A report with its own route folder must not also be prerendered by
// /reports/[slug]: in a production build that HTML replaced the dedicated page
// (seen on Vercel; next dev hides it).

const reportsDir = new URL("../../../app/reports/", import.meta.url);
const dedicatedFolders = readdirSync(reportsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith("[") && !d.name.startsWith("("))
  .map((d) => d.name)
  .sort();

describe("dedicated report pages", () => {
  it("the list matches the route folders on disk", () => {
    expect([...DEDICATED_REPORT_PAGES].sort()).toEqual(dedicatedFolders);
  });

  it("/reports/[slug] prerenders none of them", () => {
    const slugs = generateStaticParams().map((p) => p.slug);
    for (const slug of DEDICATED_REPORT_PAGES) expect(slugs).not.toContain(slug);
  });
});
