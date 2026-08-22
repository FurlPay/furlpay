// ---------------------------------------------------------------------------
// The profile picture behind the top-right avatar.
//
// There is no object storage configured in this app — no Vercel Blob, no S3
// bucket, no Supabase Storage — so there is nothing to upload a file INTO, and
// this module deliberately does not pretend otherwise. What it does hold is the
// URL of a picture the user's identity provider already hosts: Google returns
// one in the verified ID token, and using it is the difference between showing
// someone their own face and showing them two letters.
//
// Stored in the durable KV rather than on the account row for the same reason
// as the watchlist (see lib/watchlist.ts): the account schema is relational and
// a new column is a migration that is not applied anywhere yet. Losing the key
// costs an avatar, and the initials fall back underneath it.
//
// Only https URLs on a provider host we actually authenticate against are
// stored. Without that check this becomes an arbitrary-URL field rendered in an
// <img> on every page — a tracking pixel someone else controls.
// ---------------------------------------------------------------------------

import { kvDel, kvGet, kvSet } from "@/lib/kv";

const key = (userId: string) => `profile:avatar:${userId}`;

/** Hosts whose avatar URLs we will render. Google serves profile photos from
 *  lh3..lh6.googleusercontent.com; Apple returns no picture at all. */
const ALLOWED_HOSTS = [/^lh\d\.googleusercontent\.com$/, /^googleusercontent\.com$/];

export function isAllowedAvatarUrl(raw: string | null | undefined): boolean {
  if (!raw) return false;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return false;
    return ALLOWED_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

/** The stored avatar URL, or null. Never throws — a KV outage means initials. */
export async function getAvatarUrl(userId: string): Promise<string | null> {
  try {
    const stored = await kvGet<string>(key(userId));
    return isAllowedAvatarUrl(stored) ? stored : null;
  } catch {
    return null;
  }
}

/**
 * Record the picture an identity provider returned at sign-in.
 *
 * Best-effort by design: this is called from the login path, and a KV write
 * failing must not fail a login. A rejected or absent URL clears any stored
 * one, so unlinking a provider does not leave a stale face behind.
 */
export async function setAvatarUrl(userId: string, url: string | null | undefined): Promise<void> {
  try {
    if (isAllowedAvatarUrl(url)) await kvSet(key(userId), url);
    else await kvDel(key(userId));
  } catch {
    // The avatar falls back to initials. Nothing here is worth failing a login.
  }
}

/**
 * Up to two initials for the fallback avatar.
 *
 * Derived from the real display name — never a placeholder like "JD". An
 * account with no name at all yields null, and the caller draws a neutral
 * silhouette rather than a letter that stands for nothing.
 */
export function initialsFor(name: string | null | undefined): string | null {
  const parts = (name ?? "")
    .trim()
    .split(/\s+/)
    .filter((p) => /\p{L}/u.test(p));
  if (parts.length === 0) return null;
  const first = [...parts[0]][0] ?? "";
  const last = parts.length > 1 ? ([...parts[parts.length - 1]][0] ?? "") : "";
  const out = (first + last).toUpperCase();
  return out || null;
}
