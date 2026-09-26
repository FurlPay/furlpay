// POST /api/travel/hotels/stream-rates — viewport rate streaming.
//
// The interesting failures are all about the STREAM rather than the price:
// does one hung supplier stall the other 29, does a deadline close cleanly
// with partial results, and does an error for one hotel still emit an event so
// its pin stops spinning.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const priceOsmHotel = vi.fn();
vi.mock("@/lib/hotels/pricing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/hotels/pricing")>();
  return { ...actual, priceOsmHotel };
});

vi.mock("@/lib/travel/duffel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/travel/duffel")>();
  return { ...actual, duffelMode: () => "test" as const };
});

const { POST } = await import("@/app/api/travel/hotels/stream-rates/route");

function subject(i: number) {
  return {
    id: `fp_${i}`,
    name: `Hotel ${i}`,
    latitude: 1.28 + i / 1000,
    longitude: 103.85 + i / 1000,
    city: "Singapore",
    countryCode: "SG",
  };
}

function body(over: Record<string, unknown> = {}) {
  return {
    hotels: [subject(1), subject(2)],
    checkIn: "2026-12-01",
    checkOut: "2026-12-03",
    adults: 2,
    rooms: 1,
    currency: "USD",
    ...over,
  };
}

function req(payload: unknown, ip = `10.70.0.${Math.floor(Math.random() * 250)}`) {
  return new NextRequest("https://furlpay.com/api/travel/hotels/stream-rates", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(payload),
  });
}

/** Read the whole SSE body and split it into parsed events. */
async function readEvents(res: Response): Promise<Array<{ event: string; data: Record<string, unknown> }>> {
  const text = await res.text();
  const out: Array<{ event: string; data: Record<string, unknown> }> = [];
  for (const block of text.split("\n\n")) {
    const ev = /^event: (.+)$/m.exec(block)?.[1];
    const dt = /^data: (.+)$/m.exec(block)?.[1];
    if (ev && dt) out.push({ event: ev, data: JSON.parse(dt) });
  }
  return out;
}

const OK_PRICE = {
  state: "available" as const,
  totalAmount: 480,
  perNightAmount: 240,
  currency: "USD",
  nights: 2,
  fetchedAt: "2026-09-17T00:00:00.000Z",
};

beforeEach(() => {
  priceOsmHotel.mockReset();
  priceOsmHotel.mockResolvedValue(OK_PRICE);
});

describe("validation", () => {
  it("400s a missing check-in or check-out", async () => {
    expect((await POST(req(body({ checkIn: undefined })))).status).toBe(400);
    expect((await POST(req(body({ checkOut: undefined })))).status).toBe(400);
    expect(priceOsmHotel).not.toHaveBeenCalled();
  });

  it("400s a malformed date", async () => {
    expect((await POST(req(body({ checkIn: "01-12-2026" })))).status).toBe(400);
    expect((await POST(req(body({ checkOut: "2026-13-45" })))).status).toBe(400);
  });

  it("400s more than 30 hotels", async () => {
    const hotels = Array.from({ length: 31 }, (_, i) => subject(i));
    expect((await POST(req(body({ hotels })))).status).toBe(400);
    expect(priceOsmHotel).not.toHaveBeenCalled();
  });

  it("accepts exactly 30", async () => {
    const hotels = Array.from({ length: 30 }, (_, i) => subject(i));
    const res = await POST(req(body({ hotels })));
    expect(res.status).toBe(200);
    await res.text();
  });

  it("400s an empty hotel list", async () => {
    expect((await POST(req(body({ hotels: [] })))).status).toBe(400);
  });

  it("400s a checkout on or before checkin, and an over-long stay", async () => {
    expect((await POST(req(body({ checkIn: "2026-12-03", checkOut: "2026-12-03" })))).status).toBe(400);
    expect((await POST(req(body({ checkIn: "2026-12-03", checkOut: "2026-12-01" })))).status).toBe(400);
    expect((await POST(req(body({ checkIn: "2026-12-01", checkOut: "2027-06-01" })))).status).toBe(400);
  });

  it("400s a check-in beyond the booking horizon", async () => {
    const far = new Date(Date.now() + 400 * 86_400_000).toISOString().slice(0, 10);
    const farOut = new Date(Date.now() + 402 * 86_400_000).toISOString().slice(0, 10);
    expect((await POST(req(body({ checkIn: far, checkOut: farOut })))).status).toBe(400);
  });

  it("rejects out-of-range coordinates in a subject", async () => {
    expect((await POST(req(body({ hotels: [{ ...subject(1), latitude: 99 }] })))).status).toBe(400);
  });
});

describe("SSE wire format", () => {
  it("sets streaming headers and disables proxy buffering", async () => {
    const res = await POST(req(body()));
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("cache-control")).toContain("no-transform");
    // Without this, nginx buffers the stream into one reply and SSE stops
    // being SSE.
    expect(res.headers.get("x-accel-buffering")).toBe("no");
    await res.text();
  });

  it("emits open, one rate per hotel, then done", async () => {
    const events = await readEvents(await POST(req(body())));

    expect(events[0].event).toBe("open");
    expect(events[0].data).toMatchObject({ total: 2 });

    const rates = events.filter((e) => e.event === "rate");
    expect(rates).toHaveLength(2);
    expect(rates[0].data).toMatchObject({ state: "available", totalAmount: 480, currency: "USD" });
    expect(new Set(rates.map((r) => r.data.hotelId))).toEqual(new Set(["fp_1", "fp_2"]));

    const done = events.at(-1);
    expect(done?.event).toBe("done");
    expect(done?.data).toMatchObject({ total: 2, resolved: 2, truncated: false });
  });

  it("carries the server-owned duffelMode on every rate", async () => {
    // The client must never be the thing that decides whether a rate is live.
    const events = await readEvents(await POST(req(body())));
    for (const e of events.filter((x) => x.event === "rate")) {
      expect(e.data.duffelMode).toBe("test");
    }
  });

  it("passes the search context through to the pricer", async () => {
    await readEvents(await POST(req(body({ adults: 3, rooms: 2, currency: "SGD" }))));
    expect(priceOsmHotel).toHaveBeenCalledWith(
      expect.objectContaining({ id: "fp_1", name: "Hotel 1" }),
      expect.objectContaining({ adults: 3, rooms: 2, currency: "SGD", checkIn: "2026-12-01" })
    );
  });
});

describe("resilience", () => {
  it("still emits an event for a hotel whose supplier threw", async () => {
    // A pin with no event spins forever. An error event is what stops it.
    priceOsmHotel.mockImplementation(async (h: { id: string }) => {
      if (h.id === "fp_1") throw new Error("supplier exploded");
      return OK_PRICE;
    });

    const events = await readEvents(await POST(req(body())));
    const rates = events.filter((e) => e.event === "rate");
    expect(rates).toHaveLength(2);

    const failed = rates.find((r) => r.data.hotelId === "fp_1");
    expect(failed?.data.state).toBe("error");
    const ok = rates.find((r) => r.data.hotelId === "fp_2");
    expect(ok?.data.state).toBe("available");

    // One failure must not abort the stream.
    expect(events.at(-1)?.event).toBe("done");
    expect(events.at(-1)?.data).toMatchObject({ resolved: 1 });
  });

  it("does not price the same hotel twice when ids repeat", async () => {
    const dup = [subject(1), subject(1), subject(2)];
    const events = await readEvents(await POST(req(body({ hotels: dup }))));
    expect(priceOsmHotel).toHaveBeenCalledTimes(2);
    expect(events.filter((e) => e.event === "rate")).toHaveLength(2);
  });

  it("closes with partial results instead of hanging past the deadline", async () => {
    // Every supplier hangs. The stream must still terminate with a `done`
    // marked truncated rather than holding the connection open.
    vi.useFakeTimers();
    priceOsmHotel.mockImplementation(() => new Promise(() => {}));

    const resPromise = POST(req(body({ hotels: Array.from({ length: 8 }, (_, i) => subject(i)) })));
    const res = await resPromise;

    // Push past the 10s whole-stream deadline.
    await vi.advanceTimersByTimeAsync(11_000);
    vi.useRealTimers();

    const events = await readEvents(res);
    const done = events.find((e) => e.event === "done");
    expect(done).toBeTruthy();
    expect(done?.data).toMatchObject({ truncated: true, resolved: 0 });
  }, 20_000);
});

describe("rate limiting", () => {
  it("429s once the budget is exhausted", async () => {
    const ip = "10.71.0.4";
    const statuses: number[] = [];
    for (let i = 0; i < 70; i += 1) {
      const res = await POST(req(body(), ip));
      statuses.push(res.status);
      if (res.status === 200) await res.text();
    }
    expect(statuses).toContain(429);
    expect(statuses.slice(0, 60).every((s) => s !== 429)).toBe(true);
  });
});
