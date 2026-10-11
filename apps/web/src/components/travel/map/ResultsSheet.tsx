"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

// The results list's container. Desktop: the left column of the workspace.
// Phones: a bottom sheet over the map, with three snap points.
//
//   peek   just the heading — the map is the subject
//   half   the list and the map share the screen
//   full   the list, with a sliver of map above
//
// The mobile positioning is CSS (`max-lg:`), so the server render is already
// right and nothing jumps on hydration; JS only adds drag heights. The sheet
// sits ABOVE the map (z-30), so a drag on it never pans the map underneath,
// and the handle is a real button: Enter steps through the snap points.

export type SheetSnap = "peek" | "half" | "full";
const ORDER: SheetSnap[] = ["peek", "half", "full"];
const PEEK_PX = 148;

export function snapHeights(containerH: number): Record<SheetSnap, number> {
  const H = Math.max(containerH, PEEK_PX + 40);
  return { peek: PEEK_PX, half: Math.round(H * 0.55), full: H - 8 };
}

/**
 * Where a released drag settles. A fast flick moves one snap in its
 * direction; a slow release goes to the nearest snap.
 */
export function settleSnap(heightPx: number, velocityPxPerMs: number, containerH: number): SheetSnap {
  const hs = snapHeights(containerH);
  if (Math.abs(velocityPxPerMs) > 0.45) {
    // Positive velocity = finger moving DOWN = sheet shrinking.
    const above = ORDER.filter((s) => hs[s] > heightPx + 1);
    const below = ORDER.filter((s) => hs[s] < heightPx - 1);
    if (velocityPxPerMs > 0) return below.length ? below[below.length - 1] : "peek";
    return above.length ? above[0] : "full";
  }
  return ORDER.reduce((best, s) => (Math.abs(hs[s] - heightPx) < Math.abs(hs[best] - heightPx) ? s : best), "peek" as SheetSnap);
}

export default function ResultsSheet({
  snap,
  onSnap,
  label,
  children,
}: {
  snap: SheetSnap;
  onSnap: (s: SheetSnap) => void;
  /** The heading the handle names, e.g. "68 properties in view". */
  label: string;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [mobile, setMobile] = useState(false);
  const [containerH, setContainerH] = useState(0);
  const [dragH, setDragH] = useState<number | null>(null);
  const drag = useRef<{ startY: number; startH: number; lastY: number; lastT: number; v: number } | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023.98px)");
    const set = () => setMobile(mq.matches);
    set();
    mq.addEventListener("change", set);
    const parent = root.current?.parentElement;
    const ro = parent ? new ResizeObserver(() => setContainerH(parent.clientHeight)) : null;
    if (parent && ro) {
      ro.observe(parent);
      setContainerH(parent.clientHeight);
    }
    return () => {
      mq.removeEventListener("change", set);
      ro?.disconnect();
    };
  }, []);

  const heights = snapHeights(containerH);
  const current = dragH ?? heights[snap];

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { startY: e.clientY, startH: current, lastY: e.clientY, lastT: e.timeStamp, v: 0 };
    },
    [current]
  );
  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      const d = drag.current;
      if (!d) return;
      const dt = Math.max(1, e.timeStamp - d.lastT);
      d.v = (e.clientY - d.lastY) / dt;
      d.lastY = e.clientY;
      d.lastT = e.timeStamp;
      const h = Math.min(heights.full, Math.max(heights.peek - 40, d.startH - (e.clientY - d.startY)));
      setDragH(h);
    },
    [heights.full, heights.peek]
  );
  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      const d = drag.current;
      drag.current = null;
      if (!d) return;
      const moved = Math.abs(e.clientY - d.startY);
      setDragH(null);
      // A tap (no real movement) is a click — handled by onClick.
      if (moved < 6) return;
      onSnap(settleSnap(d.startH - (e.clientY - d.startY), d.v, containerH));
    },
    [containerH, onSnap]
  );

  return (
    <div
      ref={root}
      className="flex min-h-0 flex-col max-lg:absolute max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-30 max-lg:h-[148px] max-lg:overflow-hidden max-lg:rounded-t-[22px] max-lg:border-t max-lg:border-white/[0.10] max-lg:bg-[#030505] max-lg:shadow-[0_-16px_40px_rgba(0,0,0,0.5)] lg:w-[40%] lg:min-w-[400px] lg:max-w-[600px] lg:border-r lg:border-white/[0.08]"
      style={mobile && containerH ? { height: current, transition: dragH === null ? "height 260ms cubic-bezier(0.2,0.8,0.2,1)" : "none" } : undefined}
      data-sheet={mobile ? snap : undefined}
    >
      <button
        type="button"
        className="flex h-6 shrink-0 touch-none items-center justify-center lg:hidden focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#00E6A7]"
        aria-label={`${label}. ${snap === "full" ? "Collapse" : "Expand"} the results list`}
        aria-expanded={snap !== "peek"}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          drag.current = null;
          setDragH(null);
        }}
        onClick={() => onSnap(ORDER[(ORDER.indexOf(snap) + 1) % ORDER.length])}
      >
        <span className="h-1 w-10 rounded-full bg-white/25" aria-hidden />
      </button>
      {children}
    </div>
  );
}
