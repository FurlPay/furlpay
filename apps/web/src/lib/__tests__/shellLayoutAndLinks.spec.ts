import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { APP_FRAME_PREFIXES, isAppFrame, isBare } from "../shellRoutes";

// Two regressions this file exists to prevent:
//
// 1. The phone-frame leak. Shell's original marketing allowlist meant every
//    unregistered page rendered inside a 440px app frame with a bottom tab
//    bar — /uk shipped that way to desktops. The classification is pinned
//    here in both directions, so flipping the polarity back (or forgetting
//    a carve-out) fails a test rather than a screenshot.
//
// 2. Broken navigation. Every internal href in the primary nav surfaces must
//    resolve to a real route in src/app or a declared redirect in
//    next.config — checked against the filesystem, not against a hand-kept
//    inventory that drifts.

const WEB_ROOT = path.resolve(__dirname, "..", "..", "..");
const APP_DIR = path.join(WEB_ROOT, "src", "app");

/** Resolve an internal href against the App Router tree, honouring dynamic
 *  segments ([slug]) at any depth. */
function routeExists(href: string): boolean {
  const clean = href.split(/[?#]/)[0].replace(/\/$/, "") || "/";
  if (clean === "/") return fs.existsSync(path.join(APP_DIR, "page.tsx"));
  const segs = clean.slice(1).split("/");
  let dirs = [APP_DIR];
  for (const seg of segs) {
    const next: string[] = [];
    for (const d of dirs) {
      const exact = path.join(d, seg);
      if (fs.existsSync(exact) && fs.statSync(exact).isDirectory()) next.push(exact);
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory() && /^\[.+\]$/.test(e.name)) next.push(path.join(d, e.name));
      }
    }
    if (next.length === 0) return false;
    dirs = next;
  }
  return dirs.some((d) => fs.existsSync(path.join(d, "page.tsx")));
}

/** Redirect sources declared in next.config — vanity paths like /discord are
 *  redirects by design (so the destination can change without stale caches),
 *  not missing routes. Parsed from source text rather than importing the
 *  config, which is async CJS wrapped in plugins. */
function redirectSources(): Set<string> {
  const file = ["next.config.js", "next.config.mjs"]
    .map((f) => path.join(WEB_ROOT, f))
    .find((f) => fs.existsSync(f));
  if (!file) return new Set();
  const src = fs.readFileSync(file, "utf8");
  return new Set([...src.matchAll(/source:\s*"(\/[^"]*)"/g)].map((m) => m[1]));
}

function hrefsIn(file: string): string[] {
  const src = fs.readFileSync(path.join(WEB_ROOT, file), "utf8");
  const out = [...src.matchAll(/(?:href[:=]\s*|")\s*"(\/[a-zA-Z0-9\-_/[\]#?=&.]*)"/g)].map((m) => m[1]);
  return [...new Set(out)].filter((h) => !h.startsWith("//"));
}

// The primary navigation surfaces. A page-body link can be judged in review;
// these four are global — a broken href here is broken on every page at once.
const NAV_SOURCES = [
  "src/components/landing/navigation.ts",
  "src/components/landing/LandingNav.tsx",
  "src/components/BottomNav.tsx",
  "src/app/page.tsx", // landing body + the sitewide footer
];

describe("navigation link integrity", () => {
  const redirects = redirectSources();

  for (const source of NAV_SOURCES) {
    it(`${source}: every internal href resolves to a route or declared redirect`, () => {
      const broken = hrefsIn(source).filter((h) => {
        const clean = h.split(/[?#]/)[0].replace(/\/$/, "") || "/";
        return !routeExists(h) && !redirects.has(clean);
      });
      expect(broken).toEqual([]);
    });
  }

  it("sanity: the resolver rejects a route that does not exist", () => {
    expect(routeExists("/definitely-not-a-route-9f3a")).toBe(false);
  });
});

describe("shell layout classification", () => {
  // Marketing pages must NEVER wear the phone frame. This list is exactly the
  // set that shipped broken under the old polarity — each one rendered a
  // mobile tab bar to desktop visitors.
  const MARKETING = [
    "/uk",
    "/ae",
    "/jp",
    "/solutions/hotels",
    "/solutions/airlines",
    "/solutions/ecommerce",
    "/solutions/enterprise",
    "/solutions/ai-agents",
    "/trust",
    "/contact",
    "/hotels",
    "/payouts",
    "/resources",
    "/support",
    "/events",
    "/downloads",
    "/integrations",
    "/compare/stripe",
    "/products/payments",
    "/pricing",
    "/careers",
    "/",
  ];
  for (const p of MARKETING) {
    it(`${p} renders full-bleed`, () => {
      expect(isAppFrame(p)).toBe(false);
    });
  }

  // The consumer app keeps its frame — every bottom-tab destination, plus the
  // companions that were designed for the 440px column.
  //
  // /markets is tested separately: the index and its list pages keep the frame,
  // but a ticker page underneath it does not.
  const APP = ["/dashboard", "/cards", "/investing", "/bills", "/profile", "/banking", "/swaps"];
  for (const p of APP) {
    it(`${p} keeps the phone frame`, () => {
      expect(isAppFrame(p)).toBe(true);
      expect(isAppFrame(`${p}/anything`)).toBe(true);
    });
  }

  it("desktop-grade subtrees carve back out of app prefixes", () => {
    expect(isAppFrame("/dashboard/terminal")).toBe(false);
    expect(isAppFrame("/investing/insights")).toBe(false);
    expect(isAppFrame("/investing/insights/some-post")).toBe(false);
  });

  describe("/markets", () => {
    it("keeps the phone frame for the index and its list pages", () => {
      expect(isAppFrame("/markets")).toBe(true);
      expect(isAppFrame("/markets/chains")).toBe(true);
      expect(isAppFrame("/markets/collections")).toBe(true);
      expect(isAppFrame("/markets/collections/ai")).toBe(true);
    });

    it("drops the frame for a ticker page, which is a two-column desktop surface", () => {
      // These render their own 440px column and tab bar below `lg`, so the
      // opt-out costs nothing on a phone — see markets/[symbol]/page.tsx.
      expect(isAppFrame("/markets/GOOGL")).toBe(false);
      expect(isAppFrame("/markets/AAPL")).toBe(false);
      expect(isAppFrame("/markets/BTC")).toBe(false);
    });

    it("treats a punctuated or lowercased ticker the same way", () => {
      // URLs get typed by hand and share classes carry a dot; neither may fall
      // back into the phone column just because of its spelling.
      expect(isAppFrame("/markets/BRK.B")).toBe(false);
      expect(isAppFrame("/markets/googl")).toBe(false);
    });
  });

  it("auth screens are bare: framed, but without status bar or tab bar", () => {
    expect(isBare("/login")).toBe(true);
    expect(isBare("/signup")).toBe(true);
    expect(isAppFrame("/login")).toBe(false); // bare handling is Shell's, not the frame set's
  });

  it("every app-frame prefix corresponds to a real route directory", () => {
    const missing = APP_FRAME_PREFIXES.filter(
      (p) => !fs.existsSync(path.join(APP_DIR, p.slice(1)))
    );
    expect(missing).toEqual([]);
  });
});
