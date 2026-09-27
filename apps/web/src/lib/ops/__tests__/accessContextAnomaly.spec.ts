import { afterEach, describe, expect, it } from "vitest";
import { accessContextPolicy, noteAccessContext } from "../accessContextAnomaly";
import { listSecurityEvents } from "@/lib/ops/events";

// ---------------------------------------------------------------------------
// Where and when a privileged action happened.
//
// The volume detector cannot see a stolen session used carefully: one dossier
// read, from a country the officer has never worked from, at 03:40. This can.
//
// Two things are under test, and the second matters as much as the first:
//   1. the signals fire on the right shapes and stay quiet otherwise
//   2. the module stores almost nothing — a country code and a timestamp
//
// (2) is the part that keeps this from becoming employee surveillance, and it is
// asserted rather than promised in a comment.
// ---------------------------------------------------------------------------

let n = 0;
const actor = (l: string) => `ctx_${l}_${Date.now()}_${n++}`;

/** A time safely inside working hours UTC, so geo tests do not also trip off-hours. */
const NOON = (offsetMinutes = 0) => new Date(Date.UTC(2026, 8, 27, 12, 0) + offsetMinutes * 60_000);

afterEach(() => {
  delete process.env.FURLPAY_GEO_ANOMALY_MINUTES;
  delete process.env.FURLPAY_OFFHOURS_UTC;
});

async function eventsFor(id: string) {
  return (await listSecurityEvents(800)).filter((e) => e.actor === id);
}

describe("country change", () => {
  it("says nothing on the first sighting", async () => {
    // Nothing to compare against. A first-seen country is not a signal, and
    // alerting on it would fire once per actor per deployment for no reason.
    const id = actor("first");
    const v = await noteAccessContext({ actorId: id, country: "IT", action: "stage", now: NOON() });
    expect(v.countryChanged).toBe(false);
    expect(v.previousCountry).toBeNull();
    expect(await eventsFor(id)).toHaveLength(0);
  });

  it("says nothing when the country is unchanged", async () => {
    const id = actor("same");
    await noteAccessContext({ actorId: id, country: "IT", action: "stage", now: NOON() });
    const v = await noteAccessContext({ actorId: id, country: "IT", action: "stage", now: NOON(600) });
    expect(v.countryChanged).toBe(false);
    expect(await eventsFor(id)).toHaveLength(0);
  });

  it("flags an implausibly fast country change", async () => {
    // THE SIGNAL. Milan then Lagos twenty minutes later is not travel.
    const id = actor("impossible");
    await noteAccessContext({ actorId: id, country: "IT", action: "stage", now: NOON() });
    const v = await noteAccessContext({ actorId: id, country: "NG", action: "disclose", now: NOON(20) });

    expect(v.countryChanged).toBe(true);
    expect(v.implausibleTravel).toBe(true);
    expect(v.previousCountry).toBe("IT");

    const evt = (await eventsFor(id)).find((e) => e.kind === "anomaly_implausible_travel");
    expect(evt).toBeTruthy();
    // The responder is told what to rule out first, because a VPN is the most
    // likely explanation and an alert that does not say so wastes their time.
    expect(evt?.detail).toMatch(/VPN|proxy/i);
  });

  it("flags a plausible change more quietly", async () => {
    // A day later is ordinary travel. Worth recording, not worth a page.
    const id = actor("plausible");
    await noteAccessContext({ actorId: id, country: "IT", action: "stage", now: NOON() });
    const v = await noteAccessContext({ actorId: id, country: "NG", action: "stage", now: NOON(60 * 24) });

    expect(v.countryChanged).toBe(true);
    expect(v.implausibleTravel).toBe(false);
    const kinds = (await eventsFor(id)).map((e) => e.kind);
    expect(kinds).toContain("anomaly_privileged_country_change");
    expect(kinds).not.toContain("anomaly_implausible_travel");
  });

  it("treats a missing country as unknown, not as suspicious", async () => {
    // Self-hosted, local dev, or a proxy that strips the header all produce this.
    // Alerting on absence would make the detector useless in exactly the
    // deployments least able to investigate it.
    const id = actor("nocountry");
    await noteAccessContext({ actorId: id, country: "IT", action: "stage", now: NOON() });
    const v = await noteAccessContext({ actorId: id, country: null, action: "stage", now: NOON(5) });
    expect(v.countryChanged).toBe(false);
    expect(v.implausibleTravel).toBe(false);
  });

  it.each(["", "  ", "XYZ", "I", "12", "it-IT"])("ignores a malformed country %o", async (bad) => {
    const id = actor("malformed");
    await noteAccessContext({ actorId: id, country: "IT", action: "stage", now: NOON() });
    const v = await noteAccessContext({ actorId: id, country: bad, action: "stage", now: NOON(5) });
    expect(v.countryChanged).toBe(false);
  });

  it("normalises case, so a lowercase header is recorded and compared", async () => {
    // Header casing varies by edge provider. Treating `gb` as different from `GB`
    // would fire an implausible-travel alert on every other request.
    //
    // ASSERTED VIA previousCountry, not via a no-change result. Storing "gb" then
    // sending "GB" and checking `countryChanged === false` passes for the WRONG
    // reason if normalisation is removed: unnormalised "gb" fails the
    // `/^[A-Z]{2}$/` guard, is never recorded at all, and the second call then
    // sees no previous country — also reporting no change. A mutation study
    // removing `.toUpperCase()` survived exactly that test.
    //
    // Moving to a THIRD country makes the two cases diverge: correct code has
    // "GB" on record and flags the change; the mutant has nothing on record.
    const id = actor("case");
    await noteAccessContext({ actorId: id, country: "gb", action: "stage", now: NOON() });
    const v = await noteAccessContext({ actorId: id, country: "FR", action: "stage", now: NOON(600) });

    expect(v.previousCountry, "a lowercase country code was never recorded").toBe("GB");
    expect(v.countryChanged).toBe(true);
  });

  it("treats gb and GB as the same country", async () => {
    // The direct property, now that recording is proven above.
    const id = actor("case2");
    await noteAccessContext({ actorId: id, country: "GB", action: "stage", now: NOON() });
    const v = await noteAccessContext({ actorId: id, country: "gb", action: "stage", now: NOON(5) });
    expect(v.countryChanged).toBe(false);
    expect(v.implausibleTravel).toBe(false);
  });

  it("honours a configured window", async () => {
    process.env.FURLPAY_GEO_ANOMALY_MINUTES = "10";
    const id = actor("tuned");
    await noteAccessContext({ actorId: id, country: "IT", action: "stage", now: NOON() });
    // 20 minutes is now plausible under a 10-minute window.
    const v = await noteAccessContext({ actorId: id, country: "FR", action: "stage", now: NOON(20) });
    expect(v.countryChanged).toBe(true);
    expect(v.implausibleTravel).toBe(false);
  });

  it("does not fire on a clock that went backwards", async () => {
    // Two instances with skewed clocks would otherwise produce a negative
    // interval and read as instantaneous travel.
    const id = actor("skew");
    await noteAccessContext({ actorId: id, country: "IT", action: "stage", now: NOON(60) });
    const v = await noteAccessContext({ actorId: id, country: "FR", action: "stage", now: NOON(0) });
    expect(v.implausibleTravel).toBe(false);
  });
});

describe("off hours", () => {
  it("flags an action inside the window", async () => {
    const id = actor("night");
    const v = await noteAccessContext({
      actorId: id,
      country: "IT",
      action: "disclose",
      now: new Date(Date.UTC(2026, 8, 27, 3, 40)),
    });
    expect(v.offHours).toBe(true);
    expect((await eventsFor(id)).some((e) => e.kind === "anomaly_offhours_privileged_action")).toBe(true);
  });

  it("stays quiet during the day", async () => {
    const id = actor("day");
    const v = await noteAccessContext({ actorId: id, country: "IT", action: "stage", now: NOON() });
    expect(v.offHours).toBe(false);
  });

  it("supports a window that wraps midnight", async () => {
    process.env.FURLPAY_OFFHOURS_UTC = "22-4";
    const id = actor("wrap");
    expect(
      (await noteAccessContext({ actorId: id, country: "IT", action: "x", now: new Date(Date.UTC(2026, 8, 27, 23, 0)) })).offHours
    ).toBe(true);
    const id2 = actor("wrap2");
    expect(
      (await noteAccessContext({ actorId: id2, country: "IT", action: "x", now: new Date(Date.UTC(2026, 8, 27, 12, 0)) })).offHours
    ).toBe(false);
  });

  it("can be switched off entirely", async () => {
    // A distributed team works around the clock legitimately. A signal that
    // cannot be disabled gets muted at the channel, taking the useful ones with it.
    process.env.FURLPAY_OFFHOURS_UTC = "off";
    expect(accessContextPolicy().offHoursUtc).toBeNull();
    const id = actor("always");
    const v = await noteAccessContext({
      actorId: id,
      country: "IT",
      action: "x",
      now: new Date(Date.UTC(2026, 8, 27, 3, 0)),
    });
    expect(v.offHours).toBe(false);
  });

  it("ignores a malformed window rather than disabling detection", async () => {
    process.env.FURLPAY_OFFHOURS_UTC = "banana";
    expect(accessContextPolicy().offHoursUtc).toEqual({ start: 1, end: 5 });
  });
});

describe("what it stores", () => {
  it("declares only an actor id, a country and a timestamp", async () => {
    // THE PRIVACY CLAIM, ASSERTED. The module's own comment says it stores almost
    // nothing; this makes that inspectable. An added field — a city, an IP, a
    // coordinate — fails here, which is the moment to argue about it.
    expect(accessContextPolicy().storedFields).toEqual([
      "actorId",
      "country (ISO-3166 alpha-2)",
      "timestamp",
    ]);
  });

  it("puts no IP, city or coordinate into the event", async () => {
    const id = actor("nopii");
    await noteAccessContext({ actorId: id, country: "IT", action: "stage", now: NOON() });
    await noteAccessContext({ actorId: id, country: "NG", action: "stage", now: NOON(10) });

    const evt = (await eventsFor(id)).find((e) => e.kind === "anomaly_implausible_travel");
    const s = JSON.stringify(evt);
    expect(s).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/); // no IPv4
    expect(s).not.toMatch(/latitude|longitude|\bcity\b|postcode/i);
    // Country codes and the actor are the whole payload.
    expect(s).toContain("IT");
    expect(s).toContain("NG");
  });

  it("never throws, whatever it is handed", async () => {
    // Sits inline on statutory disclosures. It must not be able to fail one.
    await expect(
      noteAccessContext({ actorId: "", country: undefined, action: "" })
    ).resolves.toBeTruthy();
  });
});
