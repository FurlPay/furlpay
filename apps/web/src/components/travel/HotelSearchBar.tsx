"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  MAX_CHILD_AGE,
  MAX_CHECKIN_DAYS_AHEAD,
  MAX_ROOMS,
  MAX_ADULTS,
  MAX_CHILDREN,
  MAX_STAY_NIGHTS,
  addDays,
  isoToday,
  nightsBetween,
  validateHotelSearch,
  type HotelSearch,
} from "@/lib/hotels/hotelSearch";
import {
  CalendarIcon,
  ChevronDownIcon,
  GuestsIcon,
  PinIcon,
  SearchIcon,
} from "./map/icons";

// ---------------------------------------------------------------------------
// The hotel search bar. One component, no page around it.
//
// Destination · Check in · Check out · Guests · Search — a single horizontal
// surface on desktop that stacks into rows on narrow screens WITHOUT reordering
// itself, so the reading order is the same at every width.
//
// The rules the bar enforces — occupancy limits, the booking horizon, the
// maximum stay — all live in lib/hotels/hotelSearch, next to the note about
// which server route they are mirroring.
//
// ── SURFACE ────────────────────────────────────────────────────────────────
// Dark, unaccented, and bordered at 8% white. No coloured ring, no glow: the
// only saturated thing permitted here is nothing, and the Search button earns
// its prominence by being the one LIGHT element on a dark bar.
//
// ── OVERFLOW ───────────────────────────────────────────────────────────────
// Every segment is `min-w-0` and every value line truncates. A long destination
// name shortens with an ellipsis instead of widening its column and pushing the
// Search button out of the container.
// ---------------------------------------------------------------------------

const BAR = "#181C23";

export default function HotelSearchBar({
  value,
  onChange,
  onSearch,
  busy = false,
  className,
}: {
  value: HotelSearch;
  onChange: (next: HotelSearch) => void;
  /** Fired only when the search passes `validateHotelSearch`. */
  onSearch: (value: HotelSearch) => void;
  /** Renders the action as in-flight and blocks resubmission. */
  busy?: boolean;
  className?: string;
}) {
  const [guestsOpen, setGuestsOpen] = useState(false);
  const guestsWrap = useRef<HTMLDivElement>(null);

  // Read after mount for the reason given on `defaultHotelSearch`.
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => setToday(isoToday()), []);

  useEffect(() => {
    if (!guestsOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!guestsWrap.current?.contains(e.target as Node)) setGuestsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setGuestsOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [guestsOpen]);

  const set = (patch: Partial<HotelSearch>) => onChange({ ...value, ...patch });

  const error = validateHotelSearch(value, today);
  const nights = nightsBetween(value.checkIn, value.checkOut);
  const guestCount = value.adults + value.children.length;

  // The pickers' own limits, so the calendar cannot offer a date the server
  // would refuse. Undefined until `today` is known rather than guessed.
  const checkInMin = today;
  const checkInMax = today ? addDays(today, MAX_CHECKIN_DAYS_AHEAD) : undefined;
  const checkOutMin = value.checkIn ? addDays(value.checkIn, 1) : today ?? undefined;
  const checkOutMax = value.checkIn ? addDays(value.checkIn, MAX_STAY_NIGHTS) : undefined;

  /**
   * Moving check-in must not leave check-out behind it. The stay LENGTH is
   * preserved rather than snapped to one night, because someone shifting a
   * two-week trip by a day means to move the trip, not to shorten it.
   */
  const setCheckIn = (next: string) => {
    if (!next) return set({ checkIn: next });
    const held = nightsBetween(value.checkIn, value.checkOut);
    const span = Number.isFinite(held) && held >= 1 ? Math.min(held, MAX_STAY_NIGHTS) : 1;
    set({ checkIn: next, checkOut: addDays(next, span) });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (error || busy) return;
    onSearch(value);
  };

  return (
    <form onSubmit={submit} className={className}>
      {/* `overflow-hidden` is what guarantees the corner radius clips every
          child, including the segment dividers that run to the container's
          edge. Nothing inside can paint over the rounded corners. */}
      <div
        className="overflow-hidden rounded-[16px] border border-white/[0.08] shadow-[0_16px_40px_rgba(0,0,0,0.45),0_2px_8px_rgba(0,0,0,0.30)]"
        style={{ background: BAR }}
      >
        <div className="flex flex-col md:flex-row md:items-stretch">
          <Segment
            className="md:flex-[1.6]"
            icon={<PinIcon />}
            label="Destination"
            htmlForField
          >
            {(id) => (
              <input
                id={id}
                value={value.destination}
                onChange={(e) => set({ destination: e.target.value })}
                placeholder="Where to?"
                autoComplete="off"
                className="w-full min-w-0 truncate bg-transparent text-[14.5px] font-semibold text-[#F5F7FA] outline-none placeholder:font-medium placeholder:text-[#8992A3]"
              />
            )}
          </Segment>

          <Divider />

          <Segment className="md:flex-1" icon={<CalendarIcon />} label="Check in" htmlForField>
            {(id) => (
              <DateInput
                id={id}
                value={value.checkIn}
                min={checkInMin ?? undefined}
                max={checkInMax}
                onChange={setCheckIn}
              />
            )}
          </Segment>

          <Divider />

          <Segment
            className="md:flex-1"
            icon={<CalendarIcon />}
            label={
              // The label carries the stay length once it is knowable. It is the
              // one number a traveller checks and would otherwise have to work
              // out from two dates.
              Number.isFinite(nights) && nights >= 1
                ? `Check out · ${nights} night${nights === 1 ? "" : "s"}`
                : "Check out"
            }
            htmlForField
          >
            {(id) => (
              <DateInput
                id={id}
                value={value.checkOut}
                min={checkOutMin}
                max={checkOutMax}
                onChange={(next) => set({ checkOut: next })}
              />
            )}
          </Segment>

          <Divider />

          <div ref={guestsWrap} className="relative min-w-0 md:flex-1">
            <Segment
              className="w-full"
              icon={<GuestsIcon />}
              label="Guests"
              as="button"
              onClick={() => setGuestsOpen((v) => !v)}
              expanded={guestsOpen}
              trailing={
                <ChevronDownIcon
                  className={`h-4 w-4 shrink-0 text-[#8992A3] transition-transform duration-200 ${
                    guestsOpen ? "rotate-180" : ""
                  }`}
                />
              }
            >
              {() => (
                <span className="block min-w-0 truncate text-left text-[14.5px] font-semibold text-[#F5F7FA]">
                  {guestCount} guest{guestCount === 1 ? "" : "s"} ·{" "}
                  {value.rooms} room{value.rooms === 1 ? "" : "s"}
                </span>
              )}
            </Segment>

            {guestsOpen && (
              <GuestsPopover
                value={value}
                onChange={set}
                onDone={() => setGuestsOpen(false)}
              />
            )}
          </div>

          {/* The action. On desktop it is a square-ish button inset in the bar;
              stacked, it becomes full width so it is never a small target at
              the bottom of a tall form. */}
          <div className="shrink-0 p-2 max-md:pt-0">
            <button
              type="submit"
              disabled={Boolean(error) || busy}
              // `title` rather than a permanently visible error line: the bar
              // stays one row tall, and the reason is still reachable. The
              // disabled state is announced by `aria-disabled` semantics.
              title={error ?? undefined}
              className="flex h-full w-full items-center justify-center gap-2 rounded-xl bg-[#F5F7FA] px-5 text-[14px] font-bold text-[#181C23] transition-colors hover:bg-white disabled:cursor-not-allowed disabled:bg-white/[0.10] disabled:text-[#8992A3] max-md:h-11 md:min-h-[56px]"
            >
              <SearchIcon className="h-[18px] w-[18px] shrink-0" />
              <span className="md:sr-only lg:not-sr-only">
                {busy ? "Searching…" : "Search"}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Stated once, under the bar, only when something is actually wrong.
          `role="status"` so it is announced without stealing focus. */}
      {error && value.destination.trim() && (
        <p role="status" className="mt-2 px-1 text-[12.5px] font-medium text-[#8992A3]">
          {error}
        </p>
      )}
    </form>
  );
}

/** A vertical hairline between segments on desktop, horizontal when stacked. */
function Divider() {
  return <div className="shrink-0 bg-white/[0.08] max-md:h-px max-md:w-full md:w-px" />;
}

/**
 * One labelled cell of the bar.
 *
 * Renders as a `<label>` wrapping a real control, or as a `<button>` for the
 * guests cell. Either way the whole cell is the hit target — a two-line cell
 * whose bottom line alone is clickable is a control that feels broken.
 */
function Segment({
  icon,
  label,
  children,
  className,
  as = "label",
  onClick,
  expanded,
  trailing,
  htmlForField,
}: {
  icon: React.ReactNode;
  label: string;
  /** Receives the generated id to attach to the control. */
  children: (id: string) => React.ReactNode;
  className?: string;
  as?: "label" | "button";
  onClick?: () => void;
  expanded?: boolean;
  trailing?: React.ReactNode;
  htmlForField?: boolean;
}) {
  const id = useId();
  const inner = (
    <>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/[0.05] text-[#AAB2C0]">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[10.5px] font-bold uppercase tracking-[0.06em] text-[#8992A3]">
          {label}
        </span>
        <span className="mt-0.5 block min-w-0">{children(id)}</span>
      </span>
      {trailing}
    </>
  );

  const shell =
    "flex min-w-0 items-center gap-3 px-4 py-3 text-left transition-colors";

  if (as === "button") {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-expanded={expanded}
        aria-haspopup="dialog"
        className={`${shell} w-full hover:bg-white/[0.03] ${className ?? ""}`}
      >
        {inner}
      </button>
    );
  }

  return (
    <label
      htmlFor={htmlForField ? id : undefined}
      className={`${shell} cursor-text ${className ?? ""}`}
    >
      {inner}
    </label>
  );
}

/**
 * A native date control, styled to the bar.
 *
 * Native rather than hand-rolled: it brings a real calendar, keyboard entry,
 * the reader's own locale format and — the part that matters here — `min`/`max`
 * enforcement, so an out-of-range date cannot be picked in the first place.
 * `colorScheme: dark` is what makes the browser paint its picker and its
 * built-in indicator for a dark surface instead of a white one.
 */
function DateInput({
  id, value, min, max, onChange,
}: {
  id: string;
  value: string;
  min?: string;
  max?: string;
  onChange: (next: string) => void;
}) {
  return (
    <input
      id={id}
      type="date"
      value={value}
      min={min}
      max={max}
      onChange={(e) => onChange(e.target.value)}
      className="w-full min-w-0 bg-transparent text-[14.5px] font-semibold text-[#F5F7FA] outline-none"
      style={{ colorScheme: "dark" }}
    />
  );
}

/** Rooms, adults and children — including the ages the price route requires. */
function GuestsPopover({
  value,
  onChange,
  onDone,
}: {
  value: HotelSearch;
  onChange: (patch: Partial<HotelSearch>) => void;
  onDone: () => void;
}) {
  const setChildren = (n: number) => {
    const next = value.children.slice(0, n);
    // A new child defaults to an age rather than to undefined: the request
    // needs one, and an empty select would be a hole the reader has to notice.
    while (next.length < n) next.push(8);
    onChange({ children: next });
  };

  return (
    <div
      role="dialog"
      aria-label="Guests and rooms"
      // `right-0` on desktop so the panel cannot hang off the bar's right edge;
      // full width when the bar is stacked.
      className="absolute z-40 mt-2 w-[280px] rounded-[15px] border border-white/[0.08] p-3 shadow-[0_16px_40px_rgba(0,0,0,0.45),0_2px_8px_rgba(0,0,0,0.30)] max-md:inset-x-0 max-md:w-auto md:right-0"
      style={{ background: BAR }}
    >
      <Stepper
        label="Rooms"
        value={value.rooms}
        min={1}
        max={MAX_ROOMS}
        onChange={(rooms) =>
          // Rooms can never outrun adults — the server would take it, but a
          // room with nobody in it is not a thing you can book.
          onChange({ rooms, adults: Math.max(value.adults, rooms) })
        }
      />
      <Stepper
        label="Adults"
        hint="16 or over"
        value={value.adults}
        min={Math.max(1, value.rooms)}
        max={MAX_ADULTS}
        onChange={(adults) => onChange({ adults })}
      />
      <Stepper
        label="Children"
        hint={`0–${MAX_CHILD_AGE}`}
        value={value.children.length}
        min={0}
        max={MAX_CHILDREN}
        onChange={setChildren}
      />

      {value.children.length > 0 && (
        <div className="mt-3 border-t border-white/[0.08] pt-3">
          <p className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-[#8992A3]">
            Age at check-out
          </p>
          {/* Asked because the rate depends on it — a child's age changes both
              the price and whether a room can take them at all. */}
          <div className="mt-2 grid grid-cols-3 gap-2">
            {value.children.map((age, i) => (
              <label key={i} className="block">
                <span className="sr-only">Child {i + 1} age</span>
                <select
                  value={age}
                  onChange={(e) => {
                    const next = value.children.slice();
                    next[i] = Number(e.target.value);
                    onChange({ children: next });
                  }}
                  className="w-full rounded-lg border border-white/[0.08] bg-white/[0.05] px-2 py-1.5 text-[13px] font-semibold text-[#F5F7FA] outline-none focus:border-white/[0.22]"
                  style={{ colorScheme: "dark" }}
                >
                  {Array.from({ length: MAX_CHILD_AGE + 1 }, (_, a) => (
                    <option key={a} value={a}>
                      {a === 0 ? "<1" : a}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={onDone}
        className="mt-3 h-9 w-full rounded-lg bg-white/[0.10] text-[13px] font-bold text-[#F5F7FA] transition-colors hover:bg-white/[0.16]"
      >
        Done
      </button>
    </div>
  );
}

function Stepper({
  label, hint, value, min, max, onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  const btn =
    "grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/[0.12] text-[#F5F7FA] transition-colors hover:bg-white/[0.10] disabled:cursor-not-allowed disabled:border-white/[0.06] disabled:text-[#4A515E]";

  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="min-w-0">
        <span className="block text-[13.5px] font-semibold text-[#F5F7FA]">{label}</span>
        {hint && <span className="block text-[11.5px] text-[#8992A3]">{hint}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(value - 1)}
          disabled={value <= min}
          aria-label={`One fewer ${label.toLowerCase()}`}
          className={btn}
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 14 14" fill="none" aria-hidden>
            <path d="M3 7h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        {/* `aria-live` so a stepper press is announced — the number is the only
            thing that changes, and it is not otherwise in the focus path. */}
        <span
          aria-live="polite"
          className="w-5 text-center text-[14px] font-bold tabular-nums text-[#F5F7FA]"
        >
          {value}
        </span>
        <button
          type="button"
          onClick={() => onChange(value + 1)}
          disabled={value >= max}
          aria-label={`One more ${label.toLowerCase()}`}
          className={btn}
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 14 14" fill="none" aria-hidden>
            <path d="M7 3v8M3 7h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </span>
    </div>
  );
}
