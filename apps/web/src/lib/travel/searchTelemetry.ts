"use client";

import { trackClient } from "@/lib/analytics/client";

// How a travel search ENDED, through the existing analytics contract
// (travel_search, phase "result"). It is what tells "nobody searched" apart from
// "everyone searched and got nothing" and from "the provider is not connected"
// — three situations the empty page alone makes look identical.
//
// Deliberately no city, dates or guest details: category, outcome and a count
// are enough to see whether a page works, and nothing here identifies anyone.

export type SearchOutcome = "results" | "empty" | "unavailable" | "failed";

export function reportSearchOutcome(
  source: "stays" | "cars" | "activities" | "deals" | "flights",
  outcome: SearchOutcome,
  detail: { count?: number; reason?: string | null } = {},
): void {
  const metadata: Record<string, string | number> = { source, phase: "result", outcome };
  if (typeof detail.count === "number") metadata.count = detail.count;
  // Provider reasons are short fixed codes (no_live_provider, no_offers, …).
  if (detail.reason && /^[a-z_]{2,40}$/.test(detail.reason)) metadata.reason = detail.reason;
  trackClient("travel_search", { metadata });
}

/** The outcome for a response that carries results and an optional provider reason. */
export function outcomeOf(count: number, unavailableReason?: string | null): SearchOutcome {
  if (unavailableReason) return "unavailable";
  return count > 0 ? "results" : "empty";
}
