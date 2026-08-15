// Which routes wear the phone-frame app chrome (centered 440px column, status
// bar, bottom tab bar) — and, by omission, which render full-bleed.
//
// Inverted from the original design on purpose. The first version kept an
// allowlist of MARKETING routes, and everything not on it got the phone frame.
// Marketing pages now outnumber app pages several times over, so that polarity
// guaranteed drift: every new landing page that forgot to register itself
// rendered inside a phone frame on desktop — which is exactly how /uk,
// /solutions/*, /trust and a dozen others shipped with a mobile tab bar at
// 1440px.
//
// So the APP is the explicit set, and full-bleed is the default. The app
// surface is small and stable — the five tab destinations and their close
// companions — and a brand-new marketing page can no longer inherit the frame
// by accident. Forgetting to register a new APP page fails harmlessly (a
// full-bleed page), instead of a marketing page wearing a phone costume.
//
// Pinned by lib/__tests__/shellLayoutAndLinks.spec.ts.

export const APP_FRAME_PREFIXES = [
  "/dashboard", // consumer wallet home (/dashboard/terminal opts back out below)
  "/cards",
  "/investing", // except /investing/insights — the Research portal is blog-style
  "/bills",
  "/profile",
  "/banking",
  "/chat",
  "/contacts",
  "/credit",
  "/earn",
  "/rewards",
  "/analytics",
  "/markets",
  "/swaps",
  "/auth",
  "/oauth", // MCP consent screens — built for the 440px column
] as const;

export function isAppFrame(pathname: string): boolean {
  // Desktop-grade subtrees inside app prefixes keep their full-bleed carve-outs.
  if (pathname.startsWith("/dashboard/terminal")) return false; // dense multi-column terminal
  if (pathname.startsWith("/investing/insights")) return false; // Research portal (blog-style)
  return APP_FRAME_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

/** Auth screens keep the frame but hide the status bar / tab bar chrome. */
export function isBare(pathname: string): boolean {
  return pathname === "/login" || pathname === "/signup";
}
