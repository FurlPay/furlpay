import { barcodeBars } from "../barcode";
import {
  liveMinutesToBoarding,
  liveStatus,
  statusLabel,
  statusLine,
  type BoardingPass,
} from "../boardingPass";

const MIN = 60_000;
const T0 = Date.parse("2026-08-19T12:00:00.000Z");

function pass(over: Partial<BoardingPass> = {}): BoardingPass {
  return {
    id: "bp_test_1",
    title: "Paris Trip",
    routeLabel: "New York → Paris",
    flight: {
      number: "GE352",
      aircraft: "A321",
      originCode: "JFK",
      originCity: "New York",
      destinationCode: "CDG",
      destinationCity: "Paris",
      gate: "34",
      seat: "19A",
      boardingTime: "10:20",
      departureTime: "17:20",
      arrivalTime: "07:30",
    },
    passenger: { name: "Ada Lovelace", verified: true },
    payment: { currency: "USDC", amount: 486.2, rewardsRate: 2 },
    boardingAt: new Date(T0 + 18 * MIN).toISOString(),
    departsAt: new Date(T0 + 58 * MIN).toISOString(),
    arrivesAt: new Date(T0 + 500 * MIN).toISOString(),
    status: "boarding_soon",
    createdAt: new Date(T0).toISOString(),
    minutesToBoarding: 18,
    progress: 0,
    ...over,
  };
}

describe("liveStatus", () => {
  it("walks the ladder as the clock advances", () => {
    const p = pass();
    expect(liveStatus(p, T0 - 20 * MIN)).toBe("scheduled");
    expect(liveStatus(p, T0)).toBe("boarding_soon");
    expect(liveStatus(p, T0 + 19 * MIN)).toBe("boarding");
    expect(liveStatus(p, T0 + 59 * MIN)).toBe("departed");
    expect(liveStatus(p, T0 + 501 * MIN)).toBe("landed");
  });

  it("agrees with the server's own ladder", () => {
    // The server sends `status`; the client recomputes it so a screen left open
    // does not keep claiming "boarding". At the instant the payload was built
    // the two must produce the same answer, or the screen would flicker between
    // states on every refetch.
    const p = pass();
    expect(liveStatus(p, T0)).toBe(p.status);
  });
});

describe("liveMinutesToBoarding", () => {
  it("counts down and reports null once boarding has begun", () => {
    const p = pass();
    expect(liveMinutesToBoarding(p, T0)).toBe(18);
    expect(liveMinutesToBoarding(p, T0 + 17 * MIN)).toBe(1);
    expect(liveMinutesToBoarding(p, T0 + 18 * MIN)).toBeNull();
    expect(liveMinutesToBoarding(p, T0 + 30 * MIN)).toBeNull();
  });
});

describe("statusLine", () => {
  it("reads as the design does before boarding", () => {
    expect(statusLine(pass(), T0)).toBe("Boarding in 18 min");
  });

  it("names the gate once boarding starts, and never a stale countdown", () => {
    expect(statusLine(pass(), T0 + 20 * MIN)).toBe("Boarding · Gate 34");
  });

  it("switches to the arrival once airborne", () => {
    expect(statusLine(pass(), T0 + 90 * MIN)).toBe("In the air · lands 07:30");
    expect(statusLine(pass(), T0 + 600 * MIN)).toBe("Landed 07:30");
  });

  it("never renders a negative countdown", () => {
    for (let m = 0; m <= 600; m += 7) {
      expect(statusLine(pass(), T0 + m * MIN)).not.toMatch(/-\d/);
    }
  });
});

describe("statusLabel", () => {
  it("covers every status the server can send", () => {
    for (const s of ["scheduled", "boarding_soon", "boarding", "departed", "landed"] as const) {
      expect(statusLabel(s)).toBeTruthy();
    }
  });
});

describe("barcodeBars", () => {
  // The pass is rendered from the booking id. If the bars were not a pure
  // function of it, the barcode a passenger screenshots at the gate would not
  // be the one on screen a second later.
  it("is deterministic for a value and different across values", () => {
    expect(barcodeBars("bp_a")).toEqual(barcodeBars("bp_a"));
    expect(barcodeBars("bp_a")).not.toEqual(barcodeBars("bp_b"));
  });

  it("emits only widths the renderer can draw", () => {
    for (const w of barcodeBars("bp_demo_cdg_u1")) {
      expect(Number.isInteger(w)).toBe(true);
      expect(w).toBeGreaterThanOrEqual(1);
      expect(w).toBeLessThanOrEqual(4);
    }
  });

  it("keeps the bar count the web app uses, so the two render the same pass", () => {
    expect(barcodeBars("x")).toHaveLength(116);
  });
});
