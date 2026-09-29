import type { Report, Webinar } from "./types";

// ---------------------------------------------------------------------------
// The content.
//
// ── EVERY RECORD BELOW IS A DRAFT, ON PURPOSE ──────────────────────────────
//
// FurlPay has not published a webinar or a research report. There is no
// recorded session, no research team output, no PDF, and no measured statistic
// to report. So there is no published content here, and the public pages render
// their empty states.
//
// The two records are DRAFT FIXTURES. They exist so the listing grid, the
// detail route, the filter, the speaker card, the key-finding list and the
// download gate can all be exercised by tests against realistic shapes. They
// are invisible to the site: `publishedReports()` / `publishedWebinars()`
// filter on status, and every public page calls only those.
//
// The fixtures deliberately describe themselves as fixtures. They do not name
// a real person, quote a number nobody measured, or claim a finding. Writing a
// plausible-looking "Stablecoin Payments 2026" with invented percentages would
// put fabricated research on a page headed FURLPAY RESEARCH — which is the one
// thing a research portal must never do, and is far worse than an empty state.
//
// ── TO PUBLISH ─────────────────────────────────────────────────────────────
//
//   1. Replace a fixture (or add a record) with real content.
//   2. Set `status: "published"`.
//   3. Add the cover/thumbnail under public/content/ and set its real pixel
//      dimensions.
//   4. For a gated PDF, drop the file in public/reports/ and set `pdfPath`.
//
// Nothing else changes: the listing, detail route, sitemap, SEO and lead
// capture all read from here.
// ---------------------------------------------------------------------------

export const WEBINARS: Webinar[] = [
  {
    slug: "example-draft-webinar",
    status: "draft", // ← never rendered publicly
    sessionStatus: "upcoming",
    title: "Example draft webinar (not published)",
    description:
      "A fixture used to exercise the webinar listing, detail page and registration form. It is not a real FurlPay session and is not visible on the site.",
    category: "Stablecoins",
    tags: ["fixture"],
    startsAt: "2026-12-01T15:00:00+00:00",
    duration: "45 min",
    speakers: [
      {
        id: "furlpay-team",
        name: "FurlPay team",
        title: "Placeholder speaker",
        company: "FurlPay",
        bio: "Replace with a real speaker before publishing.",
      },
    ],
    topics: ["Placeholder topic"],
    agenda: [{ time: "00:00", item: "Placeholder agenda item" }],
    relatedReports: ["example-draft-report"],
  },
];

export const REPORTS: Report[] = [
  {
    slug: "example-draft-report",
    status: "draft", // ← never rendered publicly
    title: "Example draft report (not published)",
    subtitle: "A fixture, not FurlPay research",
    description:
      "A fixture used to exercise the report listing, detail layout, key-finding list and download gate. It contains no research and is not visible on the site.",
    category: "Stablecoins",
    tags: ["fixture"],
    publishedAt: "2026-09-27",
    authors: ["FurlPay"],
    readingTime: "1 min",
    // No pdfPath: nothing to download, so the UI offers "Read online".
    gated: true,
    executiveSummary:
      "This record exists to validate the report layout. Replace it with real research before setting status to published.",
    keyFindings: [
      {
        title: "Placeholder finding",
        detail:
          "Key findings are data-driven and rendered from this array. No finding here is a FurlPay research conclusion.",
      },
    ],
    body: [
      { kind: "heading", text: "Placeholder section" },
      {
        kind: "paragraph",
        text: "Report bodies are structured blocks rather than an HTML string, so headings, lists, tables, quotes and callouts each render through a reviewed component.",
      },
      { kind: "list", items: ["Structured", "Typed", "Reviewable"] },
    ],
    methodology:
      "Replace with a real methodology statement. A research report without one is an opinion piece.",
    relatedWebinars: ["example-draft-webinar"],
  },
];
