"use client";

import { useEffect, useId, useRef, useState } from "react";
import { RADIUS_OPTIONS_KM, type RadiusKm, type RadiusQuery } from "@/lib/hotels/radius";
import type { LatLng } from "@/lib/geo/geodesy";

// Radius search, in the filter row: "hotels within N km of …". The centre is
// something real the reader chose — the map centre, the open hotel, or their
// own location — and the radii are the closed set the server accepts.

export interface RadiusCentre {
  label: string;
  point: LatLng;
}

export default function RadiusControl({
  radius,
  label,
  centres,
  onApply,
  onClear,
}: {
  radius: RadiusQuery | null;
  /** What the active circle is around, e.g. "Four Seasons Hotel Tokyo". */
  label: string;
  /** Candidate centres, first is the default. */
  centres: RadiusCentre[];
  onApply: (r: RadiusQuery, label: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [km, setKm] = useState<RadiusKm>(radius?.km ?? 2);
  const [centreIdx, setCentreIdx] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();

  function toggle() {
    if (open) return setOpen(false);
    setKm(radius?.km ?? 2);
    setCentreIdx(0);
    const r = btn.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 8, left: Math.max(12, Math.min(r.left, window.innerWidth - 300)) });
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>("input,button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btn.current?.focus();
      }
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !btn.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const chip = radius ? `Within ${radius.km} km` : "Radius";

  return (
    <>
      <button
        ref={btn}
        type="button"
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        title={radius ? `Within ${radius.km} km of ${label}` : "Search within a radius"}
        className={`flex h-[38px] shrink-0 items-center gap-2 rounded-full border px-4 text-[13px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00E6A7] ${
          radius
            ? "border-[#00E6A7] bg-[rgba(0,230,167,0.10)] text-[#00E6A7]"
            : "border-white/[0.10] bg-[#090D0E] text-[#D9DEDC] hover:border-white/[0.15] hover:bg-white/[0.055] hover:text-white"
        }`}
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <circle cx="12" cy="12" r="8.5" strokeDasharray="3 2.4" />
          <circle cx="12" cy="12" r="1.8" fill="currentColor" />
        </svg>
        {chip}
      </button>

      {open && pos && (
        <div
          ref={panel}
          id={id}
          role="dialog"
          aria-label="Search within a radius"
          className="fixed z-[70] w-[288px] rounded-[16px] border border-white/[0.10] bg-[#090D0E] p-4 shadow-[0_24px_60px_rgba(0,0,0,0.55)]"
          style={{ top: pos.top, left: pos.left }}
        >
          <fieldset>
            <legend className="mb-2 text-[11.5px] font-medium text-[#A4AAA9]">Distance</legend>
            <div className="flex flex-wrap gap-1.5">
              {RADIUS_OPTIONS_KM.map((k) => (
                <label key={k} className="cursor-pointer">
                  <input type="radio" name={`${id}-km`} className="peer sr-only" checked={km === k} onChange={() => setKm(k)} />
                  <span className="flex h-8 items-center rounded-full border border-white/[0.12] px-3 text-[12.5px] font-semibold text-[#C9CFCD] peer-checked:border-[#00E6A7] peer-checked:bg-[rgba(0,230,167,0.12)] peer-checked:text-[#00E6A7] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-[#00E6A7]">
                    {k} km
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="mt-3">
            <legend className="mb-2 text-[11.5px] font-medium text-[#A4AAA9]">Around</legend>
            <div className="flex flex-col gap-1">
              {centres.map((c, i) => (
                <label key={`${c.label}-${i}`} className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 text-[13px] text-[#E6EAE8] hover:bg-white/[0.04]">
                  <input type="radio" name={`${id}-centre`} checked={centreIdx === i} onChange={() => setCentreIdx(i)} className="accent-[#00E6A7]" />
                  <span className="truncate">{c.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="mt-4 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => {
                onClear();
                setOpen(false);
                btn.current?.focus();
              }}
              disabled={!radius}
              className="h-10 rounded-[10px] px-3 text-[13px] font-semibold text-[#A4AAA9] hover:text-white disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00E6A7]"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => {
                const c = centres[centreIdx] ?? centres[0];
                if (!c) return;
                onApply({ center: c.point, km }, c.label);
                setOpen(false);
                btn.current?.focus();
              }}
              disabled={!centres.length}
              className="h-10 rounded-[10px] bg-[#00E6A7] px-5 text-[13px] font-bold text-[#030505] hover:brightness-110 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              Search radius
            </button>
          </div>
        </div>
      )}
    </>
  );
}
