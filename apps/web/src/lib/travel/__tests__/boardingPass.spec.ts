import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetBoardingPasses,
  getBoardingPass,
  listBoardingPasses,
  minutesToBoarding,
  routeProgress,
  statusAt,
} from "../boardingPass";

const MIN = 60_000;

beforeEach(() => __resetBoardingPasses());

describe("ownership", () => {
  it("never returns another user's pass", () => {
    const mine = listBoardingPasses("u1", "Ada Lovelace")[0];
    expect(getBoardingPass("u2", "Grace Hopper", mine.id)).toBeNull();
    expect(getBoardingPass("u1", "Ada Lovelace", mine.id)?.id).toBe(mine.id);
  });

  it("seeds each user their own pass, named for them", () => {
    expect(listBoardingPasses("u1", "Ada Lovelace")[0].passenger.name).toBe("Ada Lovelace");
    expect(listBoardingPasses("u2", "Grace Hopper")[0].passenger.name).toBe("Grace Hopper");
  });

  it("is stable across reads — a second call does not reseed", () => {
    const first = listBoardingPasses("u1", "Ada Lovelace")[0];
    const second = listBoardingPasses("u1", "Ada Lovelace")[0];
    expect(second.id).toBe(first.id);
    expect(second.boardingAt).toBe(first.boardingAt);
  });
});

describe("statusAt", () => {
  const pass = () => listBoardingPasses("u1", "Ada Lovelace")[0];

  it("walks the ladder as the clock advances", () => {
    const p = pass();
    const boarding = Date.parse(p.boardingAt);
    const departs = Date.parse(p.departsAt);
    const arrives = Date.parse(p.arrivesAt);

    expect(statusAt(p, boarding - 45 * MIN)).toBe("scheduled");
    expect(statusAt(p, boarding - 10 * MIN)).toBe("boarding_soon");
    expect(statusAt(p, boarding + 1 * MIN)).toBe("boarding");
    expect(statusAt(p, departs + 1 * MIN)).toBe("departed");
    expect(statusAt(p, arrives + 1 * MIN)).toBe("landed");
  });

  it("opens on boarding_soon, which is the state the Trips screen is designed around", () => {
    expect(pass().status).toBe("boarding_soon");
  });

  it("drops landed flights from the list rather than showing a dead pass", () => {
    const p = pass();
    // The store recomputes status on read, so a pass whose arrival has passed
    // must not come back — this is what keeps yesterday's flight off the screen.
    expect(statusAt(p, Date.parse(p.arrivesAt) + MIN)).toBe("landed");
  });
});

describe("minutesToBoarding", () => {
  it("counts down and then reports null once boarding has begun", () => {
    const p = listBoardingPasses("u1", "Ada Lovelace")[0];
    const boarding = Date.parse(p.boardingAt);
    expect(minutesToBoarding(p, boarding - 18 * MIN)).toBe(18);
    expect(minutesToBoarding(p, boarding - 1 * MIN)).toBe(1);
    expect(minutesToBoarding(p, boarding)).toBeNull();
    expect(minutesToBoarding(p, boarding + 5 * MIN)).toBeNull();
  });
});

describe("routeProgress", () => {
  it("stays at zero until the aircraft has actually departed", () => {
    const p = listBoardingPasses("u1", "Ada Lovelace")[0];
    const departs = Date.parse(p.departsAt);
    expect(routeProgress(p, departs - MIN)).toBe(0);
    expect(routeProgress(p, departs)).toBe(0);
  });

  it("runs 0 to 1 across the flight and never overshoots", () => {
    const p = listBoardingPasses("u1", "Ada Lovelace")[0];
    const departs = Date.parse(p.departsAt);
    const arrives = Date.parse(p.arrivesAt);
    const half = departs + (arrives - departs) / 2;
    expect(routeProgress(p, half)).toBeCloseTo(0.5, 2);
    expect(routeProgress(p, arrives)).toBe(1);
    expect(routeProgress(p, arrives + 10 * MIN)).toBe(1);
  });
});

describe("printed times", () => {
  it("prints arrival in the destination's timezone, not the origin's", () => {
    // JFK -> CDG crosses six hours. If both times were formatted in one zone
    // the pass would tell the passenger to land at the wrong local hour.
    const p = listBoardingPasses("u1", "Ada Lovelace")[0];
    const arrivesLocalParis = new Date(p.arrivesAt).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Europe/Paris",
    });
    expect(p.flight.arrivalTime).toBe(arrivesLocalParis);
  });

  it("prints every clock field as zero-padded 24h HH:MM", () => {
    const { flight } = listBoardingPasses("u1", "Ada Lovelace")[0];
    for (const t of [flight.boardingTime, flight.departureTime, flight.arrivalTime]) {
      expect(t).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
    }
  });
});
