// Flight boarding passes for the FurlPay Trips surface.
//
// Kept out of `store.ts` on purpose: that store models a HOTEL stay
// (checkIn/checkOut/nights/guests) and a boarding pass shares almost none of
// those fields. Widening `Trip` to carry both would give every hotel row a
// dozen null flight columns and every flight row a dozen null stay columns.
//
// Same ownership rules as `store.ts`, for the same reason: an itinerary says
// where a named person will physically be at a stated time, so every accessor
// takes the caller's userId and will not read another user's pass.
//
// Like the trips store this is in-memory and seeded per user, so the native
// apps have something real to render before the booking DB lands. A live build
// swaps `byUser` for the DB and deletes `seed()`; nothing else changes, because
// clients only ever see what this module returns.

/** Where the flight is in its own timeline. The server owns this — a client
 *  that decided its own status would drift from the gate. */
export type FlightStatus =
  | "scheduled"
  | "boarding_soon"
  | "boarding"
  | "departed"
  | "landed";

export interface FlightSegment {
  /** Marketing flight number, e.g. "GE352". */
  number: string;
  /** Equipment type, e.g. "A321". */
  aircraft: string;
  originCode: string;
  originCity: string;
  destinationCode: string;
  destinationCity: string;
  gate: string;
  seat: string;
  /** Local wall-clock times as printed on the pass, 24h. */
  boardingTime: string;
  departureTime: string;
  arrivalTime: string;
}

export interface BoardingPass {
  id: string;
  userId: string;
  /** Trip headline, e.g. "Paris Trip". */
  title: string;
  /** Route line under the title, e.g. "New York → Paris". */
  routeLabel: string;
  flight: FlightSegment;
  passenger: { name: string; verified: boolean };
  payment: { currency: "USDC"; amount: number; rewardsRate: number };
  /** Absolute instants. Clients derive every countdown from these rather than
   *  from a pre-formatted string, so a Live Activity can tick without polling
   *  and a screen left open overnight cannot show a stale "Boarding in 18 min". */
  boardingAt: string;
  departsAt: string;
  arrivesAt: string;
  status: FlightStatus;
  createdAt: string;
}

const MIN = 60_000;

const byUser: Map<string, Map<string, BoardingPass>> = ((
  globalThis as unknown as { __furlpayBoardingPasses?: Map<string, Map<string, BoardingPass>> }
).__furlpayBoardingPasses ??= new Map());

/** Wall-clock "HH:MM" in the airport's own local time. */
function hhmm(at: Date, timeZone: string): string {
  return at.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  });
}

/**
 * One seeded transatlantic booking, created the first time a user reads their
 * passes. Boarding is set 18 minutes out so a fresh session opens on the state
 * the Trips screen was designed around; as that elapses the pass walks the real
 * status ladder, which is exactly the path the screens have to handle anyway.
 */
function seed(userId: string, passengerName: string): Map<string, BoardingPass> {
  const now = Date.now();
  const boardingAt = new Date(now + 18 * MIN);
  const departsAt = new Date(now + 58 * MIN);
  const arrivesAt = new Date(departsAt.getTime() + 7 * 60 * MIN + 10 * MIN);

  const pass: BoardingPass = {
    id: `bp_demo_cdg_${userId}`,
    userId,
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
      boardingTime: hhmm(boardingAt, "America/New_York"),
      departureTime: hhmm(departsAt, "America/New_York"),
      arrivalTime: hhmm(arrivesAt, "Europe/Paris"),
    },
    passenger: { name: passengerName, verified: true },
    payment: { currency: "USDC", amount: 486.2, rewardsRate: 2 },
    boardingAt: boardingAt.toISOString(),
    departsAt: departsAt.toISOString(),
    arrivesAt: arrivesAt.toISOString(),
    status: "boarding_soon",
    createdAt: new Date(now).toISOString(),
  };

  const passes = new Map([[pass.id, pass]]);
  byUser.set(userId, passes);
  return passes;
}

function bookOf(userId: string, passengerName: string): Map<string, BoardingPass> {
  return byUser.get(userId) ?? seed(userId, passengerName);
}

/**
 * Recompute status from the clock on every read. Storing it would let a pass
 * sit at "boarding_soon" for hours because nothing happened to run an updater.
 */
export function statusAt(pass: BoardingPass, now = Date.now()): FlightStatus {
  const boarding = Date.parse(pass.boardingAt);
  const departs = Date.parse(pass.departsAt);
  const arrives = Date.parse(pass.arrivesAt);
  if (now >= arrives) return "landed";
  if (now >= departs) return "departed";
  if (now >= boarding) return "boarding";
  if (now >= boarding - 30 * MIN) return "boarding_soon";
  return "scheduled";
}

/** Minutes until boarding, floored at 0. Null once boarding has started. */
export function minutesToBoarding(pass: BoardingPass, now = Date.now()): number | null {
  const delta = Date.parse(pass.boardingAt) - now;
  return delta <= 0 ? null : Math.max(0, Math.round(delta / MIN));
}

/**
 * 0–1 position along the route. Zero until the aircraft actually departs — a
 * progress bar that starts creeping while the plane is still at the gate is a
 * fabricated signal, however good it looks.
 */
export function routeProgress(pass: BoardingPass, now = Date.now()): number {
  const departs = Date.parse(pass.departsAt);
  const arrives = Date.parse(pass.arrivesAt);
  if (now <= departs || arrives <= departs) return 0;
  return Math.min(1, (now - departs) / (arrives - departs));
}

/** The caller's boarding passes, freshest first. Scoped to `userId`. */
export function listBoardingPasses(userId: string, passengerName: string): BoardingPass[] {
  const now = Date.now();
  return [...bookOf(userId, passengerName).values()]
    .map((p) => ({ ...p, status: statusAt(p, now) }))
    .filter((p) => p.status !== "landed")
    .sort((a, b) => Date.parse(a.departsAt) - Date.parse(b.departsAt));
}

/** One pass by id, or null when it is not this user's. */
export function getBoardingPass(
  userId: string,
  passengerName: string,
  id: string
): BoardingPass | null {
  const pass = bookOf(userId, passengerName).get(id);
  if (!pass) return null;
  return { ...pass, status: statusAt(pass) };
}

/** Test seam — drops every seeded pass so a spec starts from a known state. */
export function __resetBoardingPasses(): void {
  byUser.clear();
}
