"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, Briefcase, ChevronDown, Clock, Plane, RefreshCcw, Undo2 } from "lucide-react";
import type { Flight, FlightLeg } from "@/lib/travel/data";
import { layoverQuality } from "@/lib/travel/flightRanking";

export const dur = (min: number) => `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m`;

export function money(amount: number, currency = "USD") {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: amount >= 1000 ? 0 : 2 }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

const hhmm = (iso: string) => /T(\d{2}:\d{2})/.exec(iso)?.[1] ?? "—";
const dayShift = (a: string, b: string) => {
  const d = (Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / 86_400_000;
  return d > 0 ? `+${d}` : "";
};

function Logo({ flight }: { flight: Flight }) {
  const [failed, setFailed] = useState(false);
  return flight.logoUrl && !failed ? (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white p-1.5">
      <img src={flight.logoUrl} alt={flight.carrier} loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-contain" />
    </span>
  ) : (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-xs font-bold text-white">{flight.carrierCode}</span>
  );
}

function LegRow({ leg, label }: { leg: FlightLeg; label?: string }) {
  return (
    <div className="flex items-center gap-3 sm:gap-5">
      {label && <span className="hidden w-14 shrink-0 text-[10px] font-semibold uppercase tracking-wider text-white/40 sm:block">{label}</span>}
      <div className="text-right">
        <p className="text-[17px] font-bold tabular-nums text-white">{hhmm(leg.departAt)}</p>
        <p className="text-[11px] text-white/50">{leg.from}</p>
      </div>
      <div className="flex min-w-[96px] flex-1 flex-col items-center">
        <span className="text-[11px] text-white/55">{dur(leg.durationMin)}</span>
        <span className="relative my-1 flex w-full items-center">
          <span className="h-px flex-1 bg-white/20" />
          {leg.layovers.map((l) => (
            <span key={l.airport} title={`${l.airport} · ${dur(l.minutes)}`} className={`mx-0.5 h-1.5 w-1.5 rounded-full ${layoverQuality(l.minutes) < 0.9 ? "bg-amber-400" : "bg-white/50"}`} />
          ))}
          <Plane className="h-3.5 w-3.5 rotate-90 text-white/55" aria-hidden />
        </span>
        <span className={`text-[11px] ${leg.stops === 0 ? "text-neon" : "text-white/55"}`}>
          {leg.stops === 0 ? "Nonstop" : `${leg.stops} stop${leg.stops > 1 ? "s" : ""} · ${leg.layovers.map((l) => l.airport).join(", ")}`}
        </span>
      </div>
      <div>
        <p className="text-[17px] font-bold tabular-nums text-white">
          {hhmm(leg.arriveAt)}
          <sup className="ml-0.5 text-[10px] font-semibold text-amber-300">{dayShift(leg.departAt, leg.arriveAt)}</sup>
        </p>
        <p className="text-[11px] text-white/50">{leg.to}</p>
      </div>
    </div>
  );
}

function Detail({ flight }: { flight: Flight }) {
  return (
    <div className="space-y-4 border-t border-white/[0.06] px-4 pb-4 pt-4 sm:px-5">
      {flight.legs?.map((leg, li) => (
        <div key={li}>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-white/40">
            {flight.legs!.length > 1 ? (li === 0 ? "Outbound" : "Return") : "Itinerary"} · {leg.departAt.slice(0, 10)}
          </p>
          <ol className="space-y-2">
            {leg.segments.map((s, si) => (
              <li key={si}>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-lg bg-white/[0.03] px-3 py-2 text-[12px]">
                  <span className="font-semibold text-white">
                    {hhmm(s.departAt)} {s.from} → {hhmm(s.arriveAt)} {s.to}
                  </span>
                  <span className="text-white/55">{dur(s.durationMin)}</span>
                  <span className="text-white/55">
                    {s.flightNumber} · {s.carrier}
                    {s.operatedBy ? ` · operated by ${s.operatedBy}` : ""}
                    {s.aircraft ? ` · ${s.aircraft}` : ""}
                  </span>
                </div>
                {leg.layovers[si] && (
                  <p className={`my-1.5 flex items-center gap-1.5 pl-3 text-[11px] ${layoverQuality(leg.layovers[si].minutes) < 0.9 ? "text-amber-300" : "text-white/50"}`}>
                    <Clock className="h-3 w-3" aria-hidden />
                    {dur(leg.layovers[si].minutes)} connection in {leg.layovers[si].airport}
                    {leg.layovers[si].minutes < 45 ? " — tight, risk of a missed connection" : leg.layovers[si].minutes > 360 ? " — long wait" : ""}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </div>
      ))}
      <div className="grid gap-2 text-[12px] sm:grid-cols-3">
        <p className="flex items-center gap-2 text-white/70"><Briefcase className="h-4 w-4 text-white/45" aria-hidden /> {flight.baggage}</p>
        <p className="flex items-center gap-2 text-white/70">
          <Undo2 className="h-4 w-4 text-white/45" aria-hidden />
          {flight.refundable === undefined ? "Refund terms not stated" : flight.refundable ? "Refundable before departure" : "Non-refundable"}
        </p>
        <p className="flex items-center gap-2 text-white/70">
          <RefreshCcw className="h-4 w-4 text-white/45" aria-hidden />
          {flight.changeable === undefined ? "Change terms not stated" : flight.changeable ? "Changes allowed (fees may apply)" : "No changes"}
        </p>
      </div>
      {flight.expiresAt && (
        <p className="text-[11px] text-white/40">
          Price held by the airline until {new Date(flight.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.
        </p>
      )}
    </div>
  );
}

export default function FlightResultCard({ flight, badges, sandbox }: { flight: Flight; badges: string[]; sandbox: boolean }) {
  const [open, setOpen] = useState(false);
  const legs = flight.legs?.length
    ? flight.legs
    : [{ from: flight.from, to: flight.to, departAt: `${flight.date}T${flight.departTime}`, arriveAt: `${flight.date}T${flight.arriveTime}`, durationMin: flight.durationMin, stops: flight.stops, segments: [], layovers: [] }];
  const meta = `${flight.date} · ${dur(flight.durationMin)} · ${flight.stops === 0 ? "Nonstop" : `${flight.stops} stop`} · ${flight.cabin}`;
  const href =
    `/travel/checkout?kind=flight&ref=${encodeURIComponent(flight.id)}` +
    `&name=${encodeURIComponent(`${flight.from} → ${flight.to}`)}` +
    `&carrier=${encodeURIComponent(flight.carrier)}` +
    `&meta=${encodeURIComponent(meta)}` +
    (flight.logoUrl ? `&img=${encodeURIComponent(flight.logoUrl)}` : "") +
    `&amount=${flight.priceUsd}&nights=0`;
  const detailId = `detail-${flight.id}`;

  return (
    <article className={`overflow-hidden rounded-2xl border bg-[#090D0E] transition hover:border-white/20 ${badges.includes("Best") ? "border-neon/35 shadow-[0_0_30px_-18px_rgba(0,229,153,0.8)]" : "border-white/[0.08]"}`}>
      <div className="flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-center">
        <div className="flex min-w-0 items-center gap-3 lg:w-48">
          <Logo flight={flight} />
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold text-white">{flight.carrier}</p>
            <p className="text-[11px] text-white/50">{flight.cabin}</p>
          </div>
        </div>

        <div className="flex-1 space-y-3">
          {legs.map((l, i) => (
            <LegRow key={i} leg={l} label={legs.length > 1 ? (i === 0 ? "Out" : "Return") : undefined} />
          ))}
        </div>

        <div className="flex items-end justify-between gap-4 border-t border-white/[0.06] pt-3 lg:w-48 lg:flex-col lg:items-end lg:border-0 lg:pt-0">
          <div className="lg:text-right">
            {badges.length > 0 && (
              <div className="mb-1 flex gap-1 lg:justify-end">
                {badges.map((b) => (
                  <span key={b} className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${b === "Best" ? "bg-neon text-black" : b === "Cheapest" ? "bg-white text-black" : "bg-sky-400 text-black"}`}>
                    {b}
                  </span>
                ))}
              </div>
            )}
            <p className="text-[22px] font-bold tabular-nums text-white">{money(flight.priceUsd, flight.currency)}</p>
            <p className="text-[11px] text-white/45">total, all travellers</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-controls={detailId}
              className="flex h-9 items-center gap-1 whitespace-nowrap rounded-lg border border-white/10 px-3 text-[12px] font-semibold text-white transition hover:border-white/30"
            >
              Details <ChevronDown className={`h-3.5 w-3.5 transition ${open ? "rotate-180" : ""}`} />
            </button>
            <Link href={href} className="flex h-9 items-center whitespace-nowrap rounded-lg bg-neon px-4 text-[12px] font-bold text-black transition hover:brightness-110">
              Review fare
            </Link>
          </div>
        </div>
      </div>
      {sandbox && (
        <p className="flex items-center gap-1.5 border-t border-amber-300/15 bg-amber-300/[0.05] px-5 py-1.5 text-[11px] text-amber-200">
          <AlertTriangle className="h-3 w-3" aria-hidden /> Sandbox fare from Duffel test mode — not a bookable price.
        </p>
      )}
      <div id={detailId} hidden={!open}>
        {open && <Detail flight={flight} />}
      </div>
    </article>
  );
}
