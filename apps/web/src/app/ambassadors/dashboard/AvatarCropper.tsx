"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ZoomIn, RotateCcw, Loader2 } from "lucide-react";

// Dependency-free avatar cropper: pick → zoom/drag to frame → export a square
// 256px WebP data URL, all in one dialog (no upload-check-retry cycle).
// Touch (pinch not required; drag + slider zoom) and keyboard accessible.

const VIEWPORT = 288; // on-screen crop circle diameter (px)
const OUTPUT = 256; // exported square size (px)

export default function AvatarCropper({
  file,
  onSave,
  onCancel,
}: {
  file: File;
  onSave: (dataUrl: string) => void;
  onCancel: () => void;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [baseScale, setBaseScale] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 }); // top-left of image in viewport space
  const [busy, setBusy] = useState(false);
  const drag = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);

  const scale = baseScale * zoom;

  const clamp = useCallback(
    (x: number, y: number, s: number, image: HTMLImageElement) => {
      const w = image.naturalWidth * s;
      const h = image.naturalHeight * s;
      return {
        x: Math.min(0, Math.max(VIEWPORT - w, x)),
        y: Math.min(0, Math.max(VIEWPORT - h, y)),
      };
    },
    []
  );

  // Load the picked file, fit it to cover the viewport, and center it.
  useEffect(() => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const base = Math.max(VIEWPORT / image.naturalWidth, VIEWPORT / image.naturalHeight);
      setImg(image);
      setBaseScale(base);
      setZoom(1);
      setPos({
        x: (VIEWPORT - image.naturalWidth * base) / 2,
        y: (VIEWPORT - image.naturalHeight * base) / 2,
      });
    };
    image.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Re-clamp when zoom changes, scaling about the viewport center.
  function changeZoom(next: number) {
    if (!img) return;
    const oldScale = baseScale * zoom;
    const newScale = baseScale * next;
    const cx = (VIEWPORT / 2 - pos.x) / oldScale;
    const cy = (VIEWPORT / 2 - pos.y) / oldScale;
    const nx = VIEWPORT / 2 - cx * newScale;
    const ny = VIEWPORT / 2 - cy * newScale;
    setZoom(next);
    setPos(clamp(nx, ny, newScale, img));
  }

  function onPointerDown(e: React.PointerEvent) {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, ox: pos.x, oy: pos.y };
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current || !img) return;
    const nx = drag.current.ox + (e.clientX - drag.current.px);
    const ny = drag.current.oy + (e.clientY - drag.current.py);
    setPos(clamp(nx, ny, scale, img));
  }
  function onPointerUp() {
    drag.current = null;
  }

  function nudge(dx: number, dy: number) {
    if (!img) return;
    setPos((p) => clamp(p.x + dx, p.y + dy, scale, img));
  }

  function reset() {
    if (!img) return;
    setZoom(1);
    setPos({
      x: (VIEWPORT - img.naturalWidth * baseScale) / 2,
      y: (VIEWPORT - img.naturalHeight * baseScale) / 2,
    });
  }

  function save() {
    if (!img) return;
    setBusy(true);
    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT;
    canvas.height = OUTPUT;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setBusy(false);
      return;
    }
    ctx.imageSmoothingQuality = "high";
    const ratio = OUTPUT / VIEWPORT;
    ctx.drawImage(
      img,
      pos.x * ratio,
      pos.y * ratio,
      img.naturalWidth * scale * ratio,
      img.naturalHeight * scale * ratio
    );
    // Prefer WebP; browsers without WebP encoding fall back to PNG automatically.
    let out = canvas.toDataURL("image/webp", 0.85);
    if (!out.startsWith("data:image/webp")) out = canvas.toDataURL("image/png");
    onSave(out);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4" role="dialog" aria-modal="true" aria-label="Crop your photo">
      <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-charcoal p-6">
        <h3 className="text-[17px] font-bold text-textPrimary">Position your photo</h3>
        <p className="mt-1 text-[13px] text-textSecondary">Drag to reposition, zoom to frame your face.</p>

        <div className="mt-5 flex justify-center">
          <div
            className="relative touch-none overflow-hidden rounded-full ring-2 ring-neon/40"
            style={{ width: VIEWPORT, height: VIEWPORT }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
            tabIndex={0}
            onKeyDown={(e) => {
              const step = 8;
              if (e.key === "ArrowLeft") nudge(step, 0);
              else if (e.key === "ArrowRight") nudge(-step, 0);
              else if (e.key === "ArrowUp") nudge(0, step);
              else if (e.key === "ArrowDown") nudge(0, -step);
              else return;
              e.preventDefault();
            }}
            aria-label="Crop area — arrow keys to reposition"
          >
            {img ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={img.src}
                alt=""
                draggable={false}
                className="pointer-events-none absolute max-w-none select-none"
                style={{
                  left: pos.x,
                  top: pos.y,
                  width: img.naturalWidth * scale,
                  height: img.naturalHeight * scale,
                }}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-neon" />
              </div>
            )}
          </div>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <ZoomIn className="h-4 w-4 flex-shrink-0 text-textSecondary" />
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={(e) => changeZoom(parseFloat(e.target.value))}
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-neon"
            aria-label="Zoom"
          />
          <button onClick={reset} aria-label="Reset" className="flex-shrink-0 text-textSecondary hover:text-textPrimary">
            <RotateCcw className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-6 flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 rounded-pill border border-white/15 py-3 text-[14px] font-semibold text-textPrimary transition-colors hover:border-white/40"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={!img || busy}
            className="flex flex-1 items-center justify-center gap-2 rounded-pill bg-neon py-3 text-[14px] font-semibold text-black disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
