import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validateBody } from "@/lib/validate";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { priceOsmHotel, type HotelSearchContext } from "@/lib/hotels/pricing";
import { duffelMode } from "@/lib/travel/duffel";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// POST /api/travel/hotels/stream-rates — rates for a viewport, streamed.
//
// WHY THIS EXISTS ALONGSIDE /price
// /price is one hotel, one answer: what a hover costs. This is what a VIEWPORT
// costs — the user zoomed into a city and wants to see rates appear on pins
// without clicking each one. Requesting them one at a time means N round trips
// and N spinners; requesting them in one batch means the whole response waits
// on the slowest supplier. Streaming gives the only good shape: each rate is
// sent the moment it resolves, and a hung supplier delays only its own pin.
//
// WHY POST AND NOT GET (the blueprint said GET + EventSource)
// Pricing needs the SUBJECT, not just an id — name, coordinates, city — because
// that is what lib/hotels/match.ts matches against Duffel inventory (see the
// /price route, which takes exactly these fields). Thirty subjects do not fit
// in a query string: browsers and proxies start truncating around 2-8KB and
// the failure is silent. So the client reads this with fetch() + a stream
// reader instead of EventSource. Same wire format, no URL ceiling.
//
// CACHING AND COALESCING ARE NOT REIMPLEMENTED HERE. priceOsmHotel already
// does the Upstash lookup, the 180s write-back, and the in-flight map that
// makes twenty simultaneous askers share one upstream call. Duplicating any of
// that here would create a second cache that disagrees with the first.
// ---------------------------------------------------------------------------

const SubjectSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  latitude: z.number().gte(-90).lte(90),
  longitude: z.number().gte(-180).lte(180),
  city: z.string().max(120).optional(),
  countryCode: z.string().max(2).optional(),
  brand: z.string().max(120).optional(),
});

const StreamSchema = z.object({
  // 30 is the ceiling the blueprint set and it is a good one: a viewport holds
  // thousands of pins, and pricing every one would be thousands of upstream
  // calls for information nobody looked at. The client sends the pins actually
  // on screen, nearest first.
  hotels: z.array(SubjectSchema).min(1).max(30),
  checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  adults: z.number().int().min(1).max(9).default(2),
  children: z.array(z.number().int().min(0).max(17)).max(9).optional(),
  rooms: z.number().int().min(1).max(9).default(1),
  currency: z.string().length(3).default("USD"),
});

const MAX_STAY_NIGHTS = 99;
const MAX_CHECKIN_DAYS_AHEAD = 330;
const DAY_MS = 86_400_000;

/** Whole-stream deadline. Past this the connection closes with whatever
 *  resolved — a half-priced map beats a spinner that never ends. */
const STREAM_DEADLINE_MS = 10_000;

/** Upstream calls in flight at once. Unbounded parallelism against Duffel gets
 *  the whole deployment rate limited, which costs every user a price. */
const CONCURRENCY = 6;

/** Heartbeat so proxies with an idle timeout do not cut a slow stream. SSE
 *  comments are ignored by every client. */
const HEARTBEAT_MS = 3_000;

export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "travel.hotels.stream-rates", {
    limit: 60,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const parsed = await validateBody(req, StreamSchema);
  if (parsed instanceof NextResponse) return parsed;

  // A well-formed date can still be nonsense; same bounds as /price so the two
  // routes cannot disagree about what a bookable stay is.
  const inMs = Date.parse(`${parsed.checkIn}T00:00:00Z`);
  const outMs = Date.parse(`${parsed.checkOut}T00:00:00Z`);
  if (!Number.isFinite(inMs) || !Number.isFinite(outMs)) {
    return NextResponse.json({ error: "Invalid dates" }, { status: 400 });
  }
  const nights = Math.round((outMs - inMs) / DAY_MS);
  if (nights < 1 || nights > MAX_STAY_NIGHTS) {
    return NextResponse.json(
      { error: "Invalid stay length", detail: `Stay must be 1-${MAX_STAY_NIGHTS} nights.` },
      { status: 400 }
    );
  }
  if (inMs - Date.now() > MAX_CHECKIN_DAYS_AHEAD * DAY_MS) {
    return NextResponse.json(
      { error: "Check-in too far ahead", detail: `Check-in must be within ${MAX_CHECKIN_DAYS_AHEAD} days.` },
      { status: 400 }
    );
  }

  // Duplicate ids would price the same hotel twice and emit two events for one
  // pin; the client would render whichever arrived last.
  const seen = new Set<string>();
  const hotels = parsed.hotels.filter((h) => (seen.has(h.id) ? false : (seen.add(h.id), true)));

  const ctx: HotelSearchContext = {
    checkIn: parsed.checkIn,
    checkOut: parsed.checkOut,
    // validateBody surfaces the schema's INPUT type, where a field carrying a
    // .default() is still optional — so the defaults are restated here rather
    // than assumed. They must match the schema above.
    adults: parsed.adults ?? 2,
    children: parsed.children ?? [],
    rooms: parsed.rooms ?? 1,
    currency: parsed.currency ?? "USD",
  };

  const mode = duffelMode();
  const encoder = new TextEncoder();
  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();

  let closed = false;
  async function send(event: string, data: unknown): Promise<void> {
    if (closed) return;
    try {
      await writer.write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
    } catch {
      // The client hung up mid-write. Not an error worth logging per hotel —
      // closing a map tab is the normal way this stream ends.
      closed = true;
    }
  }

  const heartbeat = setInterval(() => {
    if (closed) return;
    writer.write(encoder.encode(`: ping\n\n`)).catch(() => {
      closed = true;
    });
  }, HEARTBEAT_MS);

  // Kicked off without awaiting: the Response must be returned NOW so the
  // client starts reading, and the work continues writing into the stream.
  void (async () => {
    const started = Date.now();
    let resolved = 0;
    let deadlineHit = false;

    try {
      await send("open", { total: hotels.length, duffelMode: mode });

      let cursor = 0;
      async function worker(): Promise<void> {
        for (;;) {
          if (closed || deadlineHit) return;
          // Checked before CLAIMING work, not only after finishing it —
          // otherwise a worker picks up one more hotel at 9.9s and the stream
          // runs well past its budget.
          if (Date.now() - started > STREAM_DEADLINE_MS) {
            deadlineHit = true;
            return;
          }
          const i = cursor++;
          if (i >= hotels.length) return;
          const h = hotels[i];

          try {
            const price = await priceOsmHotel(
              {
                id: h.id,
                name: h.name,
                latitude: h.latitude,
                longitude: h.longitude,
                city: h.city,
                countryCode: h.countryCode,
                brand: h.brand,
              },
              ctx
            );
            resolved += 1;
            // The STATE goes over the wire, never a bare number. "no rate" and
            // "not looked up" are different facts and a map that renders both
            // as blank teaches users a hotel has no price when it has one.
            await send("rate", { hotelId: h.id, ...price, duffelMode: mode });
          } catch (e) {
            // One supplier failing must not end the stream for 29 other pins.
            await send("rate", {
              hotelId: h.id,
              state: "error",
              fetchedAt: new Date().toISOString(),
              duffelMode: mode,
            });
            log.warn("stream-rates: hotel price failed", { hotelId: h.id, error: (e as Error).message });
          }
        }
      }

      // RACE THE POOL AGAINST A REAL TIMER, don't just gate the loop.
      //
      // Gating alone is not enough and the difference is the whole feature: if
      // every worker is already awaiting a supplier that never answers, none
      // of them reaches the gate, Promise.all never settles, and the stream
      // hangs open forever — precisely the failure the deadline exists to
      // prevent. Racing means the deadline fires regardless of what the
      // workers are blocked on.
      //
      // The abandoned workers are harmless: `closed` stops them writing, and
      // priceOsmHotel owns its own in-flight bookkeeping, so a late resolution
      // still populates the cache for the next asker.
      let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<void>((resolve) => {
        deadlineTimer = setTimeout(() => {
          deadlineHit = true;
          resolve();
        }, STREAM_DEADLINE_MS);
      });

      const pool = Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, hotels.length) }, worker)
      ).then(() => {
        if (deadlineTimer) clearTimeout(deadlineTimer);
      });

      await Promise.race([pool, deadline]);

      await send("done", {
        total: hotels.length,
        resolved,
        // Said explicitly so the client can decide whether to re-ask for the
        // stragglers rather than assuming they have no rate.
        truncated: deadlineHit,
        elapsedMs: Date.now() - started,
      });
    } catch (e) {
      log.error("stream-rates stream failed", { error: (e as Error).message });
    } finally {
      clearInterval(heartbeat);
      closed = true;
      await writer.close().catch(() => {});
    }
  })();

  return new Response(stream.readable, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Nginx and some CDNs buffer a streamed response into one chunk, which
      // turns SSE back into a slow single reply. This is the standard opt-out.
      "X-Accel-Buffering": "no",
    },
  });
}
