"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";

// ---------------------------------------------------------------------------
// Date of birth — a calendar built for this product instead of the browser's.
//
// `<input type="date">` renders the platform's own picker: a light-grey popup
// on Chrome/Windows that ignores every token on this page. It is also the wrong
// SHAPE of control for a birth date — it opens on the current month, so a user
// born in 1990 is 400-odd clicks from their own birthday.
//
// So the header carries month and year as SELECTS. Choosing a birth year is one
// interaction rather than a scroll, and the chevrons remain for the last step.
//
// THE STORED VALUE STAYS ISO (`YYYY-MM-DD`) while the field DISPLAYS
// `DD-MM-YYYY`. That is not cosmetic: lib/compliance/providers/
// complyAdvantage.ts derives the sanctions-screening birth year with
// `dateOfBirth.split("-")[0]`. Handing it "15-08-1995" would send 15 as a birth
// year to a screening provider, so the display format never reaches the wire.
//
// Hydration: nothing here calls `new Date()` during render. "Today" is read
// when the picker OPENS — a client-only event — because a server rendering in
// UTC and a client in UTC+13 disagree about what day it is, and that mismatch
// is exactly the class of hydration error this page already had.
// ---------------------------------------------------------------------------

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/** Oldest birth year offered. Beyond this the select becomes a scroll of its own. */
const MAX_AGE_YEARS = 120;

/** `YYYY-MM-DD` → `DD-MM-YYYY`, or "" when the value is not a full ISO date. */
function toDisplay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
}

/** `DD-MM-YYYY` (or partially typed) → ISO, or "" when it is not a real date. */
function fromDisplay(text: string): string {
  const m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(text.trim());
  if (!m) return "";
  const [, d, mo, y] = m;
  const day = Number(d);
  const month = Number(mo);
  const year = Number(y);
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  // Round-trip through Date to reject 31-02-1990 and friends.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return "";
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const isoOf = (y: number, m: number, d: number) =>
  `${String(y).padStart(4, "0")}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

export default function DateOfBirthField({
  label = "Date of birth",
  value,
  onChange,
  disabled = false,
}: {
  label?: string;
  /** ISO `YYYY-MM-DD`. Empty string when unset. */
  value: string;
  onChange: (iso: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(() => toDisplay(value));
  const [dropUp, setDropUp] = useState(false);

  // The month on screen, and the day the keyboard is on. Both are set when the
  // picker opens, so neither is computed during a server render.
  const [viewYear, setViewYear] = useState(0);
  const [viewMonth, setViewMonth] = useState(0);
  const [focusedDay, setFocusedDay] = useState(1);
  const [today, setToday] = useState<{ y: number; m: number; d: number } | null>(null);

  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const labelId = useId();
  const dialogId = useId();
  const hintId = useId();

  // Keep the text in step when the value changes from outside (a reset, or a
  // prefill) — but never while the user is mid-edit in the field.
  useEffect(() => {
    if (document.activeElement !== inputRef.current) setText(toDisplay(value));
  }, [value]);

  const openPicker = useCallback(() => {
    if (disabled) return;
    const now = new Date();
    const t = { y: now.getFullYear(), m: now.getMonth(), d: now.getDate() };
    setToday(t);

    // Open on the selected date when there is one, otherwise on a sensible
    // birth-year starting point rather than this month — a DOB is never today.
    const sel = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (sel) {
      setViewYear(Number(sel[1]));
      setViewMonth(Number(sel[2]) - 1);
      setFocusedDay(Number(sel[3]));
    } else {
      setViewYear(t.y - 25);
      setViewMonth(t.m);
      setFocusedDay(1);
    }
    setOpen(true);
  }, [disabled, value]);

  const close = useCallback(
    (restoreFocus = true) => {
      setOpen(false);
      if (restoreFocus) inputRef.current?.focus();
    },
    []
  );

  // Dismiss on outside pointer or Escape.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  // Flip above the field when there is not enough room beneath it. Measured
  // before paint so the panel never renders in the wrong place and jumps.
  useLayoutEffect(() => {
    if (!open) return;
    const rect = inputRef.current?.getBoundingClientRect();
    if (!rect) return;
    const needed = 372; // panel height plus a little breathing room
    setDropUp(rect.bottom + needed > window.innerHeight && rect.top > needed);
  }, [open]);

  // Move DOM focus onto the focused day so the grid is keyboard-navigable.
  useEffect(() => {
    if (!open) return;
    const el = gridRef.current?.querySelector<HTMLElement>('[data-focused="true"]');
    el?.focus();
  }, [open, focusedDay, viewMonth, viewYear]);

  const years = useMemo(() => {
    if (!today) return [];
    const out: number[] = [];
    for (let y = today.y; y >= today.y - MAX_AGE_YEARS; y--) out.push(y);
    return out;
  }, [today]);

  /** A future date is not a birth date. */
  const isFuture = useCallback(
    (y: number, m: number, d: number) => {
      if (!today) return false;
      if (y !== today.y) return y > today.y;
      if (m !== today.m) return m > today.m;
      return d > today.d;
    },
    [today]
  );

  const cells = useMemo(() => {
    const first = new Date(Date.UTC(viewYear, viewMonth, 1)).getUTCDay();
    const daysInMonth = new Date(Date.UTC(viewYear, viewMonth + 1, 0)).getUTCDate();
    const daysInPrev = new Date(Date.UTC(viewYear, viewMonth, 0)).getUTCDate();

    const out: { day: number; outside: boolean; y: number; m: number }[] = [];
    for (let i = first - 1; i >= 0; i--) {
      const m = viewMonth === 0 ? 11 : viewMonth - 1;
      const y = viewMonth === 0 ? viewYear - 1 : viewYear;
      out.push({ day: daysInPrev - i, outside: true, y, m });
    }
    for (let d = 1; d <= daysInMonth; d++) out.push({ day: d, outside: false, y: viewYear, m: viewMonth });
    while (out.length % 7 !== 0 || out.length < 42) {
      const n = out.length - (first + daysInMonth) + 1;
      const m = viewMonth === 11 ? 0 : viewMonth + 1;
      const y = viewMonth === 11 ? viewYear + 1 : viewYear;
      out.push({ day: n, outside: true, y, m });
      if (out.length >= 42) break;
    }
    return out;
  }, [viewYear, viewMonth]);

  function shiftMonth(delta: number) {
    let m = viewMonth + delta;
    let y = viewYear;
    if (m < 0) {
      m = 11;
      y -= 1;
    } else if (m > 11) {
      m = 0;
      y += 1;
    }
    setViewYear(y);
    setViewMonth(m);
    const max = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    setFocusedDay((d) => Math.min(d, max));
  }

  function pick(y: number, m: number, d: number) {
    if (isFuture(y, m, d)) return;
    const iso = isoOf(y, m, d);
    onChange(iso);
    setText(toDisplay(iso));
    close();
  }

  function onGridKeyDown(e: React.KeyboardEvent) {
    const daysInMonth = new Date(Date.UTC(viewYear, viewMonth + 1, 0)).getUTCDate();
    let next = focusedDay;
    switch (e.key) {
      case "ArrowLeft": next = focusedDay - 1; break;
      case "ArrowRight": next = focusedDay + 1; break;
      case "ArrowUp": next = focusedDay - 7; break;
      case "ArrowDown": next = focusedDay + 7; break;
      case "Home": next = 1; break;
      case "End": next = daysInMonth; break;
      case "PageUp": e.preventDefault(); shiftMonth(-1); return;
      case "PageDown": e.preventDefault(); shiftMonth(1); return;
      case "Enter":
      case " ":
        e.preventDefault();
        pick(viewYear, viewMonth, focusedDay);
        return;
      default:
        return;
    }
    e.preventDefault();
    if (next < 1) {
      shiftMonth(-1);
      const prevMax = new Date(Date.UTC(viewYear, viewMonth, 0)).getUTCDate();
      setFocusedDay(prevMax + next);
    } else if (next > daysInMonth) {
      shiftMonth(1);
      setFocusedDay(next - daysInMonth);
    } else {
      setFocusedDay(next);
    }
  }

  const selected = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const selY = selected ? Number(selected[1]) : null;
  const selM = selected ? Number(selected[2]) - 1 : null;
  const selD = selected ? Number(selected[3]) : null;

  const canGoNext = !today || viewYear < today.y || (viewYear === today.y && viewMonth < today.m);

  return (
    <div ref={wrapRef} className="relative">
      <label htmlFor={labelId} className="mb-1 block text-[12px] text-textSecondary">
        {label}
      </label>
      <span id={hintId} className="sr-only">
        Format day-month-year, for example 05-08-1995. Or open the date picker to choose.
      </span>

      <div className="relative">
        <input
          id={labelId}
          ref={inputRef}
          type="text"
          inputMode="numeric"
          autoComplete="bday"
          placeholder="dd-mm-yyyy"
          value={text}
          disabled={disabled}
          // No aria-expanded/aria-controls here: this is a plain text field
          // (role=textbox), which does not support them. The button beside it
          // owns the popup and carries that state.
          aria-describedby={hintId}
          onChange={(e) => {
            const raw = e.target.value;
            setText(raw);
            const iso = fromDisplay(raw);
            // Only publish a complete, real date; a half-typed field must not
            // clear a previously chosen one on every keystroke.
            if (iso) onChange(iso);
            else if (raw.trim() === "") onChange("");
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || (e.key === "Enter" && !open)) {
              e.preventDefault();
              openPicker();
            }
          }}
          className="w-full rounded-2xl bg-surface px-4 py-3 pr-12 outline-none ring-1 ring-transparent transition-shadow focus:ring-accent/60 disabled:opacity-50"
        />

        <button
          type="button"
          onClick={() => (open ? close() : openPicker())}
          disabled={disabled}
          aria-label={open ? "Close date picker" : "Open date picker"}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? dialogId : undefined}
          className="tap absolute right-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-xl text-textSecondary transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50"
        >
          <Calendar className="h-[18px] w-[18px]" aria-hidden />
        </button>
      </div>

      {open && (
        <div
          ref={popRef}
          id={dialogId}
          role="dialog"
          aria-modal="false"
          aria-label="Choose date of birth"
          // `app-pop` is the app's own popover surface — the charcoal
          // gradient, hairline border and soft shadow the profile menu and the
          // command palette already use — so this reads as the same component
          // family rather than a one-off panel. `app-pop-in` is the 120ms
          // entrance, and the global prefers-reduced-motion rule flattens it.
          className={`app-pop app-pop-in absolute left-0 z-50 w-[min(320px,calc(100vw-40px))] p-3 ${
            dropUp ? "bottom-[calc(100%+8px)]" : "top-[calc(100%+8px)]"
          }`}
        >
          {/* Header: month + year as selects, so a birth year is one choice. */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              aria-label="Previous month"
              className="tap grid h-8 w-8 shrink-0 place-items-center rounded-lg text-textSecondary transition-colors hover:bg-white/[0.07] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </button>

            <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5">
              <select
                aria-label="Month"
                value={viewMonth}
                onChange={(e) => setViewMonth(Number(e.target.value))}
                className="min-w-0 flex-1 rounded-lg bg-white/[0.05] px-2 py-1.5 text-[13px] font-semibold text-white outline-none transition-colors hover:bg-white/[0.09] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                {MONTHS.map((name, i) => (
                  <option key={name} value={i} className="bg-[#141416]">
                    {name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Year"
                value={viewYear}
                onChange={(e) => setViewYear(Number(e.target.value))}
                className="w-[84px] shrink-0 rounded-lg bg-white/[0.05] px-2 py-1.5 text-[13px] font-semibold text-white outline-none transition-colors hover:bg-white/[0.09] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                {years.map((y) => (
                  <option key={y} value={y} className="bg-[#141416]">
                    {y}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={() => shiftMonth(1)}
              disabled={!canGoNext}
              aria-label="Next month"
              className="tap grid h-8 w-8 shrink-0 place-items-center rounded-lg text-textSecondary transition-colors hover:bg-white/[0.07] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
          </div>

          {/* Weekday header */}
          <div className="mt-2.5 grid grid-cols-7 gap-1">
            {DAY_LABELS.map((d) => (
              <abbr
                key={d}
                title={d}
                className="grid h-7 place-items-center text-[10.5px] font-semibold uppercase tracking-wide text-textMuted no-underline"
              >
                {d.slice(0, 2)}
              </abbr>
            ))}
          </div>

          {/* Day grid */}
          <div
            ref={gridRef}
            role="grid"
            aria-label={`${MONTHS[viewMonth]} ${viewYear}`}
            onKeyDown={onGridKeyDown}
            className="mt-1 grid grid-cols-7 gap-1"
          >
            {cells.map((c, i) => {
              const isSelected = selY === c.y && selM === c.m && selD === c.day;
              const isToday =
                !!today && today.y === c.y && today.m === c.m && today.d === c.day;
              const future = isFuture(c.y, c.m, c.day);
              const isFocused = !c.outside && c.day === focusedDay;

              return (
                <button
                  key={`${c.y}-${c.m}-${c.day}-${i}`}
                  type="button"
                  role="gridcell"
                  data-focused={isFocused ? "true" : undefined}
                  tabIndex={isFocused ? 0 : -1}
                  aria-selected={isSelected}
                  aria-current={isToday ? "date" : undefined}
                  disabled={future}
                  onClick={() => pick(c.y, c.m, c.day)}
                  aria-label={`${c.day} ${MONTHS[c.m]} ${c.y}${isSelected ? ", selected" : ""}${
                    isToday ? ", today" : ""
                  }`}
                  className={`relative grid h-9 w-full place-items-center rounded-lg text-[13px] tabular-nums transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-25 ${
                    isSelected
                      ? "bg-accent font-bold text-white"
                      : c.outside
                        ? "text-textMuted/50 hover:bg-white/[0.05]"
                        : "text-white hover:bg-white/[0.08]"
                  }`}
                >
                  {c.day}
                  {/* Selection is not signalled by colour alone: the chosen day
                      also carries a ring, and its label says "selected". */}
                  {isSelected && (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-0 rounded-lg ring-2 ring-white/70"
                    />
                  )}
                  {isToday && !isSelected && (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute bottom-1 h-1 w-1 rounded-full bg-accent"
                    />
                  )}
                </button>
              );
            })}
          </div>

          <p className="mt-2 px-1 text-[10.5px] leading-relaxed text-textMuted">
            Use arrow keys to move, Page Up/Down for months, Enter to choose.
          </p>
        </div>
      )}
    </div>
  );
}
