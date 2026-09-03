"use client";

import { useCallback, useRef, useState } from "react";
import { Camera, Loader2, Trash2 } from "lucide-react";
import UserAvatar from "./UserAvatar";

// ---------------------------------------------------------------------------
// Choosing, cropping and saving a profile picture.
//
// ── THE CROP IS A CENTRE SQUARE, DONE ON A CANVAS ──────────────────────────
//
// The uploaded file is almost never square. Two ways to deal with that, and
// only one of them is honest:
//
//   Squash it into a square box. Every face comes out stretched.
//   Take the largest CENTRED SQUARE and scale that. Portraits and landscapes
//   both come out as the same circle with the middle showing.
//
// This does the second, on a canvas, which also means the bytes we store are
// bytes we produced: fixed dimensions, fixed format, and — as a side effect
// that matters more than the crop — no EXIF. A photo straight off a phone
// carries GPS coordinates, and storing one verbatim would put the user's home
// address in their avatar.
//
// ── WHY THE PREVIEW IS THE REAL COMPONENT ──────────────────────────────────
//
// The preview is a `UserAvatar`, not a bespoke <img>. If the crop is wrong it
// is wrong here in exactly the way it will be wrong in the header, so there is
// no surface where a bug can hide.
//
// ── EVERY FAILURE IS SHOWN ─────────────────────────────────────────────────
//
// A picture that silently fails to save is worse than one that refuses: the
// user walks away believing it worked. Decode failures, oversize results and
// server rejections all surface inline.
// ---------------------------------------------------------------------------

/** Output edge. 256 is Discord/Slack-class: sharp on a 128px retina header. */
const OUTPUT_PX = 256;

/** Quality to try first, then step down if the result is still too big. */
const QUALITY_STEPS = [0.82, 0.7, 0.58];

/** Must match MAX_AVATAR_BYTES in lib/profileAvatar.ts. */
const MAX_BYTES = 64 * 1024;

/** What the file picker will accept. Kept in step with the server's allowlist. */
const ACCEPT = "image/jpeg,image/png,image/webp";

/** Rough decoded size of a base64 data URL, without decoding it. */
export function dataUrlBytes(dataUrl: string): number {
  const i = dataUrl.indexOf(",");
  if (i === -1) return 0;
  const b64 = dataUrl.slice(i + 1);
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

/**
 * Largest centred square of a source image, as {sx, sy, size}.
 *
 * Pure so the arithmetic is testable without a canvas — the off-by-one that
 * shifts every face slightly left is exactly the kind of bug that survives a
 * visual check.
 */
export function centreSquare(width: number, height: number): { sx: number; sy: number; size: number } {
  const size = Math.min(width, height);
  return {
    sx: Math.max(0, Math.round((width - size) / 2)),
    sy: Math.max(0, Math.round((height - size) / 2)),
    size,
  };
}

async function fileToImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("decode"));
      img.src = url;
    });
  } finally {
    // Revoked whatever happened: a leaked object URL pins the whole file in
    // memory for the life of the document.
    URL.revokeObjectURL(url);
  }
}

/** Centre-crop and re-encode to a bounded JPEG data URL. */
async function cropToDataUrl(file: File): Promise<string> {
  const img = await fileToImage(file);
  const { sx, sy, size } = centreSquare(img.naturalWidth, img.naturalHeight);

  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_PX;
  canvas.height = OUTPUT_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  // Better downscaling than the default on large source photos.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, sx, sy, size, size, 0, 0, OUTPUT_PX, OUTPUT_PX);

  for (const q of QUALITY_STEPS) {
    const out = canvas.toDataURL("image/jpeg", q);
    if (dataUrlBytes(out) <= MAX_BYTES) return out;
  }
  throw new Error("too-large");
}

export interface ProfileImageUploaderProps {
  name?: string | null;
  initials?: string | null;
  avatarUrl?: string | null;
  /** Called with the new URL (or null after a removal) so the page can update. */
  onChange?: (avatarUrl: string | null) => void;
}

export default function ProfileImageUploader({
  name,
  initials,
  avatarUrl,
  onChange,
}: ProfileImageUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shown = preview ?? avatarUrl ?? null;

  const save = useCallback(
    async (dataUrl: string) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/profile/avatar", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dataUrl }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { detail?: string } | null;
          setError(body?.detail ?? "Could not save the picture.");
          setPreview(null);
          return;
        }
        onChange?.(dataUrl);
      } catch {
        setError("Could not reach the server.");
        setPreview(null);
      } finally {
        setBusy(false);
      }
    },
    [onChange]
  );

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset immediately so choosing the SAME file again still fires a change.
    e.target.value = "";
    if (!file) return;

    setError(null);
    if (!ACCEPT.split(",").includes(file.type)) {
      setError("Choose a JPEG, PNG or WEBP image.");
      return;
    }

    setBusy(true);
    try {
      const dataUrl = await cropToDataUrl(file);
      // Optimistic: the crop is already what will be stored, so showing it
      // before the round-trip is showing the truth, not a guess.
      setPreview(dataUrl);
      await save(dataUrl);
    } catch (err) {
      setBusy(false);
      setError(
        (err as Error).message === "too-large"
          ? "That image could not be compressed small enough. Try a smaller one."
          : "That file could not be read as an image."
      );
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/profile/avatar", { method: "DELETE" });
      if (!res.ok) {
        setError("Could not remove the picture.");
        return;
      }
      setPreview(null);
      onChange?.(null);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-4">
      <div className="relative shrink-0">
        <UserAvatar name={name} initials={initials} avatarUrl={shown} size="xl" ring />
        {busy && (
          <span
            className="absolute inset-0 grid place-items-center rounded-full bg-black/55"
            aria-hidden
          >
            <Loader2 className="h-5 w-5 animate-spin text-white" />
          </span>
        )}
      </div>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3.5 py-1.5 text-[12.5px] font-semibold text-white transition-colors hover:border-white/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40 disabled:opacity-60"
          >
            <Camera className="h-[14px] w-[14px]" aria-hidden />
            {shown ? "Change picture" : "Upload picture"}
          </button>

          {shown && (
            <button
              type="button"
              disabled={busy}
              onClick={remove}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1.5 text-[12.5px] font-medium text-textSecondary transition-colors hover:border-loss/40 hover:text-loss focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-loss/50 disabled:opacity-60"
            >
              <Trash2 className="h-[14px] w-[14px]" aria-hidden />
              Remove
            </button>
          )}
        </div>

        <p className="mt-2 text-[11.5px] leading-relaxed text-textMuted">
          JPEG, PNG or WEBP. Cropped to a centred square and resized to {OUTPUT_PX}×{OUTPUT_PX};
          location data in the original is discarded.
        </p>

        {error && (
          <p role="alert" className="mt-1.5 text-[12px] font-medium text-loss">
            {error}
          </p>
        )}

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          onChange={onPick}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
        />
      </div>
    </div>
  );
}
