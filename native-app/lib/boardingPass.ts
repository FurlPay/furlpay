import { api } from "./api";

// ---------------------------------------------------------------------------
// Flight boarding passes — GET /api/travel/boarding-passes.
//
// Types mirror apps/web/src/lib/travel/boardingPass.ts field for field, so the
// same server payload renders on web, here, and in the SwiftUI app.
//
// The countdown and the route progress are SERVER-computed and arrive on the
// wire. They are re-derived locally only while a screen is open (see
// `liveMinutesToBoarding`), from the absolute instants the server sent — never
// invented, and never left to drift by a screen that stayed open overnight.
// ---------------------------------------------------------------------------

export type FlightStatus =
  | "scheduled"
  | "boarding_soon"
  | "boarding"
  | "departed"
  | "landed";

export interface FlightSegment {
  number: string;
  aircraft: string;
  originCode: string;
  originCity: string;
  destinationCode: string;
  destinationCity: string;
  gate: string;
  seat: string;
  boardingTime: string;
  departureTime: string;
  arrivalTime: string;
}

export interface BoardingPass {
  id: string;
  title: string;
  routeLabel: string;
  flight: FlightSegment;
  passenger: { name: string; verified: boolean };
  payment: { currency: "USDC"; amount: number; rewardsRate: number };
  boardingAt: string;
  departsAt: string;
  arrivesAt: string;
  status: FlightStatus;
  createdAt: string;
  /** Null once boarding has started. */
  minutesToBoarding: number | null;
  /** 0–1 along the route; 0 until the aircraft departs. */
  progress: number;
}

export interface BoardingPassesResponse {
  count: number;
  passes: BoardingPass[];
}

export function fetchBoardingPasses(): Promise<BoardingPassesResponse> {
  return api<BoardingPassesResponse>("/travel/boarding-passes");
}

const MIN = 60_000;

/** Live countdown from the absolute instant the server sent. */
export function liveMinutesToBoarding(pass: BoardingPass, now = Date.now()): number | null {
  const delta = Date.parse(pass.boardingAt) - now;
  return delta <= 0 ? null : Math.max(0, Math.round(delta / MIN));
}

/** Recomputed locally so a screen left open does not keep claiming "boarding". */
export function liveStatus(pass: BoardingPass, now = Date.now()): FlightStatus {
  const boarding = Date.parse(pass.boardingAt);
  const departs = Date.parse(pass.departsAt);
  const arrives = Date.parse(pass.arrivesAt);
  if (now >= arrives) return "landed";
  if (now >= departs) return "departed";
  if (now >= boarding) return "boarding";
  if (now >= boarding - 30 * MIN) return "boarding_soon";
  return "scheduled";
}

/** The short line the Live Activity card shows, e.g. "Boarding in 18 min". */
export function statusLine(pass: BoardingPass, now = Date.now()): string {
  const status = liveStatus(pass, now);
  switch (status) {
    case "scheduled":
    case "boarding_soon": {
      const mins = liveMinutesToBoarding(pass, now);
      return mins == null ? "Boarding now" : `Boarding in ${mins} min`;
    }
    case "boarding":
      return `Boarding · Gate ${pass.flight.gate}`;
    case "departed":
      return `In the air · lands ${pass.flight.arrivalTime}`;
    case "landed":
      return `Landed ${pass.flight.arrivalTime}`;
  }
}

/** The longer label the detail card shows under "Status". */
export function statusLabel(status: FlightStatus): string {
  switch (status) {
    case "scheduled":
      return "Scheduled";
    case "boarding_soon":
      return "Boarding Soon";
    case "boarding":
      return "Boarding";
    case "departed":
      return "In the Air";
    case "landed":
      return "Landed";
  }
}
