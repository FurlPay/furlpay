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
  if (raw.startsWith("data:")) return isOwnedAvatarDataUrl(raw);
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return false;
    return ALLOWED_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

// ── Uploaded pictures ──────────────────────────────────────────────────────
//
// The provider-host allowlist above exists so this field cannot become an
// arbitrary URL rendered in an <img> on every page — a tracking pixel someone
// else controls. A `data:` URL does not reopen that hole, because there is no
// host: the bytes are the value, the browser fetches nothing, and no third
// party learns that the image was rendered. That is what makes an upload
// possible here without the object storage this app does not have.
//
// It is only safe with all four of these checks, and each closes a different
// door:
//
//   MEDIA TYPE — three raster formats. `image/svg+xml` is excluded on purpose:
//   SVG is a document format that can carry script, and while <img> does not
//   execute it, the same string stored here would execute if it were ever
//   opened directly or moved into an <object>.
//
//   MAGIC BYTES — the declared type must match what the payload actually is.
//   Without this, `data:image/png;base64,<anything>` is a store-arbitrary-bytes
//   endpoint wearing an image label.
//
//   SIZE — a hard decoded ceiling. This lands in a KV value read on every
//   profile request; an unbounded one is a denial-of-service against our own
//   read path, not just wasted space.
//
//   BASE64 SHAPE — rejected before decoding, so a malformed payload costs a
//   regex rather than a decode.

/** Decoded ceiling. A 256x256 JPEG at q0.82 is ~15KB; this is generous. */
export const MAX_AVATAR_BYTES = 64 * 1024;

const DATA_URL_RE = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/;

/** First bytes that must be present for each declared type. */
const MAGIC: Record<string, number[][]> = {
  "image/jpeg": [[0xff, 0xd8, 0xff]],
  "image/png": [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  // RIFF....WEBP — bytes 0-3 and 8-11, checked separately below.
  "image/webp": [[0x52, 0x49, 0x46, 0x46]],
};

function startsWith(buf: Buffer, sig: number[]): boolean {
  if (buf.length < sig.length) return false;
  return sig.every((b, i) => buf[i] === b);
}

/**
 * A picture we re-encoded ourselves, small enough to store inline.
 *
 * Returns false for anything that is not exactly a bounded raster data URL —
 * never throws, so it is safe to call on stored values of unknown provenance.
 */
export function isOwnedAvatarDataUrl(raw: string | null | undefined): boolean {
  if (typeof raw !== "string") return false;
  // Cheap length guard before the regex: base64 is ~4/3 of the decoded size.
  if (raw.length > MAX_AVATAR_BYTES * 2) return false;

  const m = DATA_URL_RE.exec(raw);
  if (!m) return false;
  const [, mediaType, payload] = m;

  let buf: Buffer;
  try {
    buf = Buffer.from(payload!, "base64");
  } catch {
    return false;
  }
  if (buf.length === 0 || buf.length > MAX_AVATAR_BYTES) return false;

  const sigs = MAGIC[mediaType!];
  if (!sigs || !sigs.some((s) => startsWith(buf, s))) return false;

  // WEBP needs its second marker too: "RIFF" alone is also AVI and WAV.
  if (mediaType === "image/webp") {
    const webp = [0x57, 0x45, 0x42, 0x50];
    if (buf.length < 12 || !webp.every((b, i) => buf[8 + i] === b)) return false;
  }

  return true;
}

/**
 * Store a picture the user uploaded.
 *
 * Unlike `setAvatarUrl` this one REPORTS failure: it is called from a request
 * the user is watching, and silently keeping the old face after they chose a
 * new one is worse than an error message.
 */
export async function setUploadedAvatar(userId: string, dataUrl: string): Promise<boolean> {
  if (!isOwnedAvatarDataUrl(dataUrl)) return false;
  try {
    await kvSet(key(userId), dataUrl);
    return true;
  } catch {
    return false;
  }
}

/** Remove the stored picture, falling the avatar back to initials. */
export async function clearAvatar(userId: string): Promise<boolean> {
  try {
    await kvDel(key(userId));
    return true;
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
