"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Loader2, PlaneLanding, PlaneTakeoff } from "lucide-react";
import type { Airport } from "@/lib/travel/airportSearch";

export interface AirportValue {
  iata: string;
  label: string;
}

const countryName = (() => {
  try {
    const dn = new Intl.DisplayNames(["en"], { type: "region" });
    return (cc: string) => dn.of(cc) ?? cc;
  } catch {
    return (cc: string) => cc;
  }
})();

export const airportLabel = (a: Airport) => `${a.city || a.name} (${a.iata})`;

/**
 * Airport autocomplete (WAI-ARIA combobox with a listbox popup). Queries
 * /api/travel/airports — 4,000+ scheduled-service airports — debounced at
 * 150 ms. ↑/↓ move, Enter selects, Escape closes. Typing a bare 3-letter code
 * and leaving the field accepts it as-is.
 */
export default function AirportCombobox({
  label,
  value,
  onChange,
  kind,
  placeholder,
  invalid,
}: {
  label: string;
  value: AirportValue | null;
  onChange: (v: AirportValue | null) => void;
  kind: "from" | "to";
  placeholder: string;
  invalid?: boolean;
}) {
  const [text, setText] = useState(value?.label ?? "");
  const [items, setItems] = useState<Airport[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const id = useId();
  const listId = `${id}-list`;
  const box = useRef<HTMLDivElement>(null);
  const reqSeq = useRef(0);

  useEffect(() => setText(value?.label ?? ""), [value?.label]);

  useEffect(() => {
    const q = text.trim();
    if (!open || q.length < 2 || q === value?.label) {
      setItems([]);
      return;
    }
    const seq = ++reqSeq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/travel/airports?q=${encodeURIComponent(q)}&limit=8`);
        const d = (await r.json()) as { airports?: Airport[] };
        if (seq === reqSeq.current) {
          setItems(d.airports ?? []);
          setActive(0);
        }
      } catch {
        if (seq === reqSeq.current) setItems([]);
      } finally {
        if (seq === reqSeq.current) setLoading(false);
      }
    }, 150);
    return () => clearTimeout(t);
  }, [text, open, value?.label]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  function pick(a: Airport) {
    onChange({ iata: a.iata, label: airportLabel(a) });
    setText(airportLabel(a));
    setOpen(false);
  }

  const Icon = kind === "from" ? PlaneTakeoff : PlaneLanding;

  return (
    <div ref={box} className="relative min-w-0">
      <label htmlFor={`${id}-input`} className="block text-[11px] font-medium text-white/55">
        {label}
      </label>
      <div className={`mt-1.5 flex items-center gap-2 rounded-xl border bg-black/30 px-3 py-2.5 transition focus-within:border-neon/50 ${invalid ? "border-red-400/60" : "border-white/[0.08]"}`}>
        <Icon className="h-4 w-4 shrink-0 text-white/55" aria-hidden />
        <input
          id={`${id}-input`}
          role="combobox"
          aria-expanded={open && items.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && items[active] ? `${id}-opt-${active}` : undefined}
          aria-invalid={invalid || undefined}
          autoComplete="off"
          value={text}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            if (value) onChange(null);
          }}
          onBlur={() => {
            // A bare IATA code typed by someone who knows it is accepted.
            const t = text.trim();
            if (!value && /^[A-Za-z]{3}$/.test(t)) onChange({ iata: t.toUpperCase(), label: t.toUpperCase() });
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((a) => Math.min(items.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter" && open && items[active]) {
              e.preventDefault();
              pick(items[active]);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          className="w-full min-w-0 bg-transparent text-[14px] text-white placeholder:text-white/35 focus:outline-none"
        />
        {loading && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-white/40" aria-hidden />}
      </div>
      {open && items.length > 0 && (
        <ul id={listId} role="listbox" aria-label={`${label} airports`} className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 max-h-80 overflow-auto rounded-xl border border-white/10 bg-[#0B0F10] p-1.5 shadow-2xl">
          {items.map((a, i) => (
            <li
              key={a.iata}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(a);
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 ${i === active ? "bg-white/[0.07]" : ""}`}
            >
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium text-white">{a.city || a.name}</span>
                <span className="block truncate text-[11px] text-white/50">
                  {a.name} · {countryName(a.country)}
                </span>
              </span>
              <span className="shrink-0 rounded-md bg-white/[0.06] px-1.5 py-0.5 font-mono text-[12px] font-semibold text-neon">{a.iata}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
