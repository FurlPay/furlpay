/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { existsSync } from "fs";
import { join } from "path";
import HeroTripCard, { type HeroTrip } from "../HeroTripCard";
import { HeroBackdrop, HeroLocationChip, HeroMotionProvider, resetHeroPreloadsForTests } from "../HeroMotion";
import { HERO_BACKDROP_INTERVAL_MS, HERO_CAROUSEL_INTERVAL_MS, HERO_SLIDES } from "@/lib/travel/heroSlides";
import { ITINERARIES } from "@/lib/travel/discover";

vi.mock("next/link", () => ({ default: ({ children, ...p }: { children: React.ReactNode }) => <a {...p}>{children}</a> }));

// jsdom loads no images: an Image "loads" on the next tick unless its URL is listed as failing.
let failing = new Set<string>();
class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  decoding = "";
  set src(v: string) { setTimeout(() => (failing.has(v) ? this.onerror?.() : this.onload?.()), 0); }
}
let reducedMotion = false;
beforeEach(() => {
  vi.useFakeTimers();
  failing = new Set();
  resetHeroPreloadsForTests();
  reducedMotion = false;
  vi.stubGlobal("Image", FakeImage);
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q.includes("prefers-reduced-motion") ? reducedMotion : false,
    addEventListener() {}, removeEventListener() {},
  }));
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16) as unknown as number);
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const TRIPS: HeroTrip[] = ["tokyo", "bali", "rome"].map((d, i) => ({
  slug: `${d}-trip`, title: `Trip ${d}`, city: d, destinationSlug: d, summary: "s", style: "Culture",
  days: 3 + i, budgetUsd: 500 + i, stops: 4, photo: `/p/${d}.jpg`,
}));
const track = () => document.querySelector<HTMLElement>("[aria-roledescription=carousel] .flex")!;
const activeLabel = () => screen.getAllByRole("button", { name: /^Show trip/ }).findIndex((b) => b.getAttribute("aria-current") === "true");
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

describe("hero trip carousel", () => {
  it("auto-advances right-to-left every 5 s", () => {
    render(<HeroTripCard trips={TRIPS} />);
    expect(track().style.transform).toBe("translateX(-0%)");
    advance(HERO_CAROUSEL_INTERVAL_MS);
    expect(track().style.transform).toBe("translateX(-100%)");
    expect(activeLabel()).toBe(1);
  });

  it("loops from the last trip onto a copy of the first, then snaps back without a transition", () => {
    render(<HeroTripCard trips={TRIPS} />);
    for (let k = 0; k < 3; k++) advance(HERO_CAROUSEL_INTERVAL_MS);
    expect(track().style.transform).toBe("translateX(-300%)"); // the copy of trip 1
    expect(activeLabel()).toBe(0);
    // jsdom has no TransitionEvent; carry propertyName on a plain event as a browser would.
    const end = new Event("transitionend", { bubbles: true });
    Object.defineProperty(end, "propertyName", { value: "transform" });
    act(() => { track().dispatchEvent(end); });
    expect(track().style.transform).toBe("translateX(-0%)");
    expect(track().style.transition).toBe("none");
    advance(40); // two frames later the transition is back for the next move
    expect(track().style.transition).toContain("transform");
  });

  it("Previous from the first trip slides back to the last one", () => {
    render(<HeroTripCard trips={TRIPS} />);
    fireEvent.click(screen.getByRole("button", { name: "Previous trip" }));
    expect(track().style.transform).toBe("translateX(-300%)");
    advance(40);
    expect(track().style.transform).toBe("translateX(-200%)");
    expect(activeLabel()).toBe(2);
  });

  it("manual navigation restarts the 5 s clock", () => {
    render(<HeroTripCard trips={TRIPS} />);
    advance(HERO_CAROUSEL_INTERVAL_MS - 1000);
    fireEvent.click(screen.getByRole("button", { name: "Next trip" }));
    expect(activeLabel()).toBe(1);
    advance(HERO_CAROUSEL_INTERVAL_MS - 100);
    expect(activeLabel()).toBe(1);
    advance(200);
    expect(activeLabel()).toBe(2);
  });

  it("pauses while hovered and resumes after", () => {
    render(<HeroTripCard trips={TRIPS} />);
    const region = screen.getByRole("region", { name: "Popular trips" });
    fireEvent.mouseEnter(region);
    advance(HERO_CAROUSEL_INTERVAL_MS * 3);
    expect(activeLabel()).toBe(0);
    fireEvent.mouseLeave(region);
    advance(HERO_CAROUSEL_INTERVAL_MS);
    expect(activeLabel()).toBe(1);
  });

  it("does not autoplay or animate under reduced motion, but arrows still work", () => {
    reducedMotion = true;
    render(<HeroTripCard trips={TRIPS} />);
    advance(HERO_CAROUSEL_INTERVAL_MS * 3);
    expect(activeLabel()).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Previous trip" }));
    expect(activeLabel()).toBe(2);
    expect(track().style.transition).toBe("none");
  });

  it("only the visible card is reachable", () => {
    render(<HeroTripCard trips={TRIPS} />);
    const slides = document.querySelectorAll<HTMLElement>("[aria-roledescription=slide]");
    expect(slides).toHaveLength(4); // 3 trips + the loop copy
    expect([...slides].map((s) => s.inert)).toEqual([false, true, true, true]);
  });

  it("a dot jumps straight to its trip", () => {
    render(<HeroTripCard trips={TRIPS} />);
    fireEvent.click(screen.getByRole("button", { name: /^Show trip 3/ }));
    expect(activeLabel()).toBe(2);
  });
});

describe("hero background", () => {
  const Hero = () => <HeroMotionProvider><HeroBackdrop /><HeroLocationChip /><HeroTripCard trips={TRIPS} /></HeroMotionProvider>;
  const place = () => [...document.querySelectorAll("span")].find((el) => el.textContent?.startsWith("Background photo:"))!.textContent!;
  const settle = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

  it("starts on the first slide and cross-fades every 6 s once the next photo has loaded", async () => {
    render(<Hero />);
    expect(place()).toContain(`${HERO_SLIDES[0].place}, ${HERO_SLIDES[0].country}`);
    expect(document.querySelectorAll("picture")).toHaveLength(1);
    await settle(HERO_BACKDROP_INTERVAL_MS + 10);
    expect(place()).toContain(HERO_SLIDES[1].place);
    expect(document.querySelectorAll("picture")).toHaveLength(2); // incoming over outgoing
    await settle(1500);
    expect(document.querySelectorAll("picture")).toHaveLength(1); // outgoing removed after the fade
  });

  it("skips a photo that fails to load", async () => {
    failing.add(HERO_SLIDES[1].desktop);
    render(<Hero />);
    await settle(HERO_BACKDROP_INTERVAL_MS + 10);
    expect(place()).toContain(HERO_SLIDES[2].place);
  });

  it("the pause button stops the rotation", async () => {
    render(<Hero />);
    fireEvent.click(screen.getByRole("button", { name: "Pause background photos" }));
    await settle(HERO_BACKDROP_INTERVAL_MS * 3);
    expect(place()).toContain(HERO_SLIDES[0].place);
    expect(screen.getByRole("button", { name: "Play background photos" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("choosing a trip shows that destination behind the hero", async () => {
    render(<Hero />);
    fireEvent.click(screen.getByRole("button", { name: /^Show trip 3/ })); // rome
    await settle(10);
    expect(place()).toContain("Rome");
  });

  it("does not rotate under reduced motion", async () => {
    reducedMotion = true;
    render(<Hero />);
    await settle(HERO_BACKDROP_INTERVAL_MS * 2);
    expect(place()).toContain(HERO_SLIDES[0].place);
  });
});

describe("hero slide data", () => {
  it("every photo file exists and ids are unique", () => {
    const pub = join(__dirname, "../../../../../public");
    for (const s of HERO_SLIDES) {
      expect(existsSync(join(pub, s.desktop)), s.desktop).toBe(true);
      expect(existsSync(join(pub, s.mobile)), s.mobile).toBe(true);
    }
    expect(new Set(HERO_SLIDES.map((s) => s.id)).size).toBe(HERO_SLIDES.length);
  });
  it("every destination link points at a real itinerary destination", () => {
    const known = new Set(ITINERARIES.map((i) => i.destinationSlug));
    for (const s of HERO_SLIDES) if (s.destinationSlug) expect(known.has(s.destinationSlug), s.id).toBe(true);
  });
});
