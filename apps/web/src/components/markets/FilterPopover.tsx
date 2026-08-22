"use client";

import { useEffect, useRef, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import type { AssetKindFilter, CapBand } from "@/lib/markets/table";

// ---------------------------------------------------------------------------
// The filter popover.
//
// DRAFT STATE, NOT LIVE STATE. Every control writes to a local draft, and
// nothing reaches the table until "Apply filters" is pressed. A popover whose
// every checkbox refetches turns a four-field change into four round trips and
// four re-sorts under the reader's cursor.
//
// The consequence is handled rather than ignored: opening the popover copies
// the applied filters in, so a reopened panel shows what is actually in force,
// and closing without applying discards the draft instead of half-applying it.
// The trigger carries a count of ACTIVE filters, so a filtered table can never
// look like an unfiltered one.
// ---------------------------------------------------------------------------

export interface FilterValues {
  kinds: AssetKindFilter[];
  performance: "gainers" | "losers" | null;
  capBands: CapBand[];
  priceMin: string;
  priceMax: string;
  volumeMin: string;
  volumeMax: string;
}

export const EMPTY_FILTERS: FilterValues = {
  kinds: [],
  performance: null,
  capBands: [],
  priceMin: "",
  priceMax: "",
  volumeMin: "",
  volumeMax: "",
};

/** How many filter groups are actually narrowing the table. Drives the badge. */
export function activeFilterCount(f: FilterValues): number {
  return (
    (f.kinds.length ? 1 : 0) +
    (f.performance ? 1 : 0) +
    (f.capBands.length ? 1 : 0) +
    (f.priceMin || f.priceMax ? 1 : 0) +
    (f.volumeMin || f.volumeMax ? 1 : 0)
  );
}

const KINDS: { id: AssetKindFilter; label: string }[] = [
  { id: "stock", label: "Stocks" },
  { id: "etf", label: "ETFs" },
  { id: "crypto", label: "Crypto" },
];

const CAPS: { id: CapBand; label: string; hint: string }[] = [
  { id: "large", label: "Large", hint: "$10B+" },
  { id: "mid", label: "Mid", hint: "$2–10B" },
  { id: "small", label: "Small", hint: "Under $2B" },
];

export default function FilterPopover({
  value,
  onApply,
}: {
  value: FilterValues;
  onApply: (next: FilterValues) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<FilterValues>(value);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Re-seed the draft from what is actually applied each time it opens.
  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const count = activeFilterCount(value);

  function toggleKind(id: AssetKindFilter) {
    setDraft((d) => ({
      ...d,
      kinds: d.kinds.includes(id) ? d.kinds.filter((k) => k !== id) : [...d.kinds, id],
    }));
  }

  function toggleCap(id: CapBand) {
    setDraft((d) => ({
      ...d,
      capBands: d.capBands.includes(id) ? d.capBands.filter((c) => c !== id) : [...d.capBands, id],
    }));
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[12px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mkt-cyan ${
          count > 0
            ? "border-mkt-cyan/40 bg-mkt-cyan/[0.1] text-mkt-cyan"
            : "border-white/[0.09] text-white/65 hover:border-white/20 hover:text-white"
        }`}
      >
        <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
        Filters
        {count > 0 && (
          <span className="ml-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-mkt-cyan px-1 text-[10px] font-bold text-[#04202a] mkt-num">
            {count}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Filter assets"
          className="mkt-pop mkt-pop-in absolute left-0 top-[calc(100%+8px)] z-50 w-[min(300px,calc(100vw-32px))] p-4"
        >
          <Group label="Asset type">
            <div className="flex flex-wrap gap-1.5">
              {KINDS.map((k) => (
                <Chip
                  key={k.id}
                  active={draft.kinds.includes(k.id)}
                  onClick={() => toggleKind(k.id)}
                  label={k.label}
                />
              ))}
            </div>
          </Group>

          <Group label="Performance">
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  { id: "gainers", label: "Gainers" },
                  { id: "losers", label: "Losers" },
                ] as const
              ).map((p) => (
                <Chip
                  key={p.id}
                  active={draft.performance === p.id}
                  // Mutually exclusive: an asset cannot be both, and offering
                  // both as checkboxes invites an always-empty result.
                  onClick={() =>
                    setDraft((d) => ({ ...d, performance: d.performance === p.id ? null : p.id }))
                  }
                  label={p.label}
                />
              ))}
            </div>
          </Group>

          <Group label="Market cap">
            <div className="flex flex-wrap gap-1.5">
              {CAPS.map((c) => (
                <Chip
                  key={c.id}
                  active={draft.capBands.includes(c.id)}
                  onClick={() => toggleCap(c.id)}
                  label={c.label}
                  hint={c.hint}
                />
              ))}
            </div>
          </Group>

          <Group label="Price (USD)">
            <div className="flex items-center gap-2">
              <NumberField
                label="Minimum price"
                placeholder="Min"
                value={draft.priceMin}
                onChange={(v) => setDraft((d) => ({ ...d, priceMin: v }))}
              />
              <span className="text-white/25" aria-hidden>
                –
              </span>
              <NumberField
                label="Maximum price"
                placeholder="Max"
                value={draft.priceMax}
                onChange={(v) => setDraft((d) => ({ ...d, priceMax: v }))}
              />
            </div>
          </Group>

          <Group label="Volume (24h)">
            <div className="flex items-center gap-2">
              <NumberField
                label="Minimum volume"
                placeholder="Min"
                value={draft.volumeMin}
                onChange={(v) => setDraft((d) => ({ ...d, volumeMin: v }))}
              />
              <span className="text-white/25" aria-hidden>
                –
              </span>
              <NumberField
                label="Maximum volume"
                placeholder="Max"
                value={draft.volumeMax}
                onChange={(v) => setDraft((d) => ({ ...d, volumeMax: v }))}
              />
            </div>
          </Group>

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => {
                setDraft(EMPTY_FILTERS);
                onApply(EMPTY_FILTERS);
                setOpen(false);
              }}
              className="flex-1 rounded-lg border border-white/[0.1] py-2 text-[12px] font-semibold text-white/65 transition-colors hover:border-white/25 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mkt-cyan"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={() => {
                onApply(draft);
                setOpen(false);
              }}
              className="flex-1 rounded-lg bg-mkt-cyan py-2 text-[12px] font-bold text-[#04202a] transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mkt-cyan"
            >
              Apply Filters
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <fieldset className="mb-3.5 last:mb-0">
      <legend className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-white/35">
        {label}
      </legend>
      {children}
    </fieldset>
  );
}

function Chip({
  active,
  onClick,
  label,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-lg border px-2.5 py-1.5 text-[11.5px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-mkt-cyan ${
        active
          ? "border-mkt-cyan/45 bg-mkt-cyan/[0.12] text-mkt-cyan"
          : "border-white/[0.09] text-white/55 hover:border-white/20 hover:text-white"
      }`}
    >
      {label}
      {hint && <span className="ml-1 text-[9.5px] font-normal opacity-55">{hint}</span>}
    </button>
  );
}

function NumberField({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <input
      type="number"
      inputMode="decimal"
      min={0}
      aria-label={label}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="min-w-0 flex-1 rounded-lg border border-white/[0.09] bg-white/[0.03] px-2 py-1.5 text-[12px] text-white outline-none transition-colors placeholder:text-white/25 focus:border-mkt-cyan/45 mkt-num"
    />
  );
}
