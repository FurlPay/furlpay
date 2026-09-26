// ---------------------------------------------------------------------------
// Validation for the links the support assistant cites.
//
// OWASP LLM10:2026 Improper Output Handling. Today every href comes from
// `kb.ts`, which ships in the repo — so nothing hostile reaches this function
// yet. It exists because of what sits downstream: the client renders each
// source with `<Link href={a.href}>`, and `next/link` passes an href through to
// an anchor essentially untouched. The moment a source href comes from anywhere
// less trusted than a committed constant — a model asked to emit its own
// citations, a KB loaded from a CMS, an admin-editable article — that render is
// a navigation primitive pointed at attacker-chosen text.
//
// The dangerous shapes, in the order they actually bite:
//
//   //evil.com/login      protocol-relative. React does NOT block this, and it
//                         is a fully working off-site navigation that looks
//                         root-relative to a careless reviewer. This is the
//                         realistic phishing vector, not `javascript:`.
//   javascript:alert(1)   React 18 warns and blocks on render, but relying on a
//                         framework warning as the security boundary is wrong,
//                         and the warning has changed behaviour across versions.
//   data:text/html,…      renders attacker HTML in our origin's context.
//   https://evil.com      off-site. Legitimate for a docs link, but the support
//                         assistant has no reason to cite anything off-site, so
//                         allowing it only widens the surface.
//
// The whitelist is therefore deliberately narrow: a single-slash, root-relative
// path under one of the prefixes the help centre actually publishes.
// ---------------------------------------------------------------------------

export interface SupportSourceLike {
  title: string;
  href: string;
}

/** Path prefixes the help centre publishes under. Anything else is not a source. */
const ALLOWED_PREFIXES = ["/docs/", "/support/", "/travel/help/", "/legal/"];

/**
 * True when `href` is a root-relative path under a published help prefix.
 *
 * Rejects protocol-relative (`//host`), any scheme, backslash-escaped variants
 * that some parsers normalise to a slash, control characters, and traversal.
 */
export function isSafeSourceHref(href: unknown): href is string {
  if (typeof href !== "string") return false;
  const h = href.trim();

  // Must be root-relative, and the second character must NOT be another slash
  // or a backslash — `//evil.com` and `/\evil.com` both navigate off-site.
  if (!h.startsWith("/")) return false;
  if (h.length < 2) return false;
  if (h[1] === "/" || h[1] === "\\") return false;

  // No control characters (a raw newline or NUL can split a header or confuse
  // a parser), no backslash, no traversal, no scheme smuggled after the slash.
  // NB: hyphens are legal and common - every real KB slug has one.
  if (/[\x00-\x1f\x7f]/.test(h)) return false;
  if (h.includes("\\")) return false;
  if (h.includes("..")) return false;
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(h)) return false;

  return ALLOWED_PREFIXES.some((p) => h.startsWith(p));
}

/**
 * Drop any citation whose href is not a safe help-centre path.
 *
 * Dropping rather than rewriting is deliberate: a citation that does not
 * resolve to a real article is not a citation, and silently repointing it at
 * `/support` would fabricate provenance for a claim.
 */
export function safeSources<T extends SupportSourceLike>(sources: readonly T[] | undefined): T[] {
  if (!Array.isArray(sources)) return [];
  return sources.filter((s) => s && typeof s.title === "string" && isSafeSourceHref(s.href));
}
