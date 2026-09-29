// ---------------------------------------------------------------------------
// FurlPay events hub — one typed record per event drives the /events index,
// the per-event page, its schema.org Event JSON-LD, its OG image and the
// sitemap. Adding an event means appending one object to EVENTS; no component
// is touched.
//
// ── HONESTY RULE (read before adding an event) ──────────────────────────────
//
// `participation` states what FurlPay is ACTUALLY doing at an event, and it is
// the only thing the page is allowed to claim. The levels are ordered by how
// much they assert:
//
//   attending   — someone from FurlPay holds a ticket. Nothing more.
//   speaking    — a named FurlPay person is on a published agenda.
//   exhibiting  — FurlPay has a paid booth/stand/pod.
//   hosting     — FurlPay is the organiser of the event itself.
//   sponsoring  — FurlPay has a signed sponsorship with the organiser.
//
// Never upgrade a level without a document that proves it. An attendee ticket
// proves "attending" and NOTHING else — it is not sponsorship, not partnership,
// not an exhibitor stand and not a speaking slot. Claiming otherwise on a
// public page is a lie about another company's event that the organiser can
// see, and it is the kind of thing that ends an exhibitor relationship before
// it starts. `participationLabel()` renders the level, so a card and a page can
// never drift from each other or from the data.
//
// ── NEVER PUT THESE IN THIS FILE ───────────────────────────────────────────
//
// Registration confirmations carry private data: order numbers, the registered
// email address, ticket/QR identifiers, attendee promo codes (they are tied to
// the holder's account) and personalised tracking links. None of it belongs in
// a public bundle. `events.spec.ts` asserts this file stays clean of it.
//
// ── STATUS IS DERIVED, NOT STORED ──────────────────────────────────────────
//
// Status comes from the dates via `eventStatus()`. The previous version of this
// page stored it, and the result was four events sitting under "Upcoming"
// months after they had finished — a stored status is a second source of truth
// that nobody remembers to update. Derived, it cannot go stale.
// ---------------------------------------------------------------------------

/** Where an event sits relative to today. Derived — see `eventStatus()`. */
export type EventStatus = "upcoming" | "happening" | "past";

/** What FurlPay is actually doing at an event. See HONESTY RULE above. */
export type Participation = "attending" | "speaking" | "exhibiting" | "hosting" | "sponsoring";

export interface EventFact {
  label: string;
  /** Organiser-published figures only. Attribute them via `factsSource`. */
  value: string;
}

export interface FurlpayEvent {
  slug: string;
  /** Full event name as the organiser writes it. */
  name: string;
  /** City shown on cards. */
  city: string;
  /** Venue, when the organiser has published one. */
  venue?: string;
  /** ISO yyyy-mm-dd, venue-local. Single-day events repeat the same date. */
  startDate: string;
  endDate: string;
  category: string;
  participation: Participation;
  /**
   * Path under /public. Third-party event logos live in public/events/ (same
   * pattern as public/partners/) and are shown undistorted at their natural
   * aspect ratio — `imageWidth`/`imageHeight` are the file's real pixel
   * dimensions, not a display size. Omit the image and the card/hero fall back
   * to a typographic treatment built from FurlPay's own tokens.
   */
  image?: string;
  imageAlt?: string;
  imageWidth?: number;
  imageHeight?: number;
  /** The organiser's own site. Never a third-party listing/aggregator. */
  officialUrl?: string;
  /** One or two sentences, used on cards and as the meta description. */
  summary: string;
  /** Detail-page paragraphs. Original wording — never pasted from the organiser. */
  body?: string[];
  /** What FurlPay wants to talk about there. */
  topics?: string[];
  /** Organiser-published scale figures, shown as a stat row. */
  facts?: EventFact[];
  /** Who published `facts` — rendered as attribution under the stats. */
  factsSource?: string;
  /** At most one event should be featured at a time. */
  featured?: boolean;
  /**
   * True when this event predates the honesty rule above and its participation
   * level came from marketing copy rather than a document. Renders no
   * differently; it exists so `events.spec.ts` can hold the line on NEW events
   * while the backlog gets confirmed. Remove the flag once verified.
   */
  unverifiedParticipation?: boolean;
}

// ---------------------------------------------------------------------------
// The events.
//
// TOKEN2049 Singapore 2026 is confirmed by an attendee registration in the
// founder's name — hence participation "attending", and deliberately nothing
// stronger. The organiser's own scale figures and the sub-event dates below
// are from token2049.com/singapore; everything describing FurlPay is ours.
//
// It is deliberately the ONLY entry. The old hand-written /events page also
// listed four finished events (Money20/20 Middle East, a Tokyo roadshow, the
// Arbitrum Founder House and an RWA Week webinar), but their participation
// levels — exhibiting, hosting, speaking — came from marketing prose rather
// than from any document, and two of them linked to bare https://linkedin.com
// and https://youtube.com placeholders. Rather than publish unverified claims
// about other people's events, they were dropped on 2026-09-27.
//
// To bring one back: add the object here with the participation level you can
// evidence, and confirm the claim before you raise it above "attending".
// ---------------------------------------------------------------------------

export const EVENTS: FurlpayEvent[] = [
  {
    slug: "token2049-singapore-2026",
    name: "TOKEN2049 Singapore 2026",
    city: "Singapore",
    venue: "Marina Bay Sands",
    startDate: "2026-10-07",
    endDate: "2026-10-08",
    category: "Crypto / Fintech / Payments",
    participation: "attending",
    image: "/events/token2049-singapore-2026.avif",
    imageAlt: "TOKEN2049 Singapore 2026",
    imageWidth: 833,
    imageHeight: 400,
    officialUrl: "https://www.token2049.com/singapore",
    summary:
      "FurlPay is attending TOKEN2049 Singapore on 7-8 October 2026 at Marina Bay Sands, to meet founders, fintechs, financial institutions, stablecoin issuers, investors and developers building global payment infrastructure.",
    body: [
      "TOKEN2049 Singapore is the largest annual gathering in the industry FurlPay builds for. The people who decide how money moves across borders — issuers, institutions, payment processors, infrastructure teams and the developers wiring them together — are in one venue for two days.",
      "We are going as attendees, to have specific conversations rather than to run a stand. If you are working on stablecoin settlement, card issuing, cross-border payouts, tokenised assets or agentic payments, we would rather spend twenty focused minutes with you than hand out a flyer.",
    ],
    topics: [
      "Stablecoin payments and settlement",
      "Cross-border payouts and treasury",
      "Virtual card issuing",
      "Global banking infrastructure",
      "Tokenised assets and RWAs",
      "Travel and hospitality payments",
      "Agentic payments and the x402 standard",
      "Developer APIs and SDKs",
    ],
    facts: [
      { label: "Attendees", value: "25,000+" },
      { label: "Companies", value: "7,000+" },
      { label: "Speakers", value: "300+" },
      { label: "Exhibitors", value: "500+" },
      { label: "C-level", value: "Over 60%" },
      { label: "Countries", value: "160+" },
    ],
    factsSource: "Figures published by the organiser at token2049.com/singapore.",
    featured: true,
  },
];

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

/** ISO yyyy-mm-dd for a Date, in UTC. */
function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Where an event sits relative to `now`, by calendar-date comparison.
 *
 * Deliberately date-only and UTC-based: no timezone database, no per-event
 * offset to keep in sync, and the same answer on the server and in a test. The
 * cost is that around midnight the venue's local date and UTC can disagree by
 * a few hours, which for a status badge is not worth a tz dependency.
 */
export function eventStatus(event: FurlpayEvent, now: Date = new Date()): EventStatus {
  const today = isoDay(now);
  if (today < event.startDate) return "upcoming";
  if (today > event.endDate) return "past";
  return "happening";
}

export function getEvent(slug: string): FurlpayEvent | undefined {
  return EVENTS.find((e) => e.slug === slug);
}

// `events` defaults to EVENTS so call sites stay a one-liner. It is a parameter
// rather than a closed-over constant so the grouping and fallback rules can be
// tested against fixtures — otherwise the only way to cover "what happens with
// two upcoming events" would be to keep a second real event in production data.

/** Soonest first — the next thing on the calendar leads the page. */
export function upcomingEvents(
  now: Date = new Date(),
  events: FurlpayEvent[] = EVENTS,
): FurlpayEvent[] {
  return events
    .filter((e) => eventStatus(e, now) !== "past")
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}

/** Most recent first. */
export function pastEvents(
  now: Date = new Date(),
  events: FurlpayEvent[] = EVENTS,
): FurlpayEvent[] {
  return events
    .filter((e) => eventStatus(e, now) === "past")
    .sort((a, b) => b.startDate.localeCompare(a.startDate));
}

/**
 * The one event the hub leads with: the featured flag, but only while the
 * event is still ahead of us. A featured event that has finished is just a past
 * event, so the hero falls through to the next upcoming one.
 */
export function featuredEvent(
  now: Date = new Date(),
  events: FurlpayEvent[] = EVENTS,
): FurlpayEvent | undefined {
  const live = upcomingEvents(now, events);
  return live.find((e) => e.featured) ?? live[0];
}

// ---------------------------------------------------------------------------
// Presentation helpers — shared so a card, a hero and the JSON-LD cannot drift.
// ---------------------------------------------------------------------------

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Parse yyyy-mm-dd without going through Date (no timezone shift). */
function parts(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}

/**
 * "7-8 October 2026", "28 July 2026", "30 December 2026 - 2 January 2027".
 * Collapses the shared month and year so a two-day event reads as one range.
 */
export function formatDateRange(startDate: string, endDate: string): string {
  const s = parts(startDate);
  const e = parts(endDate);
  const sMonth = MONTHS[s.m - 1];
  const eMonth = MONTHS[e.m - 1];
  if (startDate === endDate) return `${s.d} ${sMonth} ${s.y}`;
  if (s.y !== e.y) return `${s.d} ${sMonth} ${s.y} - ${e.d} ${eMonth} ${e.y}`;
  if (s.m !== e.m) return `${s.d} ${sMonth} - ${e.d} ${eMonth} ${e.y}`;
  return `${s.d}-${e.d} ${sMonth} ${s.y}`;
}

/** Where the event is, as one line. */
export function formatLocation(event: FurlpayEvent): string {
  return event.venue ? `${event.venue}, ${event.city}` : event.city;
}

/**
 * The ONLY place a participation claim is turned into words. Past tense for
 * finished events, so a card cannot say FurlPay "is attending" something that
 * happened last quarter.
 */
export function participationLabel(event: FurlpayEvent, now: Date = new Date()): string {
  const done = eventStatus(event, now) === "past";
  switch (event.participation) {
    case "attending":
      return done ? "FurlPay attended" : "FurlPay is attending";
    case "speaking":
      return done ? "FurlPay spoke" : "FurlPay is speaking";
    case "exhibiting":
      return done ? "FurlPay exhibited" : "FurlPay is exhibiting";
    case "hosting":
      return done ? "Hosted by FurlPay" : "Hosted by FurlPay";
    case "sponsoring":
      return done ? "FurlPay sponsored" : "FurlPay is sponsoring";
  }
}

export function statusLabel(status: EventStatus): string {
  switch (status) {
    case "upcoming":
      return "Upcoming";
    case "happening":
      return "Happening now";
    case "past":
      return "Past";
  }
}

// ---------------------------------------------------------------------------
// schema.org Event
// ---------------------------------------------------------------------------

/**
 * Event JSON-LD for an event page.
 *
 * FurlPay is an `attendee` here, never `organizer` or `sponsor` — the same
 * honesty rule as the visible page, in the structured data a crawler reads.
 * `organizer` is left out entirely rather than guessed: we know FurlPay is not
 * it, and naming the real organiser would be an assumption for most events.
 * Events we host ourselves do name FurlPay as the organiser.
 */
export function eventJsonLd(event: FurlpayEvent, site: string) {
  const url = `${site}/events/${event.slug}`;
  const hosted = event.participation === "hosting";

  return {
    "@context": "https://schema.org",
    "@type": "Event",
    name: event.name,
    startDate: event.startDate,
    endDate: event.endDate,
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode:
      event.city === "Online"
        ? "https://schema.org/OnlineEventAttendanceMode"
        : "https://schema.org/OfflineEventAttendanceMode",
    location:
      event.city === "Online"
        ? { "@type": "VirtualLocation", url: event.officialUrl ?? url }
        : {
            "@type": "Place",
            name: event.venue ?? event.city,
            address: { "@type": "PostalAddress", addressLocality: event.city },
          },
    description: event.summary,
    url: event.officialUrl ?? url,
    ...(event.image ? { image: `${site}${event.image}` } : {}),
    ...(hosted
      ? { organizer: { "@type": "Organization", name: "FurlPay", url: site } }
      : { attendee: { "@type": "Organization", name: "FurlPay", url: site } }),
  };
}
