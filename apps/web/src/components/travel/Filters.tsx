"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { SlidersHorizontal, X } from "lucide-react";

// Shared filter controls for the travel results pages (stays, cars, …), so a
// price slider or a star filter looks and behaves the same everywhere.
//
// <FilterPanel> is a sticky sidebar from lg up. Below lg the same controls
// open in a bottom sheet (a native modal <dialog>: focus trapped, Escape and
// the backdrop close it) behind a "Filters" button that shows how many are
// active, so results are not pushed below a tall stack of controls.

export function FilterPanel({
  activeCount,
  onReset,
  resultCount,
  children,
}: {
  activeCount: number;
  onReset: () => void;
  /** Shown on the sheet's close button: "Show 12 results". */
  resultCount: number | null;
  children: ReactNode;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (sheetOpen && !d.open) d.showModal();
    if (!sheetOpen && d.open) d.close();
  }, [sheetOpen]);
  // Leaving the mobile breakpoint with the sheet open must not strand a modal.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = () => { if (mq.matches) setSheetOpen(false); };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const header = (
    <div className="flex items-center justify-between gap-3">
      <p id={titleId} className="flex items-center gap-2 text-[14px] font-semibold text-white">
        <SlidersHorizontal className="h-4 w-4 text-neon" aria-hidden /> Filters
        {activeCount > 0 && <span className="rounded-full bg-neon/15 px-1.5 text-[11px] font-bold text-neon">{activeCount}</span>}
      </p>
      {activeCount > 0 && (
        <button type="button" onClick={onReset} className="rounded-md px-1.5 py-1 text-[12px] font-medium text-white/60 transition-colors hover:text-white">
          Reset
        </button>
      )}
    </div>
  );

  return (
    <>
      <aside aria-label="Filters" className="sticky top-20 hidden h-fit rounded-2xl border border-white/[0.08] bg-[#0A0D0C] p-5 lg:block">
        {header}
        <div className="mt-4">{children}</div>
      </aside>

      <div className="lg:hidden">
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          aria-haspopup="dialog"
          className="inline-flex h-10 items-center gap-2 rounded-full border border-white/[0.10] bg-white/[0.04] px-4 text-[13px] font-semibold text-white transition-colors hover:border-white/[0.2]"
        >
          <SlidersHorizontal className="h-4 w-4 text-neon" aria-hidden /> Filters
          {activeCount > 0 && <span className="rounded-full bg-neon/15 px-1.5 text-[11px] font-bold text-neon">{activeCount}</span>}
        </button>
        <dialog
          ref={dialog}
          aria-labelledby={titleId}
          onClose={() => setSheetOpen(false)}
          onClick={(e) => { if (e.target === e.currentTarget) setSheetOpen(false); }}
          className="m-0 mt-auto max-h-[85dvh] w-full max-w-none rounded-t-2xl border border-white/[0.10] bg-[#0A0D0C] p-0 text-white backdrop:bg-black/70 open:flex open:flex-col"
        >
          {sheetOpen && (
            <>
              <div className="flex items-center gap-3 border-b border-white/[0.06] px-5 py-4">
                <div className="min-w-0 flex-1">{header}</div>
                <button type="button" onClick={() => setSheetOpen(false)} aria-label="Close filters" className="flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.10] text-white">
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
              <div className="border-t border-white/[0.06] p-4">
                <button type="button" onClick={() => setSheetOpen(false)} className="h-11 w-full rounded-full bg-neon text-[14px] font-bold text-black">
                  {resultCount === null ? "Done" : `Show ${resultCount} result${resultCount === 1 ? "" : "s"}`}
                </button>
              </div>
            </>
          )}
        </dialog>
      </div>
    </>
  );
}

export function FilterSection({ label, labelId, children }: { label: string; labelId?: string; children: ReactNode }) {
  return (
    <div className="border-t border-white/[0.06] py-4 first:border-t-0 first:pt-0 last:pb-0">
      <p id={labelId} className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/45">{label}</p>
      {children}
    </div>
  );
}

/** Single-choice chips (e.g. minimum stars). */
export function ChipGroup<T extends string | number>({
  label, options, value, onChange,
}: { label: string; options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={`h-8 rounded-full border px-3 text-[12px] font-semibold transition-colors ${
              on ? "border-neon/50 bg-neon/10 text-neon" : "border-white/[0.10] bg-white/[0.03] text-white/70 hover:border-white/[0.2] hover:text-white"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function RangeField({
  label, min, max, step, value, onChange, format,
}: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void; format: (v: number) => string }) {
  const id = useId();
  const fill = `${((value - min) / (max - min)) * 100}%`;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-[12.5px] text-white/75">{label}</label>
        <span className="text-[12.5px] font-semibold tabular-nums text-white">{format(value)}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-valuetext={format(value)}
        className="range-neon mt-2"
        style={{ ["--range-fill" as string]: fill }}
      />
      <div className="mt-1 flex justify-between text-[10.5px] text-white/35" aria-hidden>
        <span>{format(min)}</span>
        <span>{format(max)}</span>
      </div>
    </div>
  );
}

export function CheckRow({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex min-h-[36px] cursor-pointer items-center gap-2.5 rounded-lg text-[13px] text-white/85 hover:text-white">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 shrink-0 cursor-pointer rounded accent-neon" />
      {label}
    </label>
  );
}
