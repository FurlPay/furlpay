import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { parseQuery } from "@/lib/travelParse";
import type {
  TravelFlight,
  TravelFlightsResponse,
  TravelHotelsResponse,
  TravelProperty,
  TravelPropertyResponse,
  TravelStay,
} from "@/lib/types";
import { EmptyState, ErrorPanel, SkeletonPage, openSite, send, usd } from "./shared";

// ---------------------------------------------------------------------------
// Travel — in-popup stay discovery, mirroring the web funnel.
//
// Inventory comes from /api/travel/hotels, which serves LIVE Duffel Stays when
// DUFFEL_API_KEY resolves and falls back to generated inventory otherwise. The
// response carries `source: "duffel" | "demo"` and this UI states which one it
// got — a travel product that presents demo inventory as bookable live rates is
// the fastest way to lose a user's trust (and their money).
//
// Booking deliberately leaves the popup: settlement needs the x402/USDC flow
// and a passkey signature bound to the furlpay.com rpID, which cannot be
// asserted from a chrome-extension:// origin. Same rule as card approvals.
// ---------------------------------------------------------------------------

const SUGGESTED = ["Amsterdam", "Tokyo", "Lisbon", "Dubai"];

export default function TravelTab({ onBack }: { onBack: () => void }) {
  const [mode, setMode] = useState<"stays" | "flights">("stays");
  const [query, setQuery] = useState("");
  const [city, setCity] = useState<string | null>(null);
  const [data, setData] = useState<TravelHotelsResponse | null>(null);
  const [selected, setSelected] = useState<TravelStay | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const reqId = useRef(0);

  const search = useCallback((raw: string) => {
    // Accepts a bare city or a full sentence ("hotel in Tokyo under $150") —
    // parseQuery is the same extractor the travel side panel uses.
    const parsed = parseQuery(raw);
    const target = (parsed.city || raw).trim();
    if (!target) return;

    const id = ++reqId.current;
    setCity(target);
    setLoading(true);
    setError(null);
    send<TravelHotelsResponse>({ type: "GET_TRAVEL_HOTELS", city: target }).then((r) => {
      if (id !== reqId.current) return; // stale response for an older search
      setLoading(false);
      if (r.ok) setData(r.data);
      else setError(r.error);
    });
  }, []);

  if (selected && city) {
    return <StayDetail stay={selected} city={city} onBack={() => setSelected(null)} />;
  }

  const hotels = data?.hotels ?? [];
  const live = data?.source === "duffel";

  return (
    <div style={{ padding: "0 14px" }}>
      <button
        className="btn-ghost"
        style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", marginBottom: 10, fontSize: "0.76rem" }}
        onClick={onBack}
      >
        <Icon name="chevronRight" size={13} style={{ transform: "rotate(180deg)" }} />
        Wallet
      </button>

      <div className="fade-up" style={{ margin: "2px 2px 10px" }}>
        <div style={{ fontSize: "1.02rem", fontWeight: 800, letterSpacing: "-0.3px" }}>Travel</div>
        <div style={{ fontSize: "0.72rem", color: "var(--fp-text-secondary)", display: "flex", alignItems: "center", gap: 5 }}>
          {mode === "flights" ? (
            "Flights you can pay for in USDC"
          ) : data ? (
            <>
              <span className={`status-dot ${live ? "status-dot--on" : "status-dot--off"}`} style={{ width: 5, height: 5 }} />
              {/* Never present generated inventory as live bookable rates. */}
              {live ? `Live rates · ${hotels.length} stays` : `Demo inventory · ${hotels.length} stays`}
            </>
          ) : (
            "Stays you can pay for in USDC"
          )}
        </div>
      </div>

      <div className="seg" role="tablist" aria-label="Travel type" style={{ width: "100%", marginBottom: 10 }}>
        {(["stays", "flights"] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={m === mode}
            className={m === mode ? "active" : ""}
            style={{ flex: 1, textTransform: "capitalize" }}
            onClick={() => setMode(m)}
          >
            {m}
          </button>
        ))}
      </div>

      {mode === "flights" && <FlightSearch />}

      {mode === "stays" && (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          search(query);
        }}
      >
        <div className="search-wrap">
          <Icon name="search" size={15} />
          <input
            className="input"
            placeholder="Where to? e.g. Tokyo"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search destinations"
          />
        </div>
      </form>
      )}

      {mode === "stays" && !data && !loading && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "10px 0 4px" }}>
          {SUGGESTED.map((c) => (
            <button
              key={c}
              className="btn-ghost"
              style={{ padding: "6px 12px", fontSize: "0.74rem" }}
              onClick={() => {
                setQuery(c);
                search(c);
              }}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {mode === "stays" && loading && <SkeletonPage rows={4} label={`Searching stays in ${city}…`} />}

      {mode === "stays" && error && !loading && <ErrorPanel message={error} onRetry={() => city && search(city)} />}

      {mode === "stays" && data && !loading && hotels.length === 0 && (
        <EmptyState
          title={`No stays in ${city}`}
          subtitle="Try a nearby city, or browse destinations on the site."
          actions={[{ label: "Browse destinations", path: "/travel/destinations" }]}
        />
      )}

      {mode === "stays" &&
        !loading &&
        hotels.map((h, i) => (
          <StayCard key={h.id} stay={h} delay={Math.min(i, 10) * 0.03} onOpen={() => setSelected(h)} />
        ))}

      {mode === "stays" && hotels.length > 0 && !loading && (
        <button className="btn-ghost" style={{ width: "100%", margin: "10px 0 4px" }} onClick={() => openSite(`/travel/hotels?city=${encodeURIComponent(city ?? "")}`)}>
          See all on furlpay.com
        </button>
      )}
    </div>
  );
}

/** Tomorrow, as YYYY-MM-DD — a sane default that is always a valid future date. */
function tomorrowIso(): string {
  const d = new Date(Date.now() + 86400_000);
  return d.toISOString().slice(0, 10);
}

const IATA = /^[A-Za-z]{3}$/;

/**
 * Live flight search. Results come from Duffel via POST /api/travel/search
 * (offer ids look like "off_…") with generated inventory as fallback, and the
 * response's `source` decides whether this claims "Live" or "Demo".
 */
function FlightSearch() {
  // The search response already carries every field the detail view renders,
  // so opening an offer costs no extra round-trip — and never leaves the popup.
  const [selected, setSelected] = useState<TravelFlight | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [date, setDate] = useState(tomorrowIso());
  const [data, setData] = useState<TravelFlightsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const reqId = useRef(0);

  const valid = IATA.test(from.trim()) && IATA.test(to.trim()) && !!date;

  function run(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || loading) return;
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    send<TravelFlightsResponse>({
      type: "SEARCH_FLIGHTS",
      from: from.trim().toUpperCase(),
      to: to.trim().toUpperCase(),
      date,
    }).then((r) => {
      if (id !== reqId.current) return;
      setLoading(false);
      if (r.ok) setData(r.data);
      else setError(r.error);
    });
  }

  const results = data?.results ?? [];
  const live = data?.source === "duffel";

  if (selected) return <FlightDetail flight={selected} live={live} onBack={() => setSelected(null)} />;

  return (
    <>
      <form onSubmit={run}>
        <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
          <input
            className="input"
            style={{ flex: 1, textTransform: "uppercase" }}
            placeholder="From (AMS)"
            maxLength={3}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            aria-label="Origin airport code"
          />
          <input
            className="input"
            style={{ flex: 1, textTransform: "uppercase" }}
            placeholder="To (LHR)"
            maxLength={3}
            value={to}
            onChange={(e) => setTo(e.target.value)}
            aria-label="Destination airport code"
          />
        </div>
        <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
          <input
            className="input"
            style={{ flex: 1 }}
            type="date"
            value={date}
            min={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setDate(e.target.value)}
            aria-label="Departure date"
          />
          <button className="btn-primary" style={{ flex: "0 0 88px" }} type="submit" disabled={!valid || loading}>
            {loading ? "…" : "Search"}
          </button>
        </div>
      </form>

      {!data && !loading && !error && (
        <div style={{ fontSize: "0.68rem", color: "var(--fp-text-muted)", marginBottom: 8 }}>
          Enter 3-letter airport codes, e.g. AMS to LHR.
        </div>
      )}

      {loading && <SkeletonPage rows={4} label="Searching live fares…" />}
      {error && !loading && <ErrorPanel message={error} />}

      {data && !loading && (
        <div style={{ fontSize: "0.7rem", color: "var(--fp-text-secondary)", display: "flex", alignItems: "center", gap: 5, marginBottom: 8 }}>
          <span className={`status-dot ${live ? "status-dot--on" : "status-dot--off"}`} style={{ width: 5, height: 5 }} />
          {live ? `Live Duffel fares · ${results.length} offers` : `Demo fares · ${results.length} offers`}
        </div>
      )}

      {data && !loading && results.length === 0 && (
        <EmptyState title="No flights found" subtitle="Try a different date or route." actions={[{ label: "Search on furlpay.com", path: "/travel/flights" }]} />
      )}

      {!loading &&
        results.map((f, i) => (
          <FlightCard key={f.id} flight={f} delay={Math.min(i, 10) * 0.03} onOpen={() => setSelected(f)} />
        ))}
    </>
  );
}

function FlightCard({ flight, delay, onOpen }: { flight: TravelFlight; delay: number; onOpen: () => void }) {
  const [logoOk, setLogoOk] = useState(true);
  const hrs = Math.floor(flight.durationMin / 60);
  const mins = flight.durationMin % 60;

  return (
    <button
      className="glass-panel fade-up"
      style={{
        animationDelay: `${delay}s`,
        width: "100%",
        textAlign: "left",
        padding: "10px 11px",
        marginBottom: 8,
        border: "1px solid var(--fp-border-glass)",
        cursor: "pointer",
      }}
      onClick={onOpen}
      aria-label={`${flight.carrier} ${flight.from} to ${flight.to}, departs ${flight.departTime}, $${Math.round(flight.priceUsd)}`}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        {/* Official carrier mark from Duffel's CDN; the IATA code is the
            fallback so an unknown airline still identifies itself. */}
        <span
          style={{
            width: 26,
            height: 26,
            borderRadius: 7,
            background: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            fontSize: "0.6rem",
            fontWeight: 800,
            color: "#0a0a0c",
            overflow: "hidden",
          }}
        >
          {logoOk && flight.logoUrl ? (
            <img src={flight.logoUrl} alt="" width={22} height={22} loading="lazy" onError={() => setLogoOk(false)} style={{ objectFit: "contain" }} />
          ) : (
            flight.carrierCode
          )}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: "0.84rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {flight.departTime} → {flight.arriveTime}
          </div>
          <div style={{ fontSize: "0.68rem", color: "var(--fp-text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {flight.carrier} · {flight.from}–{flight.to}
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontFamily: "var(--fp-font-mono)", fontWeight: 700, fontSize: "0.84rem" }}>${usd(flight.priceUsd)}</div>
          <div style={{ fontSize: "0.66rem", color: "var(--fp-text-muted)" }}>
            {hrs}h {mins}m
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 7, flexWrap: "wrap" }}>
        <span className="pill" style={{ fontSize: "0.62rem" }}>
          {flight.stops === 0 ? "Non-stop" : `${flight.stops} stop${flight.stops > 1 ? "s" : ""}`}
        </span>
        <span className="pill" style={{ fontSize: "0.62rem", textTransform: "capitalize" }}>{flight.cabin}</span>
        {flight.baggage && <span className="pill" style={{ fontSize: "0.62rem" }}>{flight.baggage}</span>}
      </div>
    </button>
  );
}

/**
 * Flight offer detail, rendered in-popup from the offer already in memory.
 *
 * Booking still hands off to furlpay.com: a Duffel order is money leaving the
 * account, so it needs the x402/USDC flow and a passkey assertion bound to the
 * furlpay.com rpID — which cannot be produced from a chrome-extension://
 * origin. Reading an itinerary shouldn't cost you the popup; paying for one is
 * exactly where the handoff belongs.
 */
function FlightDetail({ flight, live, onBack }: { flight: TravelFlight; live: boolean; onBack: () => void }) {
  const [logoOk, setLogoOk] = useState(true);
  const hrs = Math.floor(flight.durationMin / 60);
  const mins = flight.durationMin % 60;
  const dateLabel = (() => {
    const d = new Date(`${flight.date}T00:00:00`);
    return Number.isNaN(d.getTime())
      ? flight.date
      : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  })();

  return (
    <div>
      <button
        className="btn-ghost"
        style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", marginBottom: 10, fontSize: "0.76rem" }}
        onClick={onBack}
      >
        <Icon name="chevronRight" size={13} style={{ transform: "rotate(180deg)" }} />
        Flights
      </button>

      <div className="fade-up" style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 12 }}>
        <span
          style={{
            width: 32, height: 32, borderRadius: 8, background: "#fff", display: "flex",
            alignItems: "center", justifyContent: "center", flexShrink: 0,
            fontSize: "0.66rem", fontWeight: 800, color: "#0a0a0c", overflow: "hidden",
          }}
        >
          {logoOk && flight.logoUrl ? (
            <img src={flight.logoUrl} alt="" width={26} height={26} onError={() => setLogoOk(false)} style={{ objectFit: "contain" }} />
          ) : (
            flight.carrierCode
          )}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: "0.95rem", letterSpacing: "-0.2px" }}>{flight.carrier}</div>
          <div style={{ fontSize: "0.7rem", color: "var(--fp-text-muted)", display: "flex", alignItems: "center", gap: 5 }}>
            <span className={`status-dot ${live ? "status-dot--on" : "status-dot--off"}`} style={{ width: 5, height: 5 }} />
            {live ? "Live fare" : "Demo fare"} · {dateLabel}
          </div>
        </div>
      </div>

      {/* Itinerary: the timeline is the thing a traveller actually reads. */}
      <div className="glass-panel fade-up" style={{ padding: 14, marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontFamily: "var(--fp-font-mono)", fontWeight: 800, fontSize: "1.05rem" }}>{flight.departTime}</div>
            <div style={{ fontSize: "0.72rem", color: "var(--fp-text-secondary)", fontWeight: 600 }}>{flight.from}</div>
          </div>
          <div style={{ flex: 1, textAlign: "center" }}>
            <div style={{ fontSize: "0.62rem", color: "var(--fp-text-muted)", marginBottom: 2 }}>
              {hrs}h {mins}m
            </div>
            <div style={{ position: "relative", height: 1, background: "var(--fp-border-glass)" }}>
              <span style={{ position: "absolute", right: -3, top: -2.5, width: 6, height: 6, borderRadius: "50%", background: "var(--fp-accent)" }} />
            </div>
            <div style={{ fontSize: "0.62rem", color: "var(--fp-text-muted)", marginTop: 3 }}>
              {flight.stops === 0 ? "Non-stop" : `${flight.stops} stop${flight.stops > 1 ? "s" : ""}`}
            </div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontFamily: "var(--fp-font-mono)", fontWeight: 800, fontSize: "1.05rem" }}>{flight.arriveTime}</div>
            <div style={{ fontSize: "0.72rem", color: "var(--fp-text-secondary)", fontWeight: 600 }}>{flight.to}</div>
          </div>
        </div>
      </div>

      <div className="glass-panel fade-up" style={{ padding: 12, marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div>
            <div className="balance-amount" style={{ fontSize: "1.35rem" }}>${usd(flight.priceUsd)}</div>
            <div style={{ fontSize: "0.68rem", color: "var(--fp-text-muted)" }}>total · settles in USDC</div>
          </div>
          <span className="pill pill--accent" style={{ textTransform: "capitalize" }}>{flight.cabin}</span>
        </div>
      </div>

      <h3 className="section-title">Included</h3>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
        <span className="pill" style={{ fontSize: "0.66rem" }}>{flight.baggage || "Baggage per fare rules"}</span>
        <span className="pill" style={{ fontSize: "0.66rem" }}>
          {flight.stops === 0 ? "Non-stop" : `${flight.stops} stop${flight.stops > 1 ? "s" : ""}`}
        </span>
      </div>

      <button
        className="btn-primary"
        style={{ width: "100%", margin: "14px 0 4px", padding: 11 }}
        onClick={() =>
          openSite(`/travel/flights?from=${flight.from}&to=${flight.to}&date=${flight.date}&offer=${encodeURIComponent(flight.id)}`)
        }
      >
        Book on furlpay.com
      </button>
      <div style={{ fontSize: "0.64rem", color: "var(--fp-text-muted)", textAlign: "center", marginBottom: 6 }}>
        Payment is approved with your passkey on furlpay.com
      </div>
    </div>
  );
}

function StayCard({ stay, delay, onOpen }: { stay: TravelStay; delay: number; onOpen: () => void }) {
  const [imgOk, setImgOk] = useState(true);
  return (
    <button
      className="glass-panel fade-up"
      style={{
        animationDelay: `${delay}s`,
        width: "100%",
        textAlign: "left",
        padding: 0,
        overflow: "hidden",
        marginBottom: 10,
        border: "1px solid var(--fp-border-glass)",
        cursor: "pointer",
      }}
      onClick={onOpen}
      aria-label={`${stay.name}, ${stay.stars} stars, $${Math.round(stay.nightlyUsd)} per night`}
    >
      {imgOk && stay.photo && (
        <img
          src={stay.photo}
          alt=""
          loading="lazy"
          onError={() => setImgOk(false)}
          style={{ width: "100%", height: 94, objectFit: "cover", display: "block" }}
        />
      )}
      <div style={{ padding: "9px 11px 11px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
          <div style={{ fontWeight: 700, fontSize: "0.86rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {stay.name}
          </div>
          <div style={{ fontFamily: "var(--fp-font-mono)", fontWeight: 700, fontSize: "0.84rem", flexShrink: 0 }}>
            ${usd(stay.nightlyUsd)}
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 2 }}>
          <div style={{ fontSize: "0.7rem", color: "var(--fp-text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {"★".repeat(Math.max(0, Math.min(5, Math.round(stay.stars))))} · {stay.type} · {stay.city}
          </div>
          <div style={{ fontSize: "0.66rem", color: "var(--fp-text-muted)", flexShrink: 0 }}>/ night</div>
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 7, flexWrap: "wrap" }}>
          <span className="pill pill--accent" style={{ fontSize: "0.62rem" }}>
            {Number.isFinite(stay.rating) ? stay.rating.toFixed(1) : "—"} ({stay.reviews})
          </span>
          {stay.freeCancellation && <span className="pill" style={{ fontSize: "0.62rem" }}>Free cancellation</span>}
          {stay.roomsLeft <= 3 && (
            <span className="pill" style={{ fontSize: "0.62rem", color: "#fbbf24" }}>
              {stay.roomsLeft} left
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function StayDetail({ stay, city, onBack }: { stay: TravelStay; city: string; onBack: () => void }) {
  const [detail, setDetail] = useState<TravelPropertyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imgOk, setImgOk] = useState(true);

  useEffect(() => {
    send<TravelPropertyResponse>({ type: "GET_TRAVEL_PROPERTY", id: stay.id, city }).then((r) =>
      r.ok ? setDetail(r.data) : setError(r.error)
    );
  }, [stay.id, city]);

  // The list already carries every headline field, so the detail renders
  // immediately from it and fills in rooms when they arrive — no blank screen.
  const p: TravelProperty = detail?.property ?? stay;
  const rooms = detail?.rooms ?? [];

  return (
    <div style={{ padding: "0 14px" }}>
      <button
        className="btn-ghost"
        style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", marginBottom: 10, fontSize: "0.76rem" }}
        onClick={onBack}
      >
        <Icon name="chevronRight" size={13} style={{ transform: "rotate(180deg)" }} />
        Stays
      </button>

      {imgOk && p.photo && (
        <img
          src={p.photo}
          alt=""
          onError={() => setImgOk(false)}
          style={{ width: "100%", height: 120, objectFit: "cover", borderRadius: 12, display: "block", marginBottom: 10 }}
        />
      )}

      <div className="fade-up" style={{ marginBottom: 10 }}>
        <div style={{ fontWeight: 800, fontSize: "1rem", letterSpacing: "-0.3px" }}>{p.name}</div>
        <div style={{ fontSize: "0.72rem", color: "var(--fp-text-muted)" }}>
          {"★".repeat(Math.max(0, Math.min(5, Math.round(p.stars))))} · {p.type} · {p.city}
          {p.country && p.country !== "—" ? `, ${p.country}` : ""}
        </div>
      </div>

      <div className="glass-panel fade-up" style={{ padding: 12, marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div>
            <div className="balance-amount" style={{ fontSize: "1.35rem" }}>${usd(p.nightlyUsd)}</div>
            <div style={{ fontSize: "0.68rem", color: "var(--fp-text-muted)" }}>per night · settles in USDC</div>
          </div>
          <span className="pill pill--accent">
            {Number.isFinite(p.rating) ? p.rating.toFixed(1) : "—"} ({p.reviews})
          </span>
        </div>
      </div>

      {p.amenities?.length > 0 && (
        <>
          <h3 className="section-title">Amenities</h3>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
            {p.amenities.map((a) => (
              <span key={a} className="pill" style={{ fontSize: "0.66rem" }}>
                {a}
              </span>
            ))}
          </div>
        </>
      )}

      {rooms.length > 0 && (
        <>
          <h3 className="section-title">Rooms</h3>
          {rooms.slice(0, 4).map((r, i) => (
            <div key={i} className="asset-row" style={{ cursor: "default" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: "0.82rem" }}>{r.name}</div>
                {r.beds && <div style={{ fontSize: "0.68rem", color: "var(--fp-text-muted)" }}>{r.beds}</div>}
              </div>
              <div style={{ fontFamily: "var(--fp-font-mono)", fontWeight: 600, fontSize: "0.82rem" }}>
                ${usd(r.nightlyUsd)}
              </div>
            </div>
          ))}
        </>
      )}

      {error && <div style={{ fontSize: "0.7rem", color: "var(--fp-text-muted)", marginTop: 8 }}>Room details unavailable — headline rate shown.</div>}

      {/* Booking leaves the popup by design: x402/USDC settlement needs a
          passkey assertion bound to the furlpay.com rpID. */}
      <button
        className="btn-primary"
        style={{ width: "100%", margin: "14px 0 4px", padding: 11 }}
        onClick={() => openSite(`/travel/property/${encodeURIComponent(p.id)}?city=${encodeURIComponent(city)}`)}
      >
        Book on furlpay.com
      </button>
      <div style={{ fontSize: "0.64rem", color: "var(--fp-text-muted)", textAlign: "center", marginBottom: 6 }}>
        Payment is approved with your passkey on furlpay.com
      </div>
    </div>
  );
}
