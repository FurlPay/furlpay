import { describe, expect, it } from "vitest";
import {
  assertNoOverDisclosure,
  boardingPassContent,
  safeBoardingPassContent,
  PassDisclosureError,
  type PassContent,
} from "@/lib/passes/content";
import type { BoardingPass } from "@/lib/travel/boardingPass";

// ---------------------------------------------------------------------------
// What a wallet pass is allowed to say.
//
// A pass is not a screen inside the app: it shows on a LOCK SCREEN, surfaces
// itself by time or proximity, and is a FILE that can be AirDropped or mailed.
// FurlPay already ships Discreet Mode so a user can hide their balance in
// public, so a pass printing money contradicts a feature the product has.
//
// These tests pin that as a property of the content model rather than a habit
// at each call site.
// ---------------------------------------------------------------------------

const pass: BoardingPass = {
  id: "bp_demo_cdg_u_1",
  userId: "u_1",
  title: "Paris Trip",
  routeLabel: "New York → Paris",
  flight: {
    number: "GE352",
    aircraft: "A321",
    originCode: "JFK",
    originCity: "New York",
    destinationCode: "CDG",
    destinationCity: "Paris",
    gate: "B24",
    seat: "14A",
    boardingTime: "21:40",
    departureTime: "22:10",
    arrivalTime: "11:35",
  },
  passenger: { name: "Ada Lovelace", verified: true },
  payment: { currency: "USDC", amount: 842.5, rewardsRate: 0.02 },
  boardingAt: "2026-10-02T21:40:00-04:00",
  departsAt: "2026-10-02T22:10:00-04:00",
  arrivesAt: "2026-10-03T11:35:00+02:00",
  status: "onTime",
  createdAt: "2026-09-25T10:00:00Z",
};

/** A minimal valid content object, for exercising the redactor directly. */
function content(overrides: Partial<PassContent> = {}): PassContent {
  return {
    kind: "boarding",
    serial: "s_1",
    organizationName: "FurlPay",
    description: "test",
    headerFields: [],
    primaryFields: [],
    secondaryFields: [],
    auxiliaryFields: [],
    backFields: [],
    barcode: { format: "qr", message: "https://furlpay.com/p/s_1" },
    relevance: { locations: [] },
    ...overrides,
  };
}

describe("a boarding pass never prints the fare", () => {
  it("omits BoardingPass.payment entirely", () => {
    // The model carries { currency, amount, rewardsRate }. An airline's own pass
    // never prints the fare, and putting it here would put what someone paid on
    // their lock screen.
    const c = boardingPassContent(pass);
    const all = JSON.stringify(c);
    expect(all).not.toContain("842.5");
    expect(all).not.toContain("842");
    expect(all).not.toContain("rewardsRate");
  });

  it("passes its own redactor", () => {
    expect(() => safeBoardingPassContent(pass)).not.toThrow();
  });

  it("still carries what a boarding pass is for", () => {
    const c = safeBoardingPassContent(pass);
    const flat = c.primaryFields.concat(c.secondaryFields, c.auxiliaryFields);
    const byKey = Object.fromEntries(flat.map((f) => [f.key, f.value]));
    expect(byKey.origin).toBe("JFK");
    expect(byKey.destination).toBe("CDG");
    expect(byKey.gate).toBe("B24");
    expect(byKey.seat).toBe("14A");
    expect(byKey.passenger).toBe("Ada Lovelace");
  });

  it("interrupts for a gate change and nothing else", () => {
    // A changeMessage on every field turns an updated pass into a burst of
    // notifications, and the user stops reading them.
    const c = safeBoardingPassContent(pass);
    const withMessages = [...c.secondaryFields, ...c.auxiliaryFields].filter(
      (f) => f.changeMessage
    );
    expect(withMessages.map((f) => f.key)).toEqual(["gate"]);
  });
});

describe("relevance is absolute, never wall-clock", () => {
  it("derives from boardingAt, the instant the pass is wanted", () => {
    const c = safeBoardingPassContent(pass);
    expect(c.relevance.at).toBe(pass.boardingAt);
    // A parseable instant with an offset — not "21:40", which would surface the
    // pass at 21:40 in whatever zone the phone is in. For a traveller that is
    // the one zone it is guaranteed to be wrong.
    expect(Number.isNaN(Date.parse(c.relevance.at!))).toBe(false);
    expect(c.relevance.at).toMatch(/[+-]\d{2}:\d{2}$|Z$/);
  });

  it("prints local wall-clock times for the traveller to read", () => {
    // The printed times stay as the departure board shows them; only relevance
    // is absolute.
    const c = safeBoardingPassContent(pass);
    const boards = c.auxiliaryFields.find((f) => f.key === "boards");
    expect(boards?.value).toBe("21:40");
  });

  it("carries no geofence rather than an invented one", () => {
    // lib/travel/airports.ts has iata/name/city/country and no coordinates.
    // A guessed geofence surfaces the pass in the wrong place, which is worse
    // than not surfacing it.
    expect(safeBoardingPassContent(pass).relevance.locations).toEqual([]);
  });
});

describe("the redactor refuses money", () => {
  it.each([
    "portfolioValue",
    "balance",
    "totalPaid",
    "amountUsd",
    "lastDividend",
    "holdings",
  ])("refuses a field keyed %s", (key) => {
    expect(() =>
      assertNoOverDisclosure(content({ primaryFields: [{ key, label: "L", value: "x" }] }))
    ).toThrow(PassDisclosureError);
  });

  it("names the rule and the field, so the decision gets made", () => {
    try {
      assertNoOverDisclosure(
        content({ primaryFields: [{ key: "portfolioValue", label: "TOTAL", value: "$48,250.80" }] })
      );
      throw new Error("should have thrown");
    } catch (e) {
      const err = e as PassDisclosureError;
      expect(err.field).toBe("primaryFields.portfolioValue");
      expect(err.rule).toBe("no monetary values on a pass");
      // The message has to explain WHY, or it gets suppressed rather than heeded.
      expect(err.message).toContain("Discreet Mode");
    }
  });
});

describe("the redactor refuses identifiers that should not be on a lock screen", () => {
  it.each([
    ["a full EVM address", "0x71C7656EC7ab88b098defB751B7401B5f6d8976F"],
    ["a Solana address", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"],
    ["an E.164 phone number", "+6591234567"],
    ["a PAN-like digit run", "4111552288341920"],
    ["an email address", "ada@example.com"],
  ])("refuses %s", (_label, value) => {
    expect(() =>
      assertNoOverDisclosure(content({ secondaryFields: [{ key: "x", label: "L", value }] }))
    ).toThrow(PassDisclosureError);
  });

  it("checks the BACK of the pass too", () => {
    // "It's on the back" is not a boundary — flipping a pass needs no
    // authentication. The report that proposed these passes put wallet
    // addresses and a PayNow phone number exactly there.
    expect(() =>
      assertNoOverDisclosure(
        content({
          backFields: [
            { key: "arb", label: "Arbitrum USDC", value: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F" },
          ],
        })
      )
    ).toThrow(/EVM address/);
  });

  it("refuses a raw address in the barcode, and says what to encode instead", () => {
    try {
      assertNoOverDisclosure(
        content({
          barcode: { format: "qr", message: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F" },
        })
      );
      throw new Error("should have thrown");
    } catch (e) {
      const err = e as PassDisclosureError;
      expect(err.field).toBe("barcode.message");
      // Rotating the address must not require reissuing every pass.
      expect(err.message).toContain("resolvable FurlPay link");
    }
  });

  it("allows a resolvable link in the barcode", () => {
    expect(() =>
      assertNoOverDisclosure(
        content({ barcode: { format: "qr", message: "https://furlpay.com/pay/@ada" } })
      )
    ).not.toThrow();
  });
});

describe("the rules do not fire on legitimate travel data", () => {
  // A redactor that blocks ordinary content gets disabled, so the false-positive
  // behaviour is as load-bearing as the true-positive behaviour.
  it.each([
    ["a flight number", "GE352"],
    ["an IATA code", "CDG"],
    ["a gate", "B24"],
    ["a seat", "14A"],
    ["an aircraft type", "A321"],
    ["a wall-clock time", "21:40"],
    ["a passenger name", "Ada Lovelace"],
    ["a route label", "New York → Paris"],
    ["a booking reference", "bp_demo_cdg_u_1"],
    ["a hyphenated UUID", "550e8400-e29b-41d4-a716-446655440000"],
    ["a short numeric confirmation", "9984102"],
  ])("accepts %s", (_label, value) => {
    expect(() =>
      assertNoOverDisclosure(content({ secondaryFields: [{ key: "detail", label: "L", value }] }))
    ).not.toThrow();
  });
});

describe("the safe builder is the only way in", () => {
  it("validates, so no caller can obtain unchecked content", () => {
    // boardingPassContent is exported for testing the mapping in isolation;
    // safeBoardingPassContent is what production calls.
    const c = safeBoardingPassContent(pass);
    expect(() => assertNoOverDisclosure(c)).not.toThrow();
  });
});
