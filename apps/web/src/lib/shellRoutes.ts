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
  "/bills",
  "/profile",
  "/banking",
  "/chat",
  "/contacts",
  "/credit",
  "/earn",
  "/rewards",
  "/spending",
  "/markets",
  "/swaps",
  "/auth",
  "/oauth", // MCP consent screens — built for the 440px column
  "/notifications", // per-user feed, reads as a phone-column list
] as const;

/** Sub-pages of /markets that are LISTS, and keep the phone column. Anything
 *  else one segment under /markets is a ticker. */
const MARKETS_LIST_PAGES = new Set(["chains", "collections"]);

/** `/markets/AAPL` — a ticker detail page, not a list. */
function isSymbolPage(pathname: string): boolean {
  const parts = pathname.split("/").filter(Boolean);
  return parts.length === 2 && parts[0] === "markets" && !MARKETS_LIST_PAGES.has(parts[1]!);
}

export function isAppFrame(pathname: string): boolean {
  // Desktop-grade subtrees inside app prefixes keep their full-bleed carve-outs.
  // The wallet home is a balance hero, a quick-action grid, a card carousel and
  // an activity feed. In the 440px column those sat in a strip on a monitor
  // while the Deposit flow that opens over them is full-width; it supplies its
  // own sidebar and tab bar now. (/dashboard/terminal was always full-bleed.)
  if (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) return false;
  // /investing/insights — the Research portal, blog-style and full-bleed. The
  // /investing hub itself was retired in favour of /portfolio, so this prefix
  // now only ever matches the research subtree.
  if (pathname.startsWith("/investing")) return false;
  // Bills is a list of payable cards plus an off-ramp form. In the phone column
  // the cards were one per row on a monitor with the provider name, the due
  // date, an autopay switch and a pay button crammed into 440px; they tile now.
  if (pathname === "/bills" || pathname.startsWith("/bills/")) return false;
  // The portfolio workstation supplies its own three-column chrome (rail,
  // header, research column) and cannot live in a 440px strip.
  if (pathname === "/portfolio" || pathname.startsWith("/portfolio/")) return false;
  // Account settings is a desktop-grade surface: a section index beside seven
  // blocks of label/value rows, several of which (a wallet address, a session's
  // device + location + last-active line) wrap onto three lines in a 440px
  // column. It supplies its own header and stacks to one column below `xl`.
  if (pathname === "/profile" || pathname.startsWith("/profile/")) return false;
  // A ticker page is a two-column desktop surface — chart plus a trading rail —
  // that cannot live in a 440px column. It renders its own phone layout and tab
  // bar below `lg`, so opting out here costs nothing on mobile.
  //
  // Only the ticker page: /markets, /markets/chains and /markets/collections/*
  // are scrolling lists that read fine in the phone column and keep it.
  if (isSymbolPage(pathname)) return false;
  // A world map cannot live in a 440px column.
  if (pathname.startsWith("/hotels/map")) return false;
  // The WHOLE /markets subtree is full-bleed, not just the index and the
  // tickers. /markets/chains and /markets/collections/* used to keep the phone
  // column, which meant clicking "Chains" from the desktop terminal dropped the
  // reader into a 440px strip centred on a 1440px monitor — the same two-
  // products mismatch the index and the ticker page had, on the routes the
  // migration did not reach. Each supplies its own layout and tab bar below
  // `lg`, exactly as the other two do.
  if (pathname === "/markets" || pathname.startsWith("/markets/")) return false;
  return APP_FRAME_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

/** Auth screens: no status bar, no tab bar, and no phone column either.
 *
 * These used to render inside the 440px frame with its chrome hidden, which on
 * a desktop monitor is a narrow strip of form fields floating in black — the
 * layout reads as an unfinished mobile page rather than as a sign-in surface.
 * They are now full-bleed and centre their own card, so the same markup is a
 * proper full-screen experience on a monitor and unchanged on a phone.
 */
export function isBare(pathname: string): boolean {
  return pathname === "/login" || pathname === "/signup";
}
