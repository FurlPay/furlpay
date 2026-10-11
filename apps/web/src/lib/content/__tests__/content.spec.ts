import { describe, it, expect, beforeEach } from "vitest";
import {
  activeCategories,
  CONTENT_CATEGORIES,
  featuredReport,
  featuredWebinar,
  formatDate,
  getPublishedReport,
  getPublishedWebinar,
  isPubliclyVisible,
  publishedReports,
  publishedWebinars,
  REPORTS,
  reportCta,
  reportSummary,
  resolveRelatedReports,
  resolveRelatedWebinars,
  searchReports,
  searchWebinars,
  WEBINARS,
  webinarCta,
  webinarSummary,
  type Report,
  type Webinar,
} from "..";
import { classifyEmail, leadCaptureSchema } from "@/lib/leads/types";
import { __resetLeadMemory, findLead, listInteractions, recordInteraction, upsertLead } from "@/lib/leads/store";

// ---------------------------------------------------------------------------
// The content platform and its lead capture.
//
// The invariants that matter, in order of blast radius:
//
//   1. A DRAFT IS NEVER PUBLIC. Not in a listing, not at its URL, not in the
//      sitemap, not through a related-content link. FurlPay has published no
//      research yet, so a leak here would put fixture text on a page headed
//      FURLPAY RESEARCH.
//   2. NO FABRICATED AFFORDANCE. No "Download" over a report with no PDF, no
//      "Watch" over a webinar with no recording.
//   3. CONSENT IS NEVER INFERRED. Marketing opt-in defaults false and is not
//      implied by the required transactional consent.
//   4. ONE PERSON, MANY INTERACTIONS. Repeat downloads update one contact.
// ---------------------------------------------------------------------------

function report(over: Partial<Report> = {}): Report {
  return {
    slug: "r1",
    status: "published",
    title: "R1",
    description: "d",
    category: "Stablecoins",
    publishedAt: "2026-01-01",
    ...over,
  };
}

function webinar(over: Partial<Webinar> = {}): Webinar {
  return {
    slug: "w1",
    status: "published",
    sessionStatus: "upcoming",
    title: "W1",
    description: "d",
    category: "Payments",
    speakers: [],
    ...over,
  };
}

describe("drafts never reach the public surface", () => {
  // Exactly one item is published: the 2026 stablecoin report (founder
  // decision, 2026-10-03, matching production). Everything else stays behind
  // the filter, and these tests use a GENUINE draft, never index [0].
  const draftReport = REPORTS.find((r) => !isPubliclyVisible(r))!;
  const draftWebinar = WEBINARS.find((w) => !isPubliclyVisible(w))!;

  it("publishes exactly the 2026 stablecoin report and no webinar", () => {
    // If this ever fails, something else was published: check it is real
    // before changing the list.
    expect(publishedReports().map((r) => r.slug)).toEqual(["global-stablecoin-report-2026"]);
    expect(publishedWebinars()).toEqual([]);
  });

  it("still has drafts behind the filter", () => {
    // Guards the guard: without a real draft the assertions below would pass
    // vacuously and prove nothing about filtering.
    expect(draftReport).toBeDefined();
    expect(draftWebinar).toBeDefined();
    expect(REPORTS.filter((r) => isPubliclyVisible(r)).map((r) => r.slug)).toEqual(["global-stablecoin-report-2026"]);
    expect(WEBINARS.every((w) => !isPubliclyVisible(w))).toBe(true);
  });

  it("refuses to resolve a draft by slug", () => {
    // This is what the detail route calls. A draft must 404, not render.
    expect(getPublishedReport(draftReport.slug)).toBeUndefined();
    expect(getPublishedWebinar(draftWebinar.slug)).toBeUndefined();
  });

  it("drops drafts from related content instead of linking to them", () => {
    // A published item may reference a draft; the link must disappear rather
    // than 404 the reader.
    expect(resolveRelatedReports([draftReport.slug])).toEqual([]);
    expect(resolveRelatedWebinars([draftWebinar.slug])).toEqual([]);
  });

  it("drops unknown slugs from related content", () => {
    expect(resolveRelatedReports(["does-not-exist"])).toEqual([]);
    expect(resolveRelatedWebinars(["does-not-exist"])).toEqual([]);
    expect(resolveRelatedReports(undefined)).toEqual([]);
  });

  it("features only published content", () => {
    expect(featuredReport()?.slug).toBe("global-stablecoin-report-2026");
    expect(featuredWebinar()).toBeUndefined();
  });
});

describe("CTAs never promise a file that is not there", () => {
  it("offers Read online when a report has no PDF", () => {
    expect(reportCta(report({ pdfPath: undefined }))).toEqual({
      label: "Read online",
      kind: "read",
    });
  });

  it("offers Download only when a PDF path is recorded", () => {
    expect(reportCta(report({ pdfPath: "/reports/x.pdf" })).kind).toBe("download");
  });

  it("does not offer Watch for an on-demand session with no recording", () => {
    const cta = webinarCta(webinar({ sessionStatus: "on-demand", videoUrl: undefined }));
    expect(cta.kind).toBe("none");
    expect(cta.label).toMatch(/coming soon/i);
  });

  it("offers Watch once a recording exists", () => {
    expect(
      webinarCta(webinar({ sessionStatus: "on-demand", videoUrl: "https://v" })).kind,
    ).toBe("watch");
  });

  it("offers Register for upcoming and live", () => {
    expect(webinarCta(webinar({ sessionStatus: "upcoming" })).kind).toBe("register");
    expect(webinarCta(webinar({ sessionStatus: "live" })).kind).toBe("register");
  });
});

describe("listing behaviour", () => {
  it("sorts reports newest first", () => {
    const list = [report({ slug: "old", publishedAt: "2025-01-01" }), report({ slug: "new", publishedAt: "2026-06-01" })];
    const sorted = [...list].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    expect(sorted.map((r) => r.slug)).toEqual(["new", "old"]);
  });

  it("filters categories to those with content behind them", () => {
    expect(activeCategories([{ category: "Payments" }, { category: "Web3" }])).toEqual([
      "Payments",
      "Web3",
    ]);
  });

  it("keeps the canonical category order rather than insertion order", () => {
    const out = activeCategories([{ category: "Web3" }, { category: "Stablecoins" }]);
    expect(out.indexOf("Stablecoins")).toBeLessThan(out.indexOf("Web3"));
  });

  it("returns nothing for a category with no content", () => {
    expect(activeCategories([])).toEqual([]);
  });

  it("exposes every category the filter can render", () => {
    expect(CONTENT_CATEGORIES).toContain("Stablecoins");
    expect(new Set(CONTENT_CATEGORIES).size).toBe(CONTENT_CATEGORIES.length);
  });
});

describe("search", () => {
  const rs = [
    report({ slug: "a", title: "Stablecoin settlement", tags: ["rails"] }),
    // A different category, so the "STABLECOIN" case below proves a TITLE
    // match rather than accidentally matching this record's category too.
    report({ slug: "b", title: "Card interchange", description: "fees", category: "Payments" }),
  ];

  it("matches the title case-insensitively", () => {
    expect(searchReports("STABLECOIN", rs).map((r) => r.slug)).toEqual(["a"]);
  });

  it("matches tags and description", () => {
    expect(searchReports("rails", rs).map((r) => r.slug)).toEqual(["a"]);
    expect(searchReports("fees", rs).map((r) => r.slug)).toEqual(["b"]);
  });

  it("returns everything for an empty query", () => {
    expect(searchReports("   ", rs)).toHaveLength(2);
  });

  it("searches webinar topics too", () => {
    const ws = [webinar({ slug: "x", topics: ["treasury ops"] })];
    expect(searchWebinars("treasury", ws).map((w) => w.slug)).toEqual(["x"]);
  });
});

describe("summaries feed the shared card", () => {
  it("builds a report summary with a correct href", () => {
    const s = reportSummary(report({ slug: "abc" }));
    expect(s).toMatchObject({ type: "report", href: "/reports/abc", badge: "Report" });
  });

  it("builds a webinar summary carrying its session badge", () => {
    expect(webinarSummary(webinar({ slug: "xyz", sessionStatus: "on-demand" }))).toMatchObject({
      type: "webinar",
      href: "/webinars/xyz",
      badge: "On demand",
    });
  });
});

describe("formatDate", () => {
  it("does not shift the day across a timezone", () => {
    expect(formatDate("2026-01-01")).toBe("1 January 2026");
    expect(formatDate("2026-10-07T15:00:00+00:00")).toBe("7 October 2026");
  });
});

// ---------------------------------------------------------------------------
// Lead capture
// ---------------------------------------------------------------------------

describe("lead validation", () => {
  const valid = {
    firstName: "A",
    lastName: "B",
    email: "a@company.com",
    company: "C",
    jobTitle: "D",
    country: "E",
    consent: true as const,
  };

  it("accepts a complete submission", () => {
    expect(leadCaptureSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a submission without the required consent", () => {
    expect(leadCaptureSchema.safeParse({ ...valid, consent: false }).success).toBe(false);
  });

  it("rejects a malformed email", () => {
    expect(leadCaptureSchema.safeParse({ ...valid, email: "nope" }).success).toBe(false);
  });

  it("normalises the email to lowercase", () => {
    const out = leadCaptureSchema.parse({ ...valid, email: "  Me@Company.COM " });
    expect(out.email).toBe("me@company.com");
  });

  it("treats a missing marketing consent as absent, never true", () => {
    const out = leadCaptureSchema.parse(valid);
    expect(out.marketingConsent).toBeFalsy();
  });
});

describe("business-email classification", () => {
  it("flags well-known consumer providers", () => {
    expect(classifyEmail("a@gmail.com")).toBe("consumer");
    expect(classifyEmail("a@outlook.com")).toBe("consumer");
  });

  it("treats everything else as business", () => {
    expect(classifyEmail("a@stripe.com")).toBe("business");
  });

  it("returns unknown for a malformed address", () => {
    expect(classifyEmail("not-an-email")).toBe("unknown");
    expect(classifyEmail("a@localhost")).toBe("unknown");
  });
});

describe("lead storage", () => {
  beforeEach(() => __resetLeadMemory());

  const base = {
    firstName: "Ada",
    lastName: "L",
    email: "ada@company.com",
    company: "Co",
    jobTitle: "Eng",
    country: "UK",
    consent: true as const,
  };

  it("creates a contact and defaults marketing consent to false", async () => {
    const { lead, created } = await upsertLead(base, "report_download", "1.2.3.4");
    expect(created).toBe(true);
    expect(lead.marketingConsent).toBe(false);
    expect(lead.marketingConsentAt).toBeUndefined();
    expect(lead.consentVersion).toBeTruthy();
  });

  it("deduplicates on the normalised email", async () => {
    await upsertLead(base, "report_download", "1.1.1.1");
    const second = await upsertLead(
      { ...base, email: "  ADA@company.com " },
      "webinar_registration",
      "1.1.1.1",
    );
    expect(second.created).toBe(false);
    // First contact wins on origin — how we met someone is a fact about the past.
    expect(second.lead.firstSource).toBe("report_download");
  });

  it("records a marketing opt-in with its timestamp", async () => {
    const { lead } = await upsertLead({ ...base, marketingConsent: true }, "report_download", "1.1.1.1");
    expect(lead.marketingConsent).toBe(true);
    expect(lead.marketingConsentAt).toBeTruthy();
  });

  it("does not revoke an existing opt-in when a later form omits the box", async () => {
    // Unticking is not the same act as withdrawing. Withdrawal goes through
    // unsubscribe; silently dropping it would lose a real permission.
    await upsertLead({ ...base, marketingConsent: true }, "report_download", "1.1.1.1");
    const { lead } = await upsertLead(base, "report_download", "1.1.1.1");
    expect(lead.marketingConsent).toBe(true);
  });

  it("never infers marketing consent from the required consent", async () => {
    const { lead } = await upsertLead(base, "report_download", "1.1.1.1");
    expect(lead.consent).toBe(true);
    expect(lead.marketingConsent).toBe(false);
  });

  it("keeps three downloads as one contact with three interactions", async () => {
    await upsertLead(base, "report_download", "1.1.1.1");
    for (const slug of ["r1", "r2", "r3"]) {
      await recordInteraction({
        leadEmail: base.email,
        eventType: "report_download",
        contentType: "report",
        contentId: slug,
      });
    }
    expect(await findLead(base.email)).not.toBeNull();
    const interactions = await listInteractions();
    expect(interactions).toHaveLength(3);
    expect(new Set(interactions.map((i) => i.leadEmail)).size).toBe(1);
  });

  it("stores the consent IP as the record of consent", async () => {
    const { lead } = await upsertLead(base, "report_download", "9.9.9.9");
    expect(lead.consentIp).toBe("9.9.9.9");
  });
});
