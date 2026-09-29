import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { EVENTS, formatDateRange, formatLocation, getEvent, participationLabel } from "@/lib/events/events";

export const runtime = "nodejs";

// GET /api/og/event/[slug] — the social card for an event page.
//
// ── WHY GENERATED AND NOT A DESIGNED PNG ───────────────────────────────────
//
// Every event needs a card for X, LinkedIn, iMessage and Slack unfurls, and the
// content of that card is entirely in the event record: name, dates, venue and
// what FurlPay is doing there. Generating it means adding an event to EVENTS
// gets a correct social card for free, and the participation line on the card
// can never drift from the participation line on the page — both call
// `participationLabel()`.
//
// ── WHY NO THIRD-PARTY EVENT LOGO IN HERE ──────────────────────────────────
//
// The page hero shows the official event mark, but this card is FurlPay's own
// artwork. Compositing another company's logo into an image we publish under
// our own domain, at a size and crop we chose, is a different act from showing
// it undistorted on a page that says we are attending. Type only, our palette.
//
// ── SATORI CONSTRAINTS ─────────────────────────────────────────────────────
//
// Satori has no block layout and no CSS grid: every element carries an explicit
// `display: flex`, and spacing is margin/padding rather than `gap` shorthand.
// No external stylesheet and no webfont is loaded here, so the card renders on
// the bundled default face — which is why the type is set in weight and size
// rather than in a brand family it would not have.

const W = 1200;
const H = 630;

const NEON = "#00E599";
const DIM = "#8E8E93";

/** Prerender one card per event at build time. */
export function generateStaticParams() {
  return EVENTS.map((e) => ({ slug: e.slug }));
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  // Public, unauthenticated and expensive: a miss rasterises a 1200x630 image.
  // The middleware baseline only limits mutating methods, so without this a GET
  // can be scraped without bound. Same bucket shape as the sibling OG routes.
  const limited = await rateLimitOr429(req, "og.event", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const { slug } = await ctx.params;
  const event = getEvent(slug);
  if (!event) return new Response("Not found", { status: 404 });

  return new ImageResponse(
    (
      <div
        style={{
          width: W,
          height: H,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#000000",
          padding: "68px 72px",
          // A single soft green wash from the top-left, matching the site hero.
          backgroundImage:
            "radial-gradient(900px circle at 0% 0%, rgba(0,229,153,0.16), transparent 62%)",
        }}
      >
        {/* Top row: wordmark + participation */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <div
              style={{
                display: "flex",
                width: 30,
                height: 30,
                borderRadius: 9,
                background: NEON,
                marginRight: 16,
              }}
            />
            <div style={{ display: "flex", fontSize: 30, fontWeight: 700, color: "#FFFFFF" }}>
              FurlPay
            </div>
          </div>

          <div
            style={{
              display: "flex",
              fontSize: 21,
              fontWeight: 600,
              color: NEON,
              border: `1px solid rgba(0,229,153,0.4)`,
              borderRadius: 999,
              padding: "10px 24px",
              background: "rgba(0,229,153,0.08)",
            }}
          >
            {participationLabel(event)}
          </div>
        </div>

        {/* Event name */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              fontSize: 26,
              fontWeight: 600,
              color: DIM,
              letterSpacing: 2,
              marginBottom: 20,
            }}
          >
            {event.category.toUpperCase()}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: event.name.length > 34 ? 68 : 84,
              fontWeight: 800,
              color: "#FFFFFF",
              lineHeight: 1.05,
              letterSpacing: -2,
              maxWidth: 1000,
            }}
          >
            {event.name}
          </div>
        </div>

        {/* Bottom row: dates + location */}
        <div style={{ display: "flex", alignItems: "center" }}>
          <div
            style={{ display: "flex", fontSize: 30, fontWeight: 700, color: NEON, marginRight: 20 }}
          >
            {formatDateRange(event.startDate, event.endDate)}
          </div>
          <div style={{ display: "flex", fontSize: 30, color: DIM, marginRight: 20 }}>·</div>
          <div style={{ display: "flex", fontSize: 30, color: "#FFFFFF" }}>
            {formatLocation(event)}
          </div>
        </div>
      </div>
    ),
    { width: W, height: H },
  );
}
