import { readdirSync } from "fs";
import { join } from "path";
import { resolveDeepLink, HOME_ROUTE, FALLBACK_ROUTE } from "../deepLinks";

// ---------------------------------------------------------------------------
// Deep-link routing consistency. The app must NEVER land on Expo Router's
// "Unmatched Route" screen for a URI FurlPay itself generates (FCM payloads,
// OAuth/web handoffs, email/website links). This test:
//   1. derives the REAL native route set from the app/ file tree, and
//   2. asserts every resolveDeepLink() output matches a real route.
// If a route file is renamed/removed and a resolver target goes stale, this
// fails — the backend↔app deep-link contract cannot drift silently.
// ---------------------------------------------------------------------------

const APP_DIR = join(__dirname, "..", "..", "app");

/** Build regex matchers for every navigable route file under app/. */
function routeMatchers(): RegExp[] {
  const files: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(dir, e.name), `${prefix}${e.name}/`);
      else if (e.name.endsWith(".tsx") && !/^(_layout|\+not-found|\+html)/.test(e.name)) {
        files.push(`${prefix}${e.name.replace(/\.tsx$/, "")}`);
      }
    }
  };
  walk(APP_DIR, "");

  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return files.map((f) => {
    const segs = f.split("/");
    const parts: string[] = [];
    segs.forEach((s, i) => {
      if (s === "index") return; // index contributes nothing (parent path)
      if (/^\[.+\]$/.test(s)) parts.push("[^/]+"); // dynamic segment
      else parts.push(esc(s)); // literal (incl. "(group)")
      void i;
    });
    const pat = "/" + parts.join("/");
    return new RegExp(`^${pat === "/" ? "/" : pat.replace(/\/$/, "")}$`);
  });
}

const MATCHERS = routeMatchers();
const isRealRoute = (path: string) => path === "/" || MATCHERS.some((re) => re.test(path));

describe("deepLinks — every resolver target is a real native route", () => {
  it("sanity: the route tree produced matchers", () => {
    expect(MATCHERS.length).toBeGreaterThan(20);
    // Spot-check a few known routes resolve as real.
    for (const r of ["/approvals", "/transactions", "/wallet", "/notifications", "/(tabs)", "/(tabs)/cards"]) {
      expect(isRealRoute(r)).toBe(true);
    }
  });

  it("HOME and FALLBACK are real routes", () => {
    expect(isRealRoute(HOME_ROUTE)).toBe(true);
    expect(isRealRoute(FALLBACK_ROUTE)).toBe(true);
  });

  // The exact failure from the bug report + the class the user flagged.
  const cases: [string, string][] = [
    ["/auth/handoff", HOME_ROUTE], // the reported Unmatched Route
    ["furlpay:///auth/handoff", HOME_ROUTE], // triple-slash custom scheme
    ["furlpay://auth/handoff", HOME_ROUTE],
    ["https://furlpay.com/auth/handoff?code=x&next=/travel", HOME_ROUTE],
    ["/api/auth/anything", HOME_ROUTE],
    ["/support/tickets/123", "/support"], // extra segment → inbox
    ["/support/tkt_1", "/support/tkt_1"], // single id → detail route
    ["/cards/3ds/abc", "/approvals"],
    ["/cards/approve?challenge=z", "/approvals"],
    ["/wallet", "/wallet"],
    ["/travel/bookings/xyz", "/travel"],
    ["/transactions/tx_123", "/transactions"],
    ["/transaction/tx_123", "/transaction/tx_123"],
    ["/market/AAPL", "/market/AAPL"],
    ["/notifications", "/notifications"],
    // Address book. The single-segment form is a contact id OR the literal
    // "new" — both are real route files, so both resolve to themselves.
    ["/contacts", "/contacts"],
    ["/contacts/ct_9f2", "/contacts/ct_9f2"],
    ["/contacts/new", "/contacts/new"],
    // Anything deeper is not a route the app has, and must fall back rather
    // than reach Expo Router's unmatched screen.
    ["/contacts/ct_9f2/addresses/a1", FALLBACK_ROUTE],
    // Card lifecycle. The 3DS rules claim /cards/approve and /cards/3ds first —
    // a challenge notification must reach the approvals screen, never a card
    // management screen — and what is left resolves to the real card routes.
    ["/cards/approve", "/approvals"],
    ["/cards/3ds/ch_1", "/approvals"],
    ["/cards/order", "/cards/order"],
    ["/cards/card_abc123", "/cards/card_abc123"],
    ["/cards", "/(tabs)/cards"],
    ["/totally/unknown/thing", FALLBACK_ROUTE],
  ];

  it.each(cases)("resolveDeepLink(%s) → %s (a real route)", (input, expected) => {
    const out = resolveDeepLink(input);
    expect(out).toBe(expected);
    expect(isRealRoute(out)).toBe(true);
  });

  it("never returns an unmatched route for malformed/empty input", () => {
    for (const bad of ["", "   ", "not-a-path", "//", "///", "javascript:alert(1)", "file:///etc/passwd", null, undefined]) {
      const out = resolveDeepLink(bad as string);
      expect(isRealRoute(out)).toBe(true);
    }
  });
});
