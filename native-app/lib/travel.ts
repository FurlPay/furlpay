import * as WebBrowser from "expo-web-browser";
import { api, API_BASE } from "./api";

// ---------------------------------------------------------------------------
// Travel. The web app's travel funnel is ~27 routes of search, filters and
// checkout — recreating that natively buys nothing, so the app is a native
// shell (deals + trips, below) over an in-app browser for search & booking.
//
// The browser leg needs the user signed in without a second login. We do NOT
// put the session token in the URL to achieve that: a URL is not a secret (it
// lands in history, access logs, and — because the travel pages hotlink
// Unsplash images — in the `Referer` sent to unsplash.com), and our token is
// bearer-equivalent spend authority. Instead we exchange it for a one-time,
// 60-second, single-use code that the browser trades for its own cookie.
// ---------------------------------------------------------------------------

const WEB_ORIGIN = API_BASE.replace(/\/api$/, "");

export interface Deal {
  id: string;
  city: string;
  country: string;
  name: string;
  stars: number;
  nightlyUsd: number;
  discountPct: number;
  payToken: "USDC" | "SOL" | "BTC";
  photo: string;
}

export type TripStatus = "confirmed" | "pending" | "cancelled";

export interface Trip {
  id: string;
  name: string;
  city: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: number;
  amountUsd: number;
  method: string;
  status: TripStatus;
  cashbackUsd: number;
}

export interface TripsResponse {
  upcoming: Trip[];
  past: Trip[];
  cancelled: Trip[];
}

export function fetchDeals(): Promise<{ deals: Deal[] }> {
  return api<{ deals: Deal[] }>("/travel/deals");
}

export function fetchTrips(): Promise<TripsResponse> {
  return api<TripsResponse>("/travel/trips");
}

/**
 * Open a furlpay.com travel path in an authenticated in-app browser.
 *
 * `path` must be a site-relative path ("/travel/stays?query=Bali"). We mint a
 * one-time handoff code and let the web app set its own session cookie, so no
 * bearer token is ever written into a URL.
 *
 * If the handoff fails we still open the page — the user just lands signed-out
 * and can log in — rather than dead-ending the whole travel flow.
 */
export async function openTravelWeb(path: string): Promise<void> {
  let url = `${WEB_ORIGIN}${path}`;
  try {
    const { code } = await api<{ code: string }>("/auth/handoff", { method: "POST" });
    const handoff = new URL(`${WEB_ORIGIN}/auth/handoff`);
    handoff.searchParams.set("code", code);
    handoff.searchParams.set("next", path);
    url = handoff.toString();
  } catch {
    // Fall through to the signed-out URL.
  }
  await WebBrowser.openBrowserAsync(url, {
    toolbarColor: "#000000",
    controlsColor: "#ffffff",
  });
}
