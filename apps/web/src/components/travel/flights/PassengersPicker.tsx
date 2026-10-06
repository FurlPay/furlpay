"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Minus, Plus, Users } from "lucide-react";

export interface Passengers {
  adults: number;
  childAges: number[];
}

export const passengersLabel = (p: Passengers) => {
  const n = p.adults + p.childAges.length;
  return `${n} traveller${n === 1 ? "" : "s"}`;
};

// Module-level so React keeps the same buttons across renders (a component
// defined inside the picker remounts on every click and drops keyboard focus).
function Step({ label, onMinus, onPlus, minusOff, plusOff, n }: { label: string; onMinus: () => void; onPlus: () => void; minusOff: boolean; plusOff: boolean; n: number }) {
  return (
    <div className="flex items-center gap-3">
      <button type="button" onClick={onMinus} disabled={minusOff} aria-label={`Fewer ${label}`} className="flex h-8 w-8 items-center justify-center rounded-full border border-white/15 text-white transition hover:border-neon/60 disabled:opacity-30">
        <Minus className="h-3.5 w-3.5" />
      </button>
      <span className="w-5 text-center text-sm font-semibold text-white" aria-live="polite">{n}</span>
      <button type="button" onClick={onPlus} disabled={plusOff} aria-label={`More ${label}`} className="flex h-8 w-8 items-center justify-center rounded-full border border-white/15 text-white transition hover:border-neon/60 disabled:opacity-30">
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/** Adults + children. Duffel prices a child by age, so every child carries
 *  one (0-17); the airline decides the fare band from it. */
export default function PassengersPicker({ value, onChange }: { value: Passengers; onChange: (p: Passengers) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  const total = value.adults + value.childAges.length;

  return (
    <div ref={root} className="relative">
      <span className="block text-[11px] font-medium text-white/55">Travellers</span>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="mt-1.5 flex w-full items-center gap-2 rounded-xl border border-white/[0.08] bg-black/30 px-3 py-2.5 text-left text-[14px] text-white transition hover:border-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-neon"
      >
        <Users className="h-4 w-4 text-white/55" aria-hidden />
        <span className="min-w-0 flex-1 truncate whitespace-nowrap">{passengersLabel(value)}</span>
        <ChevronDown className={`h-4 w-4 text-white/50 transition ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open && (
        <div role="dialog" aria-label="Travellers" className="absolute right-0 top-[calc(100%+8px)] z-30 w-[min(300px,calc(100vw-2rem))] rounded-2xl border border-white/10 bg-[#0B0F10] p-4 shadow-2xl">
          <div className="flex items-center justify-between py-2">
            <div>
              <p className="text-sm font-semibold text-white">Adults</p>
              <p className="text-[11px] text-white/50">18+</p>
            </div>
            <Step label="adults" n={value.adults} minusOff={value.adults <= 1} plusOff={total >= 9} onMinus={() => onChange({ ...value, adults: value.adults - 1 })} onPlus={() => onChange({ ...value, adults: value.adults + 1 })} />
          </div>
          <div className="flex items-center justify-between py-2">
            <div>
              <p className="text-sm font-semibold text-white">Children</p>
              <p className="text-[11px] text-white/50">0–17, age on the travel date</p>
            </div>
            <Step label="children" n={value.childAges.length} minusOff={!value.childAges.length} plusOff={total >= 9 || value.childAges.length >= 8} onMinus={() => onChange({ ...value, childAges: value.childAges.slice(0, -1) })} onPlus={() => onChange({ ...value, childAges: [...value.childAges, 8] })} />
          </div>
          {value.childAges.length > 0 && (
            <div className="grid grid-cols-2 gap-2 pb-2">
              {value.childAges.map((age, i) => (
                <label key={i} className="text-[11px] text-white/55">
                  Child {i + 1} age
                  <select
                    value={age}
                    onChange={(e) => onChange({ ...value, childAges: value.childAges.map((a, j) => (j === i ? Number(e.target.value) : a)) })}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[13px] text-white [&>option]:text-black"
                  >
                    {Array.from({ length: 18 }, (_, n) => (
                      <option key={n} value={n}>{n === 0 ? "Under 1" : n}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          )}
          <button type="button" onClick={() => { setOpen(false); trigger.current?.focus(); }} className="mt-2 w-full rounded-xl bg-neon py-2.5 text-sm font-bold text-black transition hover:brightness-110">
            Done
          </button>
        </div>
      )}
    </div>
  );
}
