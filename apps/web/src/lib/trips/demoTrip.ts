// Showcase data for the /trips product page.
//
// This is DEMO content for a marketing composition — the passenger, flight and
// amount are the ones printed in the FurlPay Trips design reference, not a real
// booking and not a real user's itinerary. Nothing here is fetched, derived or
// presented as live: the page renders exactly these constants every time, so a
// visitor can never mistake it for their own trip. When this surface is wired to
// the booking backend, replace `DEMO_TRIP` with a `Trip` loaded from
// `/api/travel/trips` — the component tree already takes the shape below.

export type FlightSegment = {
  /** Marketing flight number, e.g. "GE352". */
  number: string;
  /** Equipment / aircraft type, e.g. "A321". */
  aircraft: string;
  originCode: string;
  originCity: string;
  destinationCode: string;
  destinationCity: string;
  /** Local wall-clock times, 24h, as printed on the boarding pass. */
  boardingTime: string;
  departureTime: string;
  arrivalTime: string;
  gate: string;
  seat: string;
};

export type TripPayment = {
  currency: "USDC";
  amount: number;
  /** Loyalty rate applied to the booking, as a percentage. */
  rewardsRate: number;
};

export type Trip = {
  id: string;
  title: string;
  /** Human route line under the title, e.g. "New York → Paris". */
  routeLabel: string;
  heroImage: { src: string; alt: string };
  flight: FlightSegment;
  passenger: { name: string; verified: boolean };
  payment: TripPayment;
  /** Live Activity state — what the lock-screen widget is currently showing. */
  live: {
    /** Short status line, e.g. "Boarding in 18 min". */
    status: string;
    /** Longer status used on the expanded card. */
    statusLong: string;
    /** Minutes until boarding, as shown in the compact chip. */
    minutesToBoarding: number;
    /** 0–1 position of the aircraft along the drawn route. */
    progress: number;
  };
};

export const DEMO_TRIP: Trip = {
  id: "demo-paris",
  title: "Paris Trip",
  routeLabel: "New York → Paris",
  heroImage: {
    src: "/travel/furlpay-airways-a321.jpg",
    alt: "FurlPay Airways Airbus A321 in flight above the clouds",
  },
  flight: {
    number: "GE352",
    aircraft: "A321",
    originCode: "JFK",
    originCity: "New York",
    destinationCode: "CDG",
    destinationCity: "Paris",
    boardingTime: "10:20",
    departureTime: "17:20",
    arrivalTime: "07:30",
    gate: "34",
    seat: "19A",
  },
  passenger: { name: "Arthur Fleck", verified: true },
  payment: { currency: "USDC", amount: 486.2, rewardsRate: 2 },
  live: {
    status: "Boarding in 18 min",
    statusLong: "Boarding Soon",
    minutesToBoarding: 18,
    progress: 0.18,
  },
};

/** `$486.20` — fixed 2dp so the boarding total never renders as `$486.2`. */
export function formatAmount(amount: number): string {
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
