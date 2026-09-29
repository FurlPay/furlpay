import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  EVENTS,
  eventJsonLd,
  eventStatus,
  featuredEvent,
  formatDateRange,
  formatLocation,
  getEvent,
  participationLabel,
  pastEvents,
  statusLabel,
  upcomingEvents,
  type FurlpayEvent,
} from "../events";

// ---------------------------------------------------------------------------
// The events hub.
//
// Two classes of test here, and the second is the reason this file exists.
//
// The ordinary half checks the date/sorting/formatting logic. The important
// half is a set of invariants about what the events surface is ALLOWED TO SAY
// and allowed to contain:
//
//   1. An attendee ticket may only produce an "attending" claim. Saying
//      "sponsor", "official partner", "exhibiting" or "speaking" about someone
//      else's event on the strength of a free General ticket is a false
//      statement about a third party, visible to that third party.
//
//   2. Registration confirmations carry private data — order numbers, the
//      registered email, attendee promo codes, personalised links. The events
//      surface is a public bundle. None of it may leak in, and a grep over the
//      real files on disk is the only check that actually holds: a reviewer
//      pasting an order number into a summary string would pass every
//      type-level test in this file.
//
// Both are regression tests as much as policy: the page this replaced shipped
// two 404 links, two placeholder CTAs and finished events labelled "Upcoming".
// ---------------------------------------------------------------------------

const AT = (iso: string) => new Date(`${iso}T12:00:00Z`);

const TOKEN2049 = "token2049-singapore-2026";

/**
 * Fixtures for shapes production data does not currently contain.
 *
 * EVENTS holds exactly one event, so single-day handling, venue-less
 * locations, online events and hosted events have no real record to exercise.
 * They are still supported shapes, so they are tested against fixtures rather
 * than left uncovered — the alternative is keeping events on the live site
 * purely so a test has something to read.
 */
function fixture(over: Partial<FurlpayEvent> = {}): FurlpayEvent {
  return {
    slug: "fixture-event",
    name: "Fixture Event",
    city: "Lisbon",
    startDate: "2026-05-04",
    endDate: "2026-05-06",
    category: "Conference",
    participation: "attending",
    summary: "A fixture.",
    ...over,
  };
}

describe("event data integrity", () => {
  it("has unique slugs", () => {
    const slugs = EVENTS.map((e) => e.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("uses URL-safe slugs", () => {
    for (const e of EVENTS) {
      expect(e.slug, e.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });

  it("has ISO dates that do not run backwards", () => {
    for (const e of EVENTS) {
      expect(e.startDate, e.slug).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.endDate, e.slug).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.endDate >= e.startDate, `${e.slug}: endDate before startDate`).toBe(true);
    }
  });

  it("gives next/image the real pixel dimensions whenever art is set", () => {
    // Without both, next/image either throws or ships a layout shift.
    for (const e of EVENTS.filter((x) => x.image)) {
      expect(e.imageWidth, e.slug).toBeTypeOf("number");
      expect(e.imageHeight, e.slug).toBeTypeOf("number");
      expect(e.imageWidth!, e.slug).toBeGreaterThan(0);
      expect(e.imageHeight!, e.slug).toBeGreaterThan(0);
    }
  });

  it("points every image at a file that exists in public/", () => {
    for (const e of EVENTS.filter((x) => x.image)) {
      const onDisk = join(process.cwd(), "public", e.image!.replace(/^\//, ""));
      expect(statSync(onDisk).isFile(), `${e.slug}: missing ${e.image}`).toBe(true);
    }
  });

  it("has at most one featured event", () => {
    expect(EVENTS.filter((e) => e.featured).length).toBeLessThanOrEqual(1);
  });

  it("lists TOKEN2049 and nothing else", () => {
    expect(EVENTS.map((e) => e.slug)).toEqual([TOKEN2049]);
  });

  it("no longer carries the four retired events", () => {
    // Removed on 2026-09-27: their participation claims (exhibiting, hosting,
    // speaking) were never evidenced. These slugs 404 by design — none of them
    // ever resolved in production either, so no working URL was broken.
    for (const slug of [
      "money2020-middle-east",
      "tokyo-payfi-roadshow",
      "london-founder-house",
      "rwa-week-stablecoin-velocity-travel",
    ]) {
      expect(getEvent(slug), slug).toBeUndefined();
    }
  });

  it("returns undefined for an unknown slug", () => {
    expect(getEvent("not-a-real-event")).toBeUndefined();
  });
});

describe("official links", () => {
  it("uses https and never a bare aggregator or social placeholder", () => {
    // The page this replaced sent people to `https://linkedin.com` and
    // `https://youtube.com` as if they were event registration links.
    const placeholders = [
      "https://linkedin.com",
      "https://linkedin.com/",
      "https://youtube.com",
      "https://youtube.com/",
      "https://example.com",
      "#",
    ];
    for (const e of EVENTS.filter((x) => x.officialUrl)) {
      const url = e.officialUrl!;
      expect(url, e.slug).toMatch(/^https:\/\//);
      expect(placeholders, e.slug).not.toContain(url);
      // A real event link has a path or a subdomain doing work, not just a TLD.
      expect(new URL(url).hostname.split(".").length, e.slug).toBeGreaterThanOrEqual(2);
    }
  });

  it("sends TOKEN2049 to the organiser's own site", () => {
    const url = new URL(getEvent(TOKEN2049)!.officialUrl!);
    expect(url.hostname.endsWith("token2049.com")).toBe(true);
    expect(url.pathname).toBe("/singapore");
  });
});

// ---------------------------------------------------------------------------
// The honesty rule
// ---------------------------------------------------------------------------

describe("participation claims", () => {
  it("records TOKEN2049 as attending and nothing stronger", () => {
    // The evidence is a free General attendee ticket. That is the whole claim.
    expect(getEvent(TOKEN2049)!.participation).toBe("attending");
  });

  it("never renders a sponsor or partner claim for an event we only attend", () => {
    const forbidden = /sponsor|official partner|partnered with|exhibit|speaking|keynote|host/i;
    for (const e of EVENTS.filter((x) => x.participation === "attending")) {
      expect(participationLabel(e, AT("2026-01-01")), e.slug).not.toMatch(forbidden);
      expect(participationLabel(e, AT("2030-01-01")), e.slug).not.toMatch(forbidden);
      for (const text of [e.summary, ...(e.body ?? []), ...(e.topics ?? [])]) {
        expect(text, `${e.slug}: "${text}"`).not.toMatch(forbidden);
      }
    }
  });

  it("speaks in the past tense once an event has finished", () => {
    const t = getEvent(TOKEN2049)!;
    expect(participationLabel(t, AT("2026-09-01"))).toBe("FurlPay is attending");
    expect(participationLabel(t, AT("2026-10-20"))).toBe("FurlPay attended");
  });

  it("has no event left whose participation claim is unevidenced", () => {
    // A ratchet. Every published event must have a participation level someone
    // can point at a document for. The four that could not were removed rather
    // than published with a softer label.
    expect(EVENTS.filter((e) => e.unverifiedParticipation).map((e) => e.slug)).toEqual([]);
  });});

describe("no private registration data reaches the bundle", () => {
  // Scan the real files, not the objects: a leak would arrive as a hard-coded
  // string in a page or a summary, which no type-level assertion would catch.
  const roots = [
    join(process.cwd(), "src", "lib", "events"),
    join(process.cwd(), "src", "app", "events"),
    join(process.cwd(), "src", "components", "events"),
  ];

  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out.push(...walk(full));
      else if (/\.tsx?$/.test(entry) && !entry.includes(".spec.")) out.push(full);
    }
    return out;
  }

  const files = roots.flatMap(walk);

  it("scans a non-trivial number of files", () => {
    // Guards the guard: a bad path would make every check below vacuous.
    expect(files.length).toBeGreaterThanOrEqual(4);
  });

  it.each([
    ["an order number", /\b7338232\d{2}\b/],
    ["any 9-digit order-like number", /\border\s*#?\s*\d{6,}/i],
    ["the registered founder email", /founder@furlpay\.com/i],
    ["an attendee promo code", /MEETME\d+/],
    ["a ticket/registration identifier", /\b(ticket|registration)[-_ ]?(id|code|no|number)\b/i],
  ])("contains no %s", (_label, pattern) => {
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      expect(pattern.test(src), `${file} matched ${pattern}`).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Derived status
// ---------------------------------------------------------------------------

describe("eventStatus", () => {
  const t = getEvent(TOKEN2049)!; // 2026-10-07 .. 2026-10-08

  it("is upcoming before the first day", () => {
    expect(eventStatus(t, AT("2026-09-27"))).toBe("upcoming");
    expect(eventStatus(t, AT("2026-10-06"))).toBe("upcoming");
  });

  it("is happening on both boundary days", () => {
    expect(eventStatus(t, AT("2026-10-07"))).toBe("happening");
    expect(eventStatus(t, AT("2026-10-08"))).toBe("happening");
  });

  it("is past from the day after", () => {
    expect(eventStatus(t, AT("2026-10-09"))).toBe("past");
  });

  it("treats a single-day event as one happening day", () => {
    const oneDay = fixture({ startDate: "2026-07-28", endDate: "2026-07-28" });
    expect(eventStatus(oneDay, AT("2026-07-27"))).toBe("upcoming");
    expect(eventStatus(oneDay, AT("2026-07-28"))).toBe("happening");
    expect(eventStatus(oneDay, AT("2026-07-29"))).toBe("past");
  });

  it("labels each status for display", () => {
    expect(statusLabel("upcoming")).toBe("Upcoming");
    expect(statusLabel("happening")).toBe("Happening now");
    expect(statusLabel("past")).toBe("Past");
  });
});

describe("grouping and ordering", () => {
  it("puts the soonest upcoming event first", () => {
    const list = upcomingEvents(AT("2026-01-01"));
    const dates = list.map((e) => e.startDate);
    expect([...dates]).toEqual([...dates].sort());
  });

  it("puts the most recent past event first", () => {
    const list = pastEvents(AT("2027-01-01"));
    const dates = list.map((e) => e.startDate);
    expect([...dates]).toEqual([...dates].sort().reverse());
  });

  it("partitions every event into exactly one group", () => {
    const now = AT("2026-09-27");
    const up = upcomingEvents(now).map((e) => e.slug);
    const done = pastEvents(now).map((e) => e.slug);
    expect(up.length + done.length).toBe(EVENTS.length);
    expect(up.filter((s) => done.includes(s))).toEqual([]);
  });

  it("counts a happening event as upcoming, not past", () => {
    // Someone reading the page on the day of the event needs it above the fold.
    const during = AT("2026-10-07");
    expect(upcomingEvents(during).map((e) => e.slug)).toContain(TOKEN2049);
    expect(pastEvents(during).map((e) => e.slug)).not.toContain(TOKEN2049);
  });
});

describe("featuredEvent", () => {
  it("leads with the flagged event while it is still ahead", () => {
    expect(featuredEvent(AT("2026-09-27"))?.slug).toBe(TOKEN2049);
  });

  it("never returns a finished event", () => {
    // This is the bug the old page had: a stale hero for a conference that
    // ended months earlier.
    const after = AT("2030-01-01");
    expect(featuredEvent(after)).toBeUndefined();
    expect(upcomingEvents(after)).toEqual([]);
  });

  it("falls through to the soonest upcoming event when nothing is flagged", () => {
    const later = fixture({ slug: "later", startDate: "2026-11-01", endDate: "2026-11-02" });
    const sooner = fixture({ slug: "sooner", startDate: "2026-10-01", endDate: "2026-10-02" });
    expect(featuredEvent(AT("2026-09-01"), [later, sooner])?.slug).toBe("sooner");
  });

  it("prefers the flagged event over an earlier unflagged one", () => {
    const sooner = fixture({ slug: "sooner", startDate: "2026-10-01", endDate: "2026-10-02" });
    const flagged = fixture({
      slug: "flagged",
      startDate: "2026-11-01",
      endDate: "2026-11-02",
      featured: true,
    });
    expect(featuredEvent(AT("2026-09-01"), [sooner, flagged])?.slug).toBe("flagged");
  });
});

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

describe("formatDateRange", () => {
  it("collapses a range inside one month", () => {
    expect(formatDateRange("2026-10-07", "2026-10-08")).toBe("7-8 October 2026");
  });

  it("renders a single day once", () => {
    expect(formatDateRange("2026-07-28", "2026-07-28")).toBe("28 July 2026");
  });

  it("keeps both months when a range crosses one", () => {
    expect(formatDateRange("2026-09-30", "2026-10-02")).toBe("30 September - 2 October 2026");
  });

  it("keeps both years when a range crosses one", () => {
    expect(formatDateRange("2026-12-30", "2027-01-02")).toBe(
      "30 December 2026 - 2 January 2027",
    );
  });

  it("does not shift the day across a timezone boundary", () => {
    // Parsed by hand rather than through Date, so a UTC-negative test runner
    // cannot turn the 7th into the 6th.
    expect(formatDateRange("2026-01-01", "2026-01-01")).toBe("1 January 2026");
  });
});

describe("formatLocation", () => {
  it("includes the venue when there is one", () => {
    expect(formatLocation(getEvent(TOKEN2049)!)).toBe("Marina Bay Sands, Singapore");
  });

  it("falls back to the city alone", () => {
    expect(formatLocation(fixture({ city: "Riyadh, Saudi Arabia" }))).toBe("Riyadh, Saudi Arabia");
  });
});

// ---------------------------------------------------------------------------
// Structured data
// ---------------------------------------------------------------------------

describe("eventJsonLd", () => {
  const site = "https://furlpay.com";

  it("describes FurlPay as an attendee, never the organiser or a sponsor", () => {
    const ld = eventJsonLd(getEvent(TOKEN2049)!, site) as Record<string, unknown>;
    expect(ld["@type"]).toBe("Event");
    expect(ld.attendee).toMatchObject({ name: "FurlPay" });
    expect(ld.organizer).toBeUndefined();
    expect(ld.sponsor).toBeUndefined();
    expect(JSON.stringify(ld)).not.toMatch(/sponsor/i);
  });

  it("names FurlPay as organiser only for events we host", () => {
    const ld = eventJsonLd(fixture({ participation: "hosting" }), site) as Record<string, unknown>;
    expect(ld.organizer).toMatchObject({ name: "FurlPay" });
    expect(ld.attendee).toBeUndefined();
  });

  it("carries the dates, place and an absolute image URL", () => {
    const ld = eventJsonLd(getEvent(TOKEN2049)!, site) as Record<string, unknown>;
    expect(ld.startDate).toBe("2026-10-07");
    expect(ld.endDate).toBe("2026-10-08");
    expect(ld.location).toMatchObject({ "@type": "Place", name: "Marina Bay Sands" });
    expect(ld.image).toBe(`${site}/events/token2049-singapore-2026.avif`);
    expect(ld.eventAttendanceMode).toBe("https://schema.org/OfflineEventAttendanceMode");
  });

  it("marks an online event as a virtual location", () => {
    const ld = eventJsonLd(fixture({ city: "Online" }), site) as Record<string, unknown>;
    expect(ld.eventAttendanceMode).toBe("https://schema.org/OnlineEventAttendanceMode");
    expect(ld.location).toMatchObject({ "@type": "VirtualLocation" });
  });
});
