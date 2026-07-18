// ---------------------------------------------------------------------------
// Pre-trip entry requirements — the visa/passport gap the report flagged.
// Proves the DETERMINISTIC, high-confidence behaviour (the visa matrix itself
// is indicative and out of scope for assertions):
//   • ISO-2 / country-name / IATA resolution
//   • domestic + free-movement short-circuits
//   • passport-validity math against the destination's rule
//   • the route contract (200 / 400 / 422) and the book-route hard block on an
//     already-expired passport
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { entryRequirements, toIso2, ENTRY_DATA_VERSION } from "@/lib/travel/entryRequirements";
import { POST as entryPOST } from "@/app/api/travel/entry-requirements/route";
import { POST as bookPOST } from "@/app/api/travel/book/route";

function post(url: string, body: unknown, ip = `10.9.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

// A date N days from now, as YYYY-MM-DD.
const dayOffset = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

describe("toIso2 resolution", () => {
  it("resolves ISO-2, country name, and IATA code", () => {
    expect(toIso2("US")).toBe("US");
    expect(toIso2("india")).toBe("IN");
    expect(toIso2("United Kingdom")).toBe("GB");
    expect(toIso2("JFK")).toBe("US"); // airport → country
    expect(toIso2("DEL")).toBe("IN");
    expect(toIso2("ZZ")).toBeNull();
    expect(toIso2("")).toBeNull();
  });
});

describe("entryRequirements engine", () => {
  it("treats same-country travel as domestic with no passport rule", () => {
    const r = entryRequirements({ nationality: "US", destination: "US" })!;
    expect(r.visa.status).toBe("domestic");
    expect(r.passport.ok).toBeUndefined();
  });

  it("recognises EU/Schengen free movement", () => {
    const r = entryRequirements({ nationality: "FR", destination: "DE" })!;
    expect(r.visa.status).toBe("free_movement");
  });

  it("gives US→Schengen a visa-free short stay", () => {
    const r = entryRequirements({ nationality: "US", destination: "FR" })!;
    expect(r.visa.status).toBe("visa_free");
    expect(r.visa.maxStayDays).toBe(90);
  });

  it("flags a visa-required corridor", () => {
    const r = entryRequirements({ nationality: "IN", destination: "GB" })!;
    expect(r.visa.status).toBe("visa_required");
  });

  it("returns null for an unresolved country", () => {
    expect(entryRequirements({ nationality: "US", destination: "Atlantis" })).toBeNull();
  });

  it("passes a passport valid well beyond the destination rule", () => {
    const r = entryRequirements({
      nationality: "US",
      destination: "IN", // India requires 6 months validity
      passportExpiry: dayOffset(400),
      departureDate: dayOffset(30),
    })!;
    expect(r.passport.validityMonths).toBe(6);
    expect(r.passport.ok).toBe(true);
  });

  it("fails a passport that expires inside the 6-month buffer", () => {
    const r = entryRequirements({
      nationality: "US",
      destination: "IN",
      passportExpiry: dayOffset(120), // <6 months after a departure 30 days out
      departureDate: dayOffset(30),
    })!;
    expect(r.passport.ok).toBe(false);
  });

  it("does UTC month-boundary math correctly (Aug 31 + 3mo → Nov 30)", () => {
    // Schengen requires 3 months validity. A departure on a month-end date is
    // the case where local-vs-UTC getters diverge; the clamp must land on Nov 30.
    const base = { nationality: "US" as const, destination: "FR" as const, departureDate: "2026-08-31" };
    expect(entryRequirements({ ...base, passportExpiry: "2026-11-30" })!.passport.ok).toBe(true);
    expect(entryRequirements({ ...base, passportExpiry: "2026-11-29" })!.passport.ok).toBe(false);
  });

  it("stamps the assessment with the data version", () => {
    const r = entryRequirements({ nationality: "US", destination: "FR" })!;
    expect(r.dataVersion).toBe(ENTRY_DATA_VERSION);
  });
});

describe("POST /api/travel/entry-requirements", () => {
  it("returns an assessment for a valid request", async () => {
    const res = await entryPOST(post("https://furlpay.com/api/travel/entry-requirements", { nationality: "GB", destination: "US" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.visa.status).toBe("eta"); // ESTA
    expect(json.advisory).toBeTruthy();
  });

  it("422s an unresolved country", async () => {
    const res = await entryPOST(post("https://furlpay.com/api/travel/entry-requirements", { nationality: "US", destination: "Narnia" }));
    expect(res.status).toBe(422);
  });

  it("400s a body missing required fields", async () => {
    const res = await entryPOST(post("https://furlpay.com/api/travel/entry-requirements", { nationality: "US" }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/travel/book — passport pre-check", () => {
  it("hard-blocks a booking whose passport is expired before departure", async () => {
    const res = await bookPOST(
      post("https://furlpay.com/api/travel/book", {
        subtotalUsd: 500,
        source: "legacy",
        nationality: "US",
        destinationCountry: "FR",
        passportExpiry: dayOffset(-1), // already expired
        checkIn: dayOffset(30),
        checkOut: dayOffset(34),
      }),
    );
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe("passport_expired");
  });

  it("books normally and attaches a non-blocking entry assessment", async () => {
    const res = await bookPOST(
      post("https://furlpay.com/api/travel/book", {
        subtotalUsd: 500,
        source: "legacy",
        nationality: "IN",
        destinationCountry: "GB", // visa_required — advisory only, must not block
        passportExpiry: dayOffset(400),
        checkIn: dayOffset(30),
        checkOut: dayOffset(34),
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.booking.entry.visa.status).toBe("visa_required");
    expect(json.booking.trip.status).toBe("confirmed");
  });
});
