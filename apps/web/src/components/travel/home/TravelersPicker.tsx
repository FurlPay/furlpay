"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Minus, Plus, Users } from "lucide-react";

export interface Travelers {
  adults: number;
  children: number;
  rooms: number;
}

const ROWS: Array<{ key: keyof Travelers; label: string; hint: string; min: number; max: number }> = [
  { key: "adults", label: "Adults", hint: "Age 13+", min: 1, max: 16 },
  { key: "children", label: "Children", hint: "Age 0–12", min: 0, max: 8 },
  { key: "rooms", label: "Rooms", hint: "For stays", min: 1, max: 8 },
];

export function travelersLabel(t: Travelers): string {
  const guests = t.adults + t.children;
  return `${guests} ${guests === 1 ? "guest" : "guests"}${t.rooms > 1 ? ` · ${t.rooms} rooms` : ""}`;
}

/** Travelers field with a popover of steppers. Escape or an outside click
 *  closes it; focus returns to the trigger. */
export default function TravelersPicker({ value, onChange }: { value: Travelers; onChange: (t: Travelers) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const set = (k: keyof Travelers, d: number) => {
    const row = ROWS.find((r) => r.key === k)!;
    onChange({ ...value, [k]: Math.min(row.max, Math.max(row.min, value[k] + d)) });
  };

  return (
    <div ref={root} className="relative h-full">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className="flex h-full w-full flex-col justify-center gap-1.5 rounded-xl px-4 py-3 text-left transition hover:bg-white/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-neon"
      >
        <span className="text-[11px] font-medium text-white/55">Travelers</span>
        <span className="flex items-center gap-2 text-[13px] text-white">
          <Users className="h-4 w-4 text-white/60" aria-hidden />
          <span className="flex-1 truncate">{travelersLabel(value)}</span>
          <ChevronDown className={`h-4 w-4 text-white/50 transition ${open ? "rotate-180" : ""}`} aria-hidden />
        </span>
      </button>
      {open && (
        <div id={panelId} role="dialog" aria-label="Travelers" className="absolute right-0 top-[calc(100%+8px)] z-30 w-72 rounded-2xl border border-white/10 bg-[#0B0F10] p-4 shadow-2xl">
          {ROWS.map((r) => (
            <div key={r.key} className="flex items-center justify-between py-2">
              <div>
                <p className="text-sm font-semibold text-white">{r.label}</p>
                <p className="text-[11px] text-white/50">{r.hint}</p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => set(r.key, -1)}
                  disabled={value[r.key] <= r.min}
                  aria-label={`Fewer ${r.label.toLowerCase()}`}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-white/15 text-white transition hover:border-neon/60 disabled:opacity-30"
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <span className="w-5 text-center text-sm font-semibold text-white" aria-live="polite">
                  {value[r.key]}
                </span>
                <button
                  type="button"
                  onClick={() => set(r.key, 1)}
                  disabled={value[r.key] >= r.max}
                  aria-label={`More ${r.label.toLowerCase()}`}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-white/15 text-white transition hover:border-neon/60 disabled:opacity-30"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              trigger.current?.focus();
            }}
            className="mt-2 w-full rounded-xl bg-neon py-2.5 text-sm font-bold text-black transition hover:brightness-110"
          >
            Done
          </button>
        </div>
      )}
    </div>
  );
}
