"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeftRight, Info, Loader2, Plane, Search, SlidersHorizontal, X } from "lucide-react";
import { trackClient } from "@/lib/analytics/client";
import type { Flight } from "@/lib/travel/data";
import { rankFlights, WEIGHTS, type FlightSort } from "@/lib/travel/flightRanking";
import AirportCombobox, { airportLabel, type AirportValue } from "@/components/travel/flights/AirportCombobox";
import type { Airport } from "@/lib/travel/airportSearch";
import PassengersPicker, { type Passengers } from "@/components/travel/flights/PassengersPicker";
import FlightResultCard, { dur, money } from "@/components/travel/flights/FlightResultCard";
import Select from "@/components/form/Select";
import EmptyState, { EMPTY_ACTION_PRIMARY } from "@/components/travel/EmptyState";
import { reportSearchOutcome } from "@/lib/travel/searchTelemetry";

const CABINS: Flight["cabin"][] = ["Economy", "Premium", "Business", "First"];
const CABIN_OPTIONS = CABINS.map((c) => ({ value: c, label: c === "Premium" ? "Premium economy" : c }));
const STOP_OPTIONS = [
  { value: "0", label: "Nonstop only" },
  { value: "1", label: "Up to 1 stop" },
  { value: "2", label: "Up to 2 stops" },
];
const TIME_WINDOWS = [
  { id: "night", label: "Night", hint: "00–05", from: 0, to: 5 },
  { id: "morning", label: "Morning", hint: "05–12", from: 5, to: 12 },
  { id: "afternoon", label: "Afternoon", hint: "12–18", from: 12, to: 18 },
  { id: "evening", label: "Evening", hint: "18–24", from: 18, to: 24 },
] as const;

const today = () => new Date().toISOString().slice(0, 10);

type Result =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "unavailable"; reason: string }
  | { kind: "ok"; flights: Flight[]; highlights: { best?: string; cheapest?: string; fastest?: string }; sandbox: boolean; cached: boolean };

interface Filters {
  maxStops: number | null;
  airlines: Set<string>;
  windows: Set<string>;
  checkedBag: boolean;
  refundable: boolean;
}
const NO_FILTERS = (): Filters => ({ maxStops: null, airlines: new Set(), windows: new Set(), checkedBag: false, refundable: false });

export default function FlightsPage() {
  const [trip, setTrip] = useState<"return" | "oneway">("return");
  const [from, setFrom] = useState<AirportValue | null>(null);
  const [to, setTo] = useState<AirportValue | null>(null);
  // Empty until the traveller picks: the page never chooses dates for them.
  const [depart, setDepart] = useState("");
  const [ret, setRet] = useState("");
  const [pax, setPax] = useState<Passengers>({ adults: 1, childAges: [] });
  const [cabin, setCabin] = useState<Flight["cabin"]>("Economy");
  const [maxConnections, setMaxConnections] = useState<0 | 1 | 2>(1);
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<Result>({ kind: "idle" });
  const [sort, setSort] = useState<FlightSort>("best");
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [showHow, setShowHow] = useState(false);
  const inFlight = useRef(false);

  // /travel/flights?from=LHR&to=SIN&date=…&returnDate=… (homepage search
  // panel, shared links) prefills the form and runs the search once.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const code = (v: string | null) => (v && /^[A-Za-z]{3}$/.test(v) ? v.toUpperCase() : null);
    const date = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
    const qTo = code(q.get("to"));
    if (!qTo) return;
    const qFrom = code(q.get("from"));
    const next = {
      from: qFrom ? { iata: qFrom, label: qFrom } : null,
      to: { iata: qTo, label: qTo },
      depart: date(q.get("date")),
      ret: date(q.get("returnDate")),
      adults: Math.min(9, Math.max(1, Number(q.get("adults")) || 1)),
      childAges: (q.get("children") ?? "")
        .split(",")
        .filter((s) => /^\d{1,2}$/.test(s) && Number(s) <= 17)
        .slice(0, 8)
        .map(Number),
    };
    const qCabinRaw = q.get("cabin");
    const qCabin = qCabinRaw && (CABINS as string[]).includes(qCabinRaw) ? (qCabinRaw as Flight["cabin"]) : "Economy";
    const qStopsRaw = q.get("stops");
    const qStops: 0 | 1 | 2 = qStopsRaw === "0" ? 0 : qStopsRaw === "2" ? 2 : 1;
    setCabin(qCabin);
    setMaxConnections(qStops);
    setFrom(next.from);
    setTo(next.to);
    if (next.depart) setDepart(next.depart);
    if (next.ret) setRet(next.ret);
    else setTrip("oneway");
    setPax({ adults: next.adults, childAges: next.childAges });
    // Show "London (LHR)" rather than a bare code once the index answers.
    const named = async (code: string, set: (v: AirportValue) => void) => {
      try {
        const r = await fetch(`/api/travel/airports?q=${code}&limit=1`);
        const a = ((await r.json()) as { airports?: Airport[] }).airports?.[0];
        if (a?.iata === code) set({ iata: code, label: airportLabel(a) });
      } catch {
        /* the bare code is still correct */
      }
    };
    void named(qTo, setTo);
    if (qFrom) void named(qFrom, setFrom);
    // Auto-run only a COMPLETE search: both airports and a departure date.
    if (next.from && next.depart) void run({ ...next, depart: next.depart, trip: next.ret ? "return" : "oneway", pax: { adults: next.adults, childAges: next.childAges }, cabin: qCabin, stops: qStops });
    // Runs once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run(o?: { from: AirportValue | null; to: AirportValue; depart: string; ret: string | null; trip: "return" | "oneway"; pax: Passengers; cabin?: Flight["cabin"]; stops?: 0 | 1 | 2 }) {
    const cab = o?.cabin ?? cabin;
    const stops = o?.stops ?? maxConnections;
    const f = o?.from ?? from;
    const t = o?.to ?? to;
    const d = o?.depart ?? depart;
    const r = (o ? o.trip : trip) === "return" ? (o ? o.ret : ret) : null;
    const p = o?.pax ?? pax;
    // One search at a time. A ref, not state: three submits in the same tick
    // all read the pre-render state, so a state check lets every one through.
    if (inFlight.current) return;
    setFormError(null);
    if (!f) return setFormError("Choose a valid departure airport.");
    if (!t) return setFormError("Choose a valid destination airport.");
    if (f.iata === t.iata) return setFormError("Origin and destination must be different airports.");
    if (!d) return setFormError("Choose a departure date.");
    if (d < today()) return setFormError("Choose a departure date from today onwards.");
    if ((o ? o.trip : trip) === "return" && !r) return setFormError("Choose a return date, or switch to one way.");
    if (r && r < d) return setFormError("Choose a return date on or after departure.");

    trackClient("travel_search", { metadata: { source: "flights", trip: r ? "return" : "oneway" } });
    inFlight.current = true;
    setResult({ kind: "loading" });
    setFilters(NO_FILTERS());
    const qs = new URLSearchParams({ from: f.iata, to: t.iata, date: d, adults: String(p.adults), ...(r ? { returnDate: r } : {}) });
    // Everything that changes the offers goes in the URL, so a refresh or a
    // shared link repeats the same search.
    if (p.childAges.length) qs.set("children", p.childAges.join(","));
    if (cab !== "Economy") qs.set("cabin", cab);
    if (stops !== 1) qs.set("stops", String(stops));
    window.history.replaceState(null, "", `/travel/flights?${qs}`);
    try {
      const res = await fetch("/api/travel/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "flights",
          from: f.iata,
          to: t.iata,
          date: d,
          ...(r ? { returnDate: r } : {}),
          adults: p.adults,
          childAges: p.childAges,
          cabin: cab,
          maxStops: stops,
        }),
      });
      const body = await res.json().catch(() => ({}));
      // Show the server's human message; never a raw error code or status.
      if (!res.ok) {
        reportSearchOutcome("flights", "failed");
        return setResult({ kind: "error", message: typeof body?.detail === "string" ? body.detail : "We couldn't search flights right now. Try again." });
      }
      if (body.source !== "duffel" || !body.results?.length) {
        reportSearchOutcome("flights", "unavailable", { reason: body.unavailableReason ?? "no_offers" });
        return setResult({ kind: "unavailable", reason: body.unavailableReason ?? "no_offers" });
      }
      reportSearchOutcome("flights", "results", { count: body.results.length });
      setResult({ kind: "ok", flights: body.results, highlights: body.highlights ?? {}, sandbox: body.isLiveSearch === false, cached: !!body.cached });
    } catch {
      reportSearchOutcome("flights", "failed");
      setResult({ kind: "error", message: "We couldn't reach flight search. Check your connection and try again." });
    } finally {
      inFlight.current = false;
    }
  }

  // Memoised so the filter/sort memos below recompute only when results change.
  const all = useMemo(() => (result.kind === "ok" ? result.flights : []), [result]);
  const airlines = useMemo(() => {
    const m = new Map<string, { name: string; min: number; currency?: string }>();
    for (const f of all) {
      const cur = m.get(f.carrierCode);
      if (!cur || f.priceUsd < cur.min) m.set(f.carrierCode, { name: f.carrier, min: f.priceUsd, currency: f.currency });
    }
    return [...m.entries()].sort((a, b) => a[1].min - b[1].min);
  }, [all]);

  const visible = useMemo(() => {
    const hourOf = (f: Flight) => Number(/T(\d{2})/.exec(f.legs?.[0]?.departAt ?? `T${f.departTime}`)?.[1] ?? NaN);
    const filtered = all.filter((f) => {
      if (filters.maxStops !== null && f.stops > filters.maxStops) return false;
      if (filters.airlines.size && !filters.airlines.has(f.carrierCode)) return false;
      if (filters.checkedBag && !(f.bags && f.bags.checked > 0)) return false;
      if (filters.refundable && f.refundable !== true) return false;
      if (filters.windows.size) {
        const h = hourOf(f);
        if (!TIME_WINDOWS.some((w) => filters.windows.has(w.id) && h >= w.from && h < w.to)) return false;
      }
      return true;
    });
    return rankFlights(filtered, sort);
  }, [all, filters, sort]);

  const tabs = useMemo(() => {
    const top = (s: FlightSort) => rankFlights(visible, s)[0];
    return (["best", "cheapest", "fastest"] as const).map((s) => ({ s, f: top(s) }));
  }, [visible]);

  const badgesFor = (f: Flight) => {
    if (result.kind !== "ok") return [];
    const h = result.highlights;
    return [f.id === h.best && "Best", f.id === h.cheapest && "Cheapest", f.id === h.fastest && "Fastest"].filter(Boolean) as string[];
  };
  const activeFilters =
    (filters.maxStops !== null ? 1 : 0) + filters.airlines.size + filters.windows.size + (filters.checkedBag ? 1 : 0) + (filters.refundable ? 1 : 0);
  const toggle = (set: Set<string>, v: string) => {
    const n = new Set(set);
    if (n.has(v)) n.delete(v);
    else n.add(v);
    return n;
  };

  return (
    <div className="mx-auto max-w-[1400px] px-4 pb-24 pt-6 sm:px-6 lg:px-10">
      <h1 className="flex items-center gap-2 text-[26px] font-bold tracking-tight text-white">
        <Plane className="h-6 w-6 text-neon" aria-hidden /> Flights
      </h1>
      <p className="mt-1 text-[13px] text-white/55">Search airline offers through Duffel. Pay with USDC, SOL, BTC or card.</p>

      {/* ── Search ─────────────────────────────────────────────────────── */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
        noValidate
        className="mt-5 rounded-[20px] border border-neon/25 bg-[rgba(10,15,15,0.88)] p-4 shadow-[0_0_60px_-28px_rgba(0,229,153,0.5)] sm:p-5"
      >
        <div className="flex flex-wrap items-center gap-2">
          <div role="radiogroup" aria-label="Trip type" className="flex rounded-[10px] border border-white/[0.08] bg-black/30 p-0.5">
            {(["return", "oneway"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={trip === t}
                onClick={() => setTrip(t)}
                className={`rounded-lg px-3.5 py-1.5 text-[12px] font-semibold transition ${trip === t ? "bg-neon text-black" : "text-white/70 hover:text-white"}`}
              >
                {t === "return" ? "Return" : "One way"}
              </button>
            ))}
          </div>
          <Select ariaLabel="Cabin class" value={cabin} options={CABIN_OPTIONS} onValueChange={(v) => setCabin(v as Flight["cabin"])} className="!w-[172px]" />
          <Select ariaLabel="Maximum stops" value={String(maxConnections)} options={STOP_OPTIONS} onValueChange={(v) => setMaxConnections(Number(v) as 0 | 1 | 2)} className="!w-[150px]" />
        </div>

        {/* Two rows below xl (airports / dates, travellers, search), one row from
            xl up. A single seven-column row at 1024px truncated every field. */}
        <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.3fr)] xl:items-end">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-end">
          <AirportCombobox kind="from" label="From" placeholder="City or airport" value={from} onChange={setFrom} invalid={!!formError && !from} />
          <button
            type="button"
            onClick={() => {
              setFrom(to);
              setTo(from);
            }}
            aria-label="Swap origin and destination"
            className="mx-auto flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-white/80 transition hover:border-neon hover:text-neon md:mb-1"
          >
            <ArrowLeftRight className="h-4 w-4" />
          </button>
          <AirportCombobox kind="to" label="To" placeholder="City or airport" value={to} onChange={setTo} invalid={!!formError && !to} />
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.25fr)_auto] md:items-end">
            <label className="block text-[11px] font-medium text-white/55">
              Depart
              <input type="date" value={depart} min={today()} onChange={(e) => setDepart(e.target.value)} className="mt-1.5 w-full rounded-xl border border-white/[0.08] bg-black/30 px-3 py-2.5 text-[14px] text-white [color-scheme:dark] focus:border-neon/50 focus:outline-none" />
            </label>
            <label className={`block text-[11px] font-medium ${trip === "oneway" ? "text-white/25" : "text-white/55"}`}>
              Return
              <input type="date" value={trip === "oneway" ? "" : ret} min={depart || today()} disabled={trip === "oneway"} onChange={(e) => setRet(e.target.value)} className="mt-1.5 w-full rounded-xl border border-white/[0.08] bg-black/30 px-3 py-2.5 text-[14px] text-white [color-scheme:dark] focus:border-neon/50 focus:outline-none disabled:opacity-40" />
            </label>
          <div className="col-span-2 md:col-span-1">
            <PassengersPicker value={pax} onChange={setPax} />
          </div>
          <button type="submit" disabled={result.kind === "loading"} className="flex h-[46px] w-full items-center justify-center gap-2 col-span-2 whitespace-nowrap rounded-xl bg-neon px-5 text-[15px] md:col-span-1 md:w-[176px] font-bold text-black shadow-[0_0_28px_-8px_rgba(0,229,153,0.7)] transition hover:brightness-110 active:scale-[0.98] disabled:opacity-70">
            {result.kind === "loading" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Search className="h-4 w-4" aria-hidden />}
            {result.kind === "loading" ? "Searching…" : "Search"}
          </button>
          </div>
        </div>
        {formError && (
          <p id="flight-form-error" role="alert" className="mt-3 text-[12px] text-red-400">
            {formError}
          </p>
        )}
      </form>

      {/* ── Results ────────────────────────────────────────────────────── */}
      <div className="mt-6" aria-live="polite" aria-busy={result.kind === "loading"}>
        {result.kind === "idle" && (
          <p className="rounded-2xl border border-white/[0.06] bg-[#090D0E] px-5 py-10 text-center text-[13px] text-white/55">
            Choose a route to compare airline offers. Results are ranked by our <strong className="text-white/80">Best</strong> score — price, journey time, stops and connection quality — and can be re-sorted by price or speed.
          </p>
        )}

        {result.kind === "loading" && (
          <div className="space-y-3" aria-label="Searching airlines">
            <p className="text-[12px] text-white/55">Asking airlines for live offers — this usually takes a few seconds.</p>
            {[0, 1, 2, 3].map((n) => (
              <div key={n} className="h-[112px] rounded-2xl border border-white/[0.06] bg-[linear-gradient(90deg,rgba(255,255,255,0.03),rgba(255,255,255,0.08),rgba(255,255,255,0.03))] bg-[length:200%_100%] motion-safe:animate-shimmer" />
            ))}
          </div>
        )}

        {result.kind === "error" && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-500/25 bg-red-500/[0.06] px-5 py-4">
            <p className="text-[13px] text-red-200">{result.message}</p>
            <button type="button" onClick={() => run()} className="text-[13px] font-semibold text-white hover:text-neon">Try again</button>
          </div>
        )}

        {result.kind === "unavailable" && (
          <EmptyState
            icon={<Plane className="h-5 w-5" />}
            title={result.reason === "no_live_provider" ? "Live flight search isn't connected on this deployment" : "No airline returned an offer for this search"}
          >
            {result.reason === "no_live_provider"
              ? "We only show fares an airline actually quoted, so there is nothing to list until a live supplier is configured."
              : "Try other dates, allow more stops, or a nearby airport. We never fill this page with estimated fares."}
          </EmptyState>
        )}

        {result.kind === "ok" && (
          <div className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
            {/* Filters */}
            {showFilters && <button type="button" aria-label="Close filters" onClick={() => setShowFilters(false)} className="fixed inset-0 z-[55] bg-black/60 lg:hidden" />}
            {/* Below lg the filters are a bottom sheet over the results; from lg
                up they are a static side rail. */}
            <aside
              className={`${showFilters ? "fixed inset-x-0 bottom-0 z-[60] max-h-[80vh] overflow-y-auto rounded-t-2xl border-t" : "hidden"} border-white/[0.08] bg-[#090D0E] p-4 lg:static lg:z-auto lg:block lg:max-h-none lg:overflow-visible lg:rounded-2xl lg:border`}
              aria-label="Filters"
            >
              <div className="mb-3 flex items-center justify-between">
                <p className="text-[13px] font-semibold text-white">Filters</p>
                {activeFilters > 0 && (
                  <button type="button" onClick={() => setFilters(NO_FILTERS())} className="text-[12px] text-neon hover:underline">Clear all</button>
                )}
              </div>
              <fieldset className="space-y-1.5 border-t border-white/[0.06] py-3">
                <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-white/40">Stops</legend>
                {[{ v: null, l: "Any" }, { v: 0, l: "Nonstop only" }, { v: 1, l: "Up to 1 stop" }].map((o) => (
                  <label key={String(o.v)} className="flex items-center gap-2 text-[13px] text-white/80">
                    <input type="radio" name="stops" checked={filters.maxStops === o.v} onChange={() => setFilters({ ...filters, maxStops: o.v })} className="accent-[#00E599]" />
                    {o.l}
                  </label>
                ))}
              </fieldset>
              <fieldset className="border-t border-white/[0.06] py-3">
                <legend className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-white/40">Departure time</legend>
                <div className="grid grid-cols-2 gap-1.5">
                  {TIME_WINDOWS.map((w) => (
                    <button key={w.id} type="button" aria-pressed={filters.windows.has(w.id)} onClick={() => setFilters({ ...filters, windows: toggle(filters.windows, w.id) })} className={`rounded-lg border px-2 py-1.5 text-left text-[12px] transition ${filters.windows.has(w.id) ? "border-neon bg-neon/10 text-white" : "border-white/[0.08] text-white/70 hover:border-white/25"}`}>
                      {w.label}
                      <span className="block text-[10px] text-white/45">{w.hint}</span>
                    </button>
                  ))}
                </div>
              </fieldset>
              <fieldset className="space-y-1.5 border-t border-white/[0.06] py-3">
                <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-white/40">Fare</legend>
                <label className="flex items-center gap-2 text-[13px] text-white/80">
                  <input type="checkbox" checked={filters.checkedBag} onChange={(e) => setFilters({ ...filters, checkedBag: e.target.checked })} className="accent-[#00E599]" /> Checked bag included
                </label>
                <label className="flex items-center gap-2 text-[13px] text-white/80">
                  <input type="checkbox" checked={filters.refundable} onChange={(e) => setFilters({ ...filters, refundable: e.target.checked })} className="accent-[#00E599]" /> Refundable
                </label>
              </fieldset>
              {airlines.length > 1 && (
                <fieldset className="space-y-1.5 border-t border-white/[0.06] pt-3">
                  <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-white/40">Airlines</legend>
                  {airlines.map(([code, a]) => (
                    <label key={code} className="flex items-center justify-between gap-2 text-[13px] text-white/80">
                      <span className="flex min-w-0 items-center gap-2">
                        <input type="checkbox" checked={filters.airlines.has(code)} onChange={() => setFilters({ ...filters, airlines: toggle(filters.airlines, code) })} className="accent-[#00E599]" />
                        <span className="truncate">{a.name}</span>
                      </span>
                      <span className="shrink-0 text-[11px] text-white/45">{money(a.min, a.currency)}</span>
                    </label>
                  ))}
                </fieldset>
              )}
              <button type="button" onClick={() => setShowFilters(false)} className="sticky bottom-0 mt-4 w-full rounded-xl bg-neon py-3 text-sm font-bold text-black lg:hidden">
                Show {visible.length} offer{visible.length === 1 ? "" : "s"}
              </button>
            </aside>

            <section aria-label="Flight results" className="min-w-0">
              {/* Sort tabs — each shows its own top result. */}
              <div role="tablist" aria-label="Sort results" className="grid grid-cols-3 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#090D0E]">
                {tabs.map(({ s, f }) => (
                  <button
                    key={s}
                    role="tab"
                    type="button"
                    aria-selected={sort === s}
                    onClick={() => setSort(s)}
                    className={`border-b-2 px-3 py-3 text-left transition sm:px-4 ${sort === s ? "border-neon bg-neon/[0.06]" : "border-transparent hover:bg-white/[0.03]"}`}
                  >
                    <span className="block text-[12px] font-semibold capitalize text-white">{s}</span>
                    {f ? (
                      <span className="block text-[11px] text-white/55">
                        <span className="font-semibold text-white">{money(f.priceUsd, f.currency)}</span> · {dur(f.durationMin)}
                      </span>
                    ) : (
                      <span className="block text-[11px] text-white/40">—</span>
                    )}
                  </button>
                ))}
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[12px] text-white/55">
                  {visible.length} of {all.length} offers{result.cached ? " · refreshed within the last few minutes" : ""}
                </p>
                <div className="flex items-center gap-3">
                  <button type="button" onClick={() => setShowHow((v) => !v)} aria-expanded={showHow} className="flex items-center gap-1 text-[12px] text-white/60 hover:text-white">
                    <Info className="h-3.5 w-3.5" aria-hidden /> How “Best” works
                  </button>
                  <button type="button" onClick={() => setShowFilters((v) => !v)} className="flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1 text-[12px] text-white lg:hidden">
                    <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden /> Filters{activeFilters ? ` (${activeFilters})` : ""}
                  </button>
                </div>
              </div>
              {showHow && (
                <div className="mt-2 rounded-xl border border-white/[0.08] bg-black/30 p-4 text-[12px] leading-relaxed text-white/65">
                  <button type="button" onClick={() => setShowHow(false)} aria-label="Close" className="float-right text-white/50 hover:text-white"><X className="h-4 w-4" /></button>
                  Best weighs price ({WEIGHTS.price * 100}%), total journey time ({WEIGHTS.duration * 100}%), stops and connection quality ({WEIGHTS.stops * 100}%) and departure time ({WEIGHTS.schedule * 100}%), each relative to the other offers in this search. Connections under 45 minutes or over 2½ hours count against an offer, as do departures before 6am. Nobody pays to be ranked, and cashback plays no part.
                </div>
              )}

              <div className="mt-3 space-y-3">
                {visible.length === 0 ? (
                  <EmptyState
                    icon={<SlidersHorizontal className="h-5 w-5" />}
                    title="No offers match these filters"
                    actions={<button type="button" onClick={() => setFilters(NO_FILTERS())} className={EMPTY_ACTION_PRIMARY}>Clear filters</button>}
                  >
                    The airlines did quote this route — your filters are hiding every offer.
                  </EmptyState>
                ) : (
                  visible.map((f) => <FlightResultCard key={f.id} flight={f} badges={badgesFor(f)} sandbox={result.sandbox} />)
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
