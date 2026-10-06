"use client";

import { useEffect, useId, useRef, useState } from "react";
import { MAX_STAY_NIGHTS, nightsOf, validStay, type StayContext } from "@/lib/hotels/mapPrices";

// The stay control in the hotel map's filter row.
//
// Prices appear on the map only once a stay is chosen: a nightly rate is a
// quote for specific dates and a party, so without them there is nothing true
// to show. This is the control that turns them on.
//
// The panel is position: fixed from the button's rect, because the filter row
// scrolls sideways on phones and would clip an absolutely-positioned dropdown.

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function short(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

export default function StayPicker({
  stay,
  onChange,
  today,
}: {
  stay: StayContext | null;
  onChange: (s: StayContext | null) => void;
  /** Today as YYYY-MM-DD in the reader's calendar. */
  today: string;
}) {
  const [open, setOpen] = useState(false);
  const [checkIn, setCheckIn] = useState(stay?.checkIn ?? "");
  const [checkOut, setCheckOut] = useState(stay?.checkOut ?? "");
  const [adults, setAdults] = useState(stay?.adults ?? 2);
  const [error, setError] = useState<string | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const firstInput = useRef<HTMLInputElement>(null);
  const id = useId();

  // Opening reseeds the fields from the applied stay, so a cancelled edit
  // never lingers into the next open.
  function toggle() {
    if (open) return setOpen(false);
    setCheckIn(stay?.checkIn ?? "");
    setCheckOut(stay?.checkOut ?? "");
    setAdults(stay?.adults ?? 2);
    setError(null);
    const r = btn.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 8, left: Math.max(12, Math.min(r.left, window.innerWidth - 312)) });
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    firstInput.current?.focus();
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
    const onResize = () => setOpen(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  function apply() {
    const next = validStay({ checkIn, checkOut, adults }, today);
    if (!next) {
      setError(
        !checkIn || !checkOut
          ? "Choose both dates."
          : checkOut <= checkIn
            ? "Check-out must be after check-in."
            : checkIn < today
              ? "Check-in can't be in the past."
              : `Stays are 1–${MAX_STAY_NIGHTS} nights, starting within 330 days.`
      );
      return;
    }
    onChange(next);
    setOpen(false);
    btn.current?.focus();
  }

  const label = stay
    ? `${short(stay.checkIn)} – ${short(stay.checkOut)} · ${stay.adults} ${stay.adults === 1 ? "guest" : "guests"}`
    : "Add dates for prices";

  return (
    <>
      <button
        ref={btn}
        type="button"
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        className={`flex h-[38px] shrink-0 items-center gap-2 rounded-full border px-4 text-[13px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00E6A7] ${
          stay
            ? "border-[#00E6A7] bg-[rgba(0,230,167,0.10)] text-[#00E6A7]"
            : "border-white/[0.10] bg-[#090D0E] text-[#D9DEDC] hover:border-white/[0.15] hover:bg-white/[0.055] hover:text-white"
        }`}
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
          <path d="M3.5 10h17M8 3v4M16 3v4" strokeLinecap="round" />
        </svg>
        {label}
      </button>

      {open && pos && (
        <div
          ref={panel}
          id={id}
          role="dialog"
          aria-label="Stay dates and guests"
          className="fixed z-[70] w-[300px] rounded-[16px] border border-white/[0.10] bg-[#090D0E] p-4 shadow-[0_24px_60px_rgba(0,0,0,0.55)]"
          style={{ top: pos.top, left: pos.left }}
        >
          <div className="grid grid-cols-2 gap-2.5">
            <label className="flex flex-col gap-1 text-[11.5px] font-medium text-[#A4AAA9]">
              Check-in
              <input
                ref={firstInput}
                type="date"
                value={checkIn}
                min={today}
                onChange={(e) => {
                  setCheckIn(e.target.value);
                  if (e.target.value && (!checkOut || checkOut <= e.target.value)) setCheckOut(addDays(e.target.value, 1));
                  setError(null);
                }}
                className="h-10 rounded-[10px] border border-white/[0.10] bg-[#050909] px-2.5 text-[13px] text-[#F5F7F6] [color-scheme:dark] focus:border-[#00E6A7]/60 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11.5px] font-medium text-[#A4AAA9]">
              Check-out
              <input
                type="date"
                value={checkOut}
                min={checkIn ? addDays(checkIn, 1) : addDays(today, 1)}
                onChange={(e) => {
                  setCheckOut(e.target.value);
                  setError(null);
                }}
                className="h-10 rounded-[10px] border border-white/[0.10] bg-[#050909] px-2.5 text-[13px] text-[#F5F7F6] [color-scheme:dark] focus:border-[#00E6A7]/60 focus:outline-none"
              />
            </label>
          </div>

          <div className="mt-3 flex items-center justify-between">
            <span className="text-[13px] text-[#C9CFCD]" id={`${id}-adults`}>Adults</span>
            <div className="flex items-center gap-2" role="group" aria-labelledby={`${id}-adults`}>
              <button
                type="button"
                onClick={() => setAdults((a) => Math.max(1, a - 1))}
                disabled={adults <= 1}
                aria-label="One fewer adult"
                className="flex h-8 w-8 items-center justify-center rounded-full border border-white/[0.12] text-white disabled:opacity-35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00E6A7]"
              >
                −
              </button>
              <span className="w-5 text-center text-[14px] font-semibold text-white" aria-live="polite">{adults}</span>
              <button
                type="button"
                onClick={() => setAdults((a) => Math.min(9, a + 1))}
                disabled={adults >= 9}
                aria-label="One more adult"
                className="flex h-8 w-8 items-center justify-center rounded-full border border-white/[0.12] text-white disabled:opacity-35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00E6A7]"
              >
                +
              </button>
            </div>
          </div>

          {checkIn && checkOut && checkOut > checkIn && !error && (
            <p className="mt-2 text-[11.5px] text-[#6E7675]">
              {nightsOf({ checkIn, checkOut, adults })} nights · live rates from our booking supplier
            </p>
          )}
          {error && (
            <p role="alert" className="mt-2 text-[12px] text-red-300">
              {error}
            </p>
          )}

          <div className="mt-4 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setOpen(false);
                btn.current?.focus();
              }}
              disabled={!stay}
              className="h-10 rounded-[10px] px-3 text-[13px] font-semibold text-[#A4AAA9] hover:text-white disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00E6A7]"
            >
              Clear dates
            </button>
            <button
              type="button"
              onClick={apply}
              className="h-10 rounded-[10px] bg-[#00E6A7] px-5 text-[13px] font-bold text-[#030505] hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              Show prices
            </button>
          </div>
        </div>
      )}
    </>
  );
}
