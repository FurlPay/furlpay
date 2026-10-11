"use client";

import { useState } from "react";
import { Globe, ShieldCheck, ShieldAlert, ShieldQuestion, FileWarning, CheckCircle2, XCircle, ExternalLink } from "lucide-react";
import { SUPPORTED_COUNTRIES, type EntryRequirement, type VisaStatus } from "@/lib/travel/entryRequirements";
import Select from "@/components/form/Select";

const COUNTRY_OPTIONS = SUPPORTED_COUNTRIES.map((c) => ({ value: c.iso, label: c.name }));

// Client widget for the Visa & Immigration Center and the checkout panel. Posts
// to /api/travel/entry-requirements and renders the assessment. The data is
// self-contained and indicative — the advisory line is always shown.

type Tone = "good" | "warn" | "bad" | "neutral";

const STATUS_TONE: Record<VisaStatus, Tone> = {
  domestic: "good",
  free_movement: "good",
  visa_free: "good",
  eta: "warn",
  visa_on_arrival: "warn",
  evisa: "warn",
  visa_required: "bad",
  check: "neutral",
};

const TONE_CLASS: Record<Tone, string> = {
  good: "border-neon/40 bg-neon/[0.08] text-neon",
  warn: "border-amber-400/40 bg-amber-400/[0.08] text-amber-300",
  bad: "border-loss/40 bg-loss/[0.08] text-loss",
  neutral: "border-white/15 bg-white/[0.04] text-textSecondary",
};

function ToneIcon({ tone, className }: { tone: Tone; className?: string }) {
  if (tone === "good") return <ShieldCheck className={className} />;
  if (tone === "warn") return <ShieldAlert className={className} />;
  if (tone === "bad") return <FileWarning className={className} />;
  return <ShieldQuestion className={className} />;
}

export default function EntryRequirementsCheck({
  defaultNationality = "",
  defaultDestination = "",
}: {
  defaultNationality?: string;
  defaultDestination?: string;
}) {
  const [nationality, setNationality] = useState(defaultNationality);
  const [destination, setDestination] = useState(defaultDestination);
  const [passportExpiry, setPassportExpiry] = useState("");
  const [travelDate, setTravelDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EntryRequirement | null>(null);

  async function check() {
    if (!nationality || !destination) {
      setError("Choose your nationality and destination.");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/travel/entry-requirements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nationality,
          destination,
          passportExpiry: passportExpiry || undefined,
          departureDate: travelDate || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.detail ?? json?.error ?? "Couldn't check requirements.");
      } else {
        setResult(json as EntryRequirement);
      }
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  const tone: Tone = result ? STATUS_TONE[result.visa.status] : "neutral";
  const passportBad = result?.passport.ok === false;

  return (
    <div className="rounded-card border border-white/10 bg-charcoal p-5">
      <div className="flex items-center gap-2 text-neon">
        <Globe className="h-5 w-5" />
        <span className="text-xs font-semibold uppercase tracking-wider">Entry requirements</span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="text-xs font-semibold text-textSecondary">
          <span id="entry-nationality">Your nationality</span>
          <Select labelId="entry-nationality" size="md" value={nationality} onValueChange={setNationality} options={COUNTRY_OPTIONS} placeholder="Select a country" className="mt-1" />
        </div>
        <div className="text-xs font-semibold text-textSecondary">
          <span id="entry-destination">Destination</span>
          <Select labelId="entry-destination" size="md" value={destination} onValueChange={setDestination} options={COUNTRY_OPTIONS} placeholder="Select a country" className="mt-1" />
        </div>
        <label className="text-xs font-semibold text-textSecondary">
          Passport expiry <span className="font-normal">(optional)</span>
          <input
            type="date"
            value={passportExpiry}
            onChange={(e) => setPassportExpiry(e.target.value)}
            className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white focus:border-neon focus:outline-none [color-scheme:dark]"
          />
        </label>
        <label className="text-xs font-semibold text-textSecondary">
          Travel date <span className="font-normal">(optional)</span>
          <input
            type="date"
            value={travelDate}
            onChange={(e) => setTravelDate(e.target.value)}
            className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white focus:border-neon focus:outline-none [color-scheme:dark]"
          />
        </label>
      </div>

      <button
        onClick={check}
        disabled={busy}
        className="mt-4 w-full rounded-xl bg-neon py-3 text-sm font-bold text-black transition enabled:hover:bg-neonDeep disabled:opacity-40"
      >
        {busy ? "Checking…" : "Check requirements"}
      </button>

      {error && <p className="mt-3 rounded-lg bg-loss/15 px-3 py-2 text-center text-xs text-loss">{error}</p>}

      {result && (
        <div className="mt-5 space-y-3">
          {/* Visa status */}
          <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${TONE_CLASS[tone]}`}>
            <ToneIcon tone={tone} className="mt-0.5 h-5 w-5 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-bold">
                {result.visa.label}
                {result.visa.maxStayDays ? ` · up to ${result.visa.maxStayDays} days` : ""}
              </p>
              {result.visa.detail && <p className="mt-0.5 text-xs opacity-90">{result.visa.detail}</p>}
              <p className="mt-0.5 text-[11px] opacity-70">Destination: {result.destinationName}</p>
              {result.visa.actionUrl && (
                <a
                  href={result.visa.actionUrl}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="mt-1 inline-flex items-center gap-1 text-xs font-semibold underline underline-offset-2"
                >
                  Official source <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>

          {/* Passport validity */}
          <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
            {result.passport.ok === undefined ? (
              <ShieldQuestion className="mt-0.5 h-5 w-5 shrink-0 text-textSecondary" />
            ) : passportBad ? (
              <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-loss" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-neon" />
            )}
            <div>
              <p className="text-sm font-semibold text-white">Passport validity</p>
              <p className={`mt-0.5 text-xs ${passportBad ? "text-loss" : "text-textSecondary"}`}>{result.passport.detail}</p>
            </div>
          </div>

          {/* Notes */}
          {result.notes.length > 0 && (
            <ul className="space-y-1 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-textSecondary">
              {result.notes.map((n, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-neon">•</span>
                  {n}
                </li>
              ))}
            </ul>
          )}

          <p className="text-[11px] leading-relaxed text-textSecondary">
            {result.advisory} <span className="opacity-70">Guidance data v{result.dataVersion}.</span>
          </p>
        </div>
      )}
    </div>
  );
}
