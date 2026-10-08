// ---------------------------------------------------------------------------
// The one redirect-target validator. Every "send the user back to ?next=…"
// goes through here (login page, dev session, auth handoff, support SSO).
//
// Prefix checks (`startsWith("/") && !startsWith("//")`) are not enough: the
// WHATWG URL parser strips ASCII tab/LF/CR anywhere and treats "\" as "/" for
// http(s), so "/\evil.com", "/<TAB>/evil.com", "/<LF>/evil.com" all resolve to
// evil.com. A resolved PATH can also start with "//" ("/.//evil.com" resolves
// on our origin to pathname "//evil.com"), and a caller that navigates to that
// path string lands on evil.com. So:
//   1. refuse control characters and backslashes outright;
//   2. resolve once against the trusted origin and require the same origin;
//   3. refuse a resolved path that starts with "//";
//   4. hand back a path built from the RESOLVED URL, never the raw input.
// ---------------------------------------------------------------------------

const MAX_LENGTH = 512;
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u001f\u007f\\]/;

/** The resolved same-origin URL for `raw`, or null when it is not a safe in-app target. */
export function resolveSameOrigin(raw: string | null | undefined, origin: string): URL | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_LENGTH) return null;
  if (!raw.startsWith("/") || UNSAFE.test(raw)) return null;
  let base: URL;
  let u: URL;
  try {
    base = new URL(origin);
    u = new URL(raw, base);
  } catch {
    return null;
  }
  if (u.origin !== base.origin) return null;
  if (u.pathname.startsWith("//")) return null;
  return u;
}

/** A path ("/a/b?c#d") safe to navigate to on `origin`, or `fallback`. */
export function safeRedirectPath(raw: string | null | undefined, origin: string, fallback = "/"): string {
  const u = resolveSameOrigin(raw, origin);
  return u ? `${u.pathname}${u.search}${u.hash}` : fallback;
}

/** A URL safe to redirect to on `origin`, or `origin + fallback`. */
export function safeRedirectUrl(raw: string | null | undefined, origin: string, fallback = "/"): URL {
  return resolveSameOrigin(raw, origin) ?? new URL(fallback, origin);
}
