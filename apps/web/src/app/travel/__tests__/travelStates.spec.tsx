/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// Every travel results page must tell the truth about WHY it is empty: a
// failed request, a provider that is not connected, and filters that hid real
// results are three different situations with three different remedies.

const api = vi.hoisted(() => ({ sendJSON: vi.fn(), getJSON: vi.fn() }));
const track = vi.hoisted(() => vi.fn());
let search = new URLSearchParams();
vi.mock("@/lib/api", () => api);
vi.mock("@/lib/analytics/client", () => ({ trackClient: track }));
vi.mock("next/navigation", () => ({ useSearchParams: () => search, useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ children, href, ...p }: { children: React.ReactNode; href: string }) => <a href={href} {...p}>{children}</a> }));
vi.mock("@/components/travel/PropertyCard", () => ({ default: ({ stay }: { stay: { name: string } }) => <div data-testid="stay">{stay.name}</div> }));
vi.mock("@/components/travel/CarRentalCard", () => ({ default: ({ car }: { car: { id: string } }) => <div data-testid="car">{car.id}</div> }));

import StaysPage from "../stays/page";
import CarRentalsPage from "../car-rentals/page";
import DealsPage from "../deals/page";
import AlertsPage from "../alerts/page";
import { outcomeOf, reportSearchOutcome } from "@/lib/travel/searchTelemetry";

beforeEach(() => {
  search = new URLSearchParams("city=Lisbon&checkIn=2026-11-10&checkOut=2026-11-13");
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

const stay = (id: string, nightlyUsd: number, stars: number) => ({ id, name: `Hotel ${id}`, nightlyUsd, stars, rating: 4, freeCancellation: true, eco: false });

describe("stays results", () => {
  it("a failed request says the search did not run, offers a retry, and is reported as failed", async () => {
    api.sendJSON.mockRejectedValueOnce(new Error("network"));
    render(<StaysPage />);
    expect(await screen.findByText("Search couldn't run")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.queryByText(/match your filters/)).toBeNull();
    expect(track).toHaveBeenCalledWith("travel_search", { metadata: { source: "stays", phase: "result", outcome: "failed" } });
  });

  it("no connected provider is not blamed on the visitor's filters", async () => {
    api.sendJSON.mockResolvedValueOnce({ results: [], nights: 3, unavailableReason: "no_live_provider", indexedAlternatives: false });
    render(<StaysPage />);
    expect(await screen.findByText("No bookable rates for Lisbon")).toBeTruthy();
    expect(screen.getByText(/isn't connected yet/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reset filters" })).toBeNull();
  });

  it("counts filtered vs total results and offers a reset when filters hide everything", async () => {
    api.sendJSON.mockResolvedValueOnce({ results: [stay("a", 120, 3), stay("b", 300, 4), stay("c", 90, 5)], nights: 3 });
    render(<StaysPage />);
    expect(await screen.findByText(/3 of 3 properties · 3 nights · Nov 10 – Nov 13/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "5★" })[0]);
    expect(screen.getByText(/1 of 3 properties/)).toBeTruthy();
    expect(screen.getAllByTestId("stay")).toHaveLength(1);
  });

  it("filters that remove every result say so and reset restores them", async () => {
    api.sendJSON.mockResolvedValueOnce({ results: [stay("a", 120, 3)], nights: 3 });
    render(<StaysPage />);
    await screen.findByText(/1 of 1 property/);
    fireEvent.click(screen.getAllByRole("button", { name: "5★" })[0]);
    expect(screen.getByText("No stays match your filters")).toBeTruthy();
    expect(screen.getByText(/1 property is hidden by the filters/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Reset filters" })[0]);
    expect(screen.getAllByTestId("stay")).toHaveLength(1);
  });
});

describe("car rentals", () => {
  it("honours the API's unavailable reason instead of 'no cars match your filters'", async () => {
    api.sendJSON.mockResolvedValueOnce({ results: [], days: 3, unavailableReason: "no_live_provider" });
    render(<CarRentalsPage />);
    expect(await screen.findByText("No bookable cars in Lisbon")).toBeTruthy();
    expect(screen.queryByText(/match your filters/)).toBeNull();
  });
  it("a failed request is not 'no cars'", async () => {
    api.sendJSON.mockRejectedValueOnce(new Error("network"));
    render(<CarRentalsPage />);
    expect(await screen.findByText("Search couldn't run")).toBeTruthy();
  });
});

describe("deals", () => {
  it("has no countdown, no flash-sale badge and no live-cashback claim", async () => {
    const interval = vi.spyOn(window, "setInterval");
    api.getJSON.mockResolvedValueOnce({ deals: [], unavailableReason: "no_live_rate_provider" });
    render(<DealsPage />);
    expect(await screen.findByText("Deals aren't connected yet")).toBeTruthy();
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/refresh in|ends in|flash sale|limited-time|\d\d:\d\d:\d\d/i);
    expect(text).not.toMatch(/2% (back|cashback)/i);
    // findByText polls with its own 50 ms interval; the old countdown ticked every 1000 ms.
    expect(interval.mock.calls.some((c) => c[1] === 1000)).toBe(false);
    expect(screen.queryByRole("link", { name: /price alert/i })).toBeNull();
  });
  it("a failed load is not 'no deals'", async () => {
    api.getJSON.mockRejectedValueOnce(new Error("network"));
    render(<DealsPage />);
    expect(await screen.findByText("Deals couldn't load")).toBeTruthy();
  });
});

describe("price alerts", () => {
  it("says the feature is off and disables the form when the server refuses it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 503, ok: false, json: async () => ({ error: "not_available", detail: "Price alerts is not available yet." }) }));
    render(<AlertsPage />);
    expect(await screen.findByText("Price alerts is not available yet.")).toBeTruthy();
    await waitFor(() => expect((document.querySelector("form fieldset") as HTMLFieldSetElement).disabled).toBe(true));
  });
});

describe("search telemetry", () => {
  it("classifies outcomes and never forwards free text as a reason", () => {
    expect(outcomeOf(3)).toBe("results");
    expect(outcomeOf(0)).toBe("empty");
    expect(outcomeOf(0, "no_live_provider")).toBe("unavailable");
    act(() => reportSearchOutcome("cars", "unavailable", { count: 0, reason: "Lisbon, Portugal <script>" }));
    expect(track).toHaveBeenLastCalledWith("travel_search", { metadata: { source: "cars", phase: "result", outcome: "unavailable", count: 0 } });
  });
});
