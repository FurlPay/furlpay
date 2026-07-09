// In-memory trips store for the FurlPay Travels demo funnel.
//
// Module-level so a booking made at checkout appears on /travel/my-trips within
// the same server process. A live build swaps this for the DB (per user). Seeded
// with a few demo trips so My Trips is never empty.

import type { TicketCnft } from "./cnft";

export type TripStatus = "confirmed" | "pending" | "cancelled";

export interface Trip {
  id: string;
  name: string;
  city: string;
  image: string; // tailwind gradient token
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: number;
  amountUsd: number;
  source: "travala" | "legacy";
  method: string; // human label of the payment method
  status: TripStatus;
  txHash?: string;
  cardLast4?: string;
  cashbackUsd: number;
  refundStatus?: string;
  /** Compressed-NFT ticket receipt minted on booking confirmation. */
  ticket?: TicketCnft;
  createdAt: string;
}

const GRAD = ["from-sky-500/40 to-indigo-600/40", "from-fuchsia-500/40 to-purple-700/40", "from-emerald-500/40 to-teal-700/40"];

function daysFromNow(d: number): string {
  return new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
}

// Seeded demo trips (present on first load). Stored on globalThis so every API
// route bundle in the same server process shares one instance (Next.js bundles
// routes separately). A live build uses the DB, keyed per user.
const trips: Map<string, Trip> = ((globalThis as any).__furlpayTrips ??= new Map<string, Trip>());
function seed() {
  if (trips.size) return;
  const demo: Trip[] = [
    {
      id: "bk_demo_tokyo", name: "Grand Hyatt Tokyo", city: "Tokyo", image: GRAD[1],
      checkIn: daysFromNow(21), checkOut: daysFromNow(24), nights: 3, guests: 2,
      amountUsd: 582.12, source: "travala", method: "USDC · x402 on Base", status: "confirmed",
      txHash: "0x" + "a3f1".repeat(10), cashbackUsd: 11.88, createdAt: new Date().toISOString(),
    },
    {
      id: "bk_demo_bali", name: "Alila Villas Uluwatu", city: "Bali", image: GRAD[2],
      checkIn: daysFromNow(-40), checkOut: daysFromNow(-35), nights: 5, guests: 2,
      amountUsd: 1240.0, source: "travala", method: "SOL · x402 on Base", status: "confirmed",
      txHash: "0x" + "9b2c".repeat(10), cashbackUsd: 24.8, createdAt: new Date(Date.now() - 50 * 86_400_000).toISOString(),
    },
    {
      id: "bk_demo_lisbon", name: "Memmo Alfama Lisbon", city: "Lisbon", image: GRAD[0],
      checkIn: daysFromNow(-10), checkOut: daysFromNow(-8), nights: 2, guests: 1,
      amountUsd: 318.0, source: "legacy", method: "Virtual Visa ••1042", status: "cancelled",
      cardLast4: "1042", cashbackUsd: 0, refundStatus: "Refunded to FurlPay balance", createdAt: new Date(Date.now() - 15 * 86_400_000).toISOString(),
    },
  ];
  demo.forEach((t) => trips.set(t.id, t));
}

export function addTrip(t: Trip): Trip {
  seed();
  trips.set(t.id, t);
  return t;
}

export function listTrips(): Trip[] {
  seed();
  return [...trips.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function getTrip(id: string): Trip | undefined {
  seed();
  return trips.get(id);
}

export function updateTrip(id: string, patch: Partial<Trip>): Trip | undefined {
  seed();
  const t = trips.get(id);
  if (!t) return undefined;
  const next = { ...t, ...patch };
  trips.set(id, next);
  return next;
}

export function tripBucket(t: Trip): "upcoming" | "past" | "cancelled" {
  if (t.status === "cancelled") return "cancelled";
  return t.checkOut >= new Date().toISOString().slice(0, 10) ? "upcoming" : "past";
}
