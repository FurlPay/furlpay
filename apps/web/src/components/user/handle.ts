// ---------------------------------------------------------------------------
// Display helpers for the profile header.
//
// ── WHY THESE ARE NOT IN THE PAGE FILE ─────────────────────────────────────
//
// They started there, and the production build rejected it: a Next App Router
// page module may export ONLY `default` and a fixed set of framework names
// (metadata, revalidate, dynamic, generateStaticParams, …). Any other export is
// a type error against a constraint generated into .next/types at build time —
// which means `tsc --noEmit` does not see it and neither does the test runner.
// The build is the only thing that catches it.
//
// So anything a page needs to share with a test lives in a module like this one.
// ---------------------------------------------------------------------------

/**
 * A display handle from the email local part.
 *
 * Derived from real data and deterministic — the same account always shows the
 * same handle. It is NOT a username: the account record has no handle field
 * (lib/accountApi.ts `setUsername` throws NotWiredError and explains that it
 * needs a column, a uniqueness constraint and a rename policy first), so
 * nothing built on this may imply the name can be claimed or reserved.
 */
export function deriveHandle(email: string | null | undefined): string | null {
  if (!email) return null;
  const local = email.split("@")[0] ?? "";
  const cleaned = local
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "")
    .replace(/^[._-]+|[._-]+$/g, "");
  // Two characters is the floor. A one-letter handle reads as a rendering bug
  // rather than as somebody's name.
  return cleaned.length >= 2 ? cleaned.slice(0, 30) : null;
}

/**
 * Shorten an address the way every wallet UI does.
 *
 * Both ends are kept because both ends are what a person actually checks when
 * comparing an address against another surface; a leading-only truncation is
 * useless for that.
 */
export function shortAddress(addr: string | null | undefined): string | null {
  if (!addr || addr.length < 12) return addr ?? null;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
