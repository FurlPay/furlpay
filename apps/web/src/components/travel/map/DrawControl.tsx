"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { DrawMode } from "./useDrawArea";

// "Draw area" in the filter row: pick a polygon or a rectangle, then draw it on
// the map. Hotels are then searched inside that shape, server-side.

export default function DrawControl({
  mode,
  hasArea,
  onStart,
  onClear,
}: {
  mode: DrawMode | null;
  hasArea: boolean;
  onStart: (m: DrawMode) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>("button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btn.current?.focus();
      }
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !btn.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const active = hasArea || mode !== null;
  const pick = (m: DrawMode) => {
    setOpen(false);
    onStart(m);
  };

  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => {
          if (open) return setOpen(false);
          const r = btn.current?.getBoundingClientRect();
          if (r) setPos({ top: r.bottom + 8, left: Math.max(12, Math.min(r.left, window.innerWidth - 240)) });
          setOpen(true);
        }}
        className={`flex h-[38px] shrink-0 items-center gap-2 rounded-full border px-4 text-[13px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00E6A7] ${
          active
            ? "border-[#00E6A7] bg-[rgba(0,230,167,0.10)] text-[#00E6A7]"
            : "border-white/[0.10] bg-[#090D0E] text-[#D9DEDC] hover:border-white/[0.15] hover:bg-white/[0.055] hover:text-white"
        }`}
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden>
          <path d="M5 7l6-3 8 5-2 9-9 2z" />
        </svg>
        {mode ? "Drawing…" : hasArea ? "Drawn area" : "Draw area"}
      </button>
      {open && pos && (
        <div
          ref={menu}
          id={id}
          role="menu"
          aria-label="Draw a search area"
          className="fixed z-[70] w-[228px] rounded-[14px] border border-white/[0.10] bg-[#090D0E] p-1.5 shadow-[0_24px_60px_rgba(0,0,0,0.55)]"
          style={{ top: pos.top, left: pos.left }}
        >
          <button role="menuitem" type="button" onClick={() => pick("polygon")} className="flex w-full flex-col items-start rounded-lg px-3 py-2 text-left hover:bg-white/[0.05] focus-visible:bg-white/[0.06] focus-visible:outline-none">
            <span className="text-[13px] font-semibold text-white">Polygon</span>
            <span className="text-[11.5px] text-[#A4AAA9]">Click points; double-click to finish</span>
          </button>
          <button role="menuitem" type="button" onClick={() => pick("rectangle")} className="flex w-full flex-col items-start rounded-lg px-3 py-2 text-left hover:bg-white/[0.05] focus-visible:bg-white/[0.06] focus-visible:outline-none">
            <span className="text-[13px] font-semibold text-white">Rectangle</span>
            <span className="text-[11.5px] text-[#A4AAA9]">Click two opposite corners</span>
          </button>
          {hasArea && (
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                setOpen(false);
                onClear();
              }}
              className="mt-1 w-full rounded-lg border-t border-white/[0.06] px-3 py-2 text-left text-[13px] font-semibold text-[#A4AAA9] hover:bg-white/[0.05] hover:text-white focus-visible:bg-white/[0.06] focus-visible:outline-none"
            >
              Clear drawn area
            </button>
          )}
        </div>
      )}
    </>
  );
}
