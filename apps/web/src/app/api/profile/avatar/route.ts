import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { validateBody } from "@/lib/validate";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { audit } from "@/lib/audit";
import {
  MAX_AVATAR_BYTES,
  clearAvatar,
  isOwnedAvatarDataUrl,
  setUploadedAvatar,
} from "@/lib/profileAvatar";

// ---------------------------------------------------------------------------
// PUT/DELETE /api/profile/avatar — the user's own profile picture.
//
// ── WHY A DATA URL AND NOT AN UPLOAD ───────────────────────────────────────
//
// There is no object storage on this deployment — no Blob, no S3, no Supabase
// Storage — which is why `accountApi.uploadAvatar` throws NotWiredError and
// says so. Rather than pretend a bucket exists, the picture is cropped and
// re-encoded IN THE BROWSER to a small square and stored inline.
//
// That is not a workaround with a hidden cost; it changes the threat model for
// the better. The bytes never touch a third-party host, nothing is fetched when
// the avatar renders, and the canvas re-encode drops EXIF as a side effect —
// which is the specific thing the original TODO said an upload would need to do
// (a phone photo carries GPS coordinates).
//
// ── WHAT THIS ENDPOINT STILL HAS TO ENFORCE ────────────────────────────────
//
// The client doing the re-encode is not a security control: anyone can POST
// whatever they like here. `isOwnedAvatarDataUrl` re-checks the media type, the
// magic bytes and the decoded size server-side, and this route refuses anything
// that fails — see lib/profileAvatar.ts for why each check exists.
//
// PUT rather than POST: setting an avatar is idempotent — the same picture sent
// twice leaves the account in the same state.
// ---------------------------------------------------------------------------

/**
 * The body schema.
 *
 * `.max()` here is a cheap pre-filter so an oversized payload is rejected by
 * the schema instead of being base64-decoded first; the authoritative size
 * check is the decoded one inside `isOwnedAvatarDataUrl`.
 */
const AvatarBody = z
  .object({
    dataUrl: z
      .string()
      .min(32, "Not an image")
      .max(MAX_AVATAR_BYTES * 2, "Image is too large")
      .refine((v) => v.startsWith("data:image/"), "Only an image can be uploaded"),
  })
  .strict();

export async function PUT(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  // Tighter than the mutating baseline: each call writes a ~20KB KV value, and
  // there is no legitimate reason to change a profile picture in a loop.
  const limited = await rateLimitOr429(req, "profile.avatar", { limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  const body = await validateBody(req, AvatarBody);
  if (body instanceof NextResponse) return body;

  // The real gate. The client's crop is a convenience; this is the control.
  if (!isOwnedAvatarDataUrl(body.dataUrl)) {
    return NextResponse.json(
      {
        error: "invalid_image",
        detail:
          "The picture must be a JPEG, PNG or WEBP under " +
          `${Math.round(MAX_AVATAR_BYTES / 1024)}KB once decoded.`,
      },
      { status: 400 }
    );
  }

  const u = auth.account.user;
  const stored = await setUploadedAvatar(u.id, body.dataUrl);
  if (!stored) {
    return NextResponse.json(
      { error: "storage_unavailable", detail: "Could not save the picture. Try again." },
      { status: 503 }
    );
  }

  // Size only — the payload is the user's face and has no business in a log.
  audit("profile.updated", u.id, { field: "avatar", bytes: body.dataUrl.length });

  return NextResponse.json({ success: true, avatarUrl: body.dataUrl });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const limited = await rateLimitOr429(req, "profile.avatar", { limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  const u = auth.account.user;
  const cleared = await clearAvatar(u.id);
  if (!cleared) {
    return NextResponse.json(
      { error: "storage_unavailable", detail: "Could not remove the picture. Try again." },
      { status: 503 }
    );
  }

  audit("profile.updated", u.id, { field: "avatar", bytes: 0 });
  return NextResponse.json({ success: true, avatarUrl: null });
}
