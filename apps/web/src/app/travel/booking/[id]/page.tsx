"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ChevronLeft, MapPin, CalendarDays, Users, ExternalLink, ShieldCheck, Ticket, XCircle, CheckCircle2 } from "lucide-react";
import { getJSON, sendJSON } from "@/lib/api";
import { Spinner, Pill } from "@/components/ui";
import type { Trip } from "@/lib/travel/store";

export default function BookingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [trip, setTrip] = useState<Trip | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getJSON<{ trip: Trip }>(`/api/travel/trips/${id}`)
      .then((d) => setTrip(d.trip))
      .catch(() => setTrip(null));
  }, [id]);

  async function cancel() {
    if (!trip || !confirm("Cancel this booking and process a refund?")) return;
    setBusy(true);
    try {
      const res = await sendJSON<{ trip: Trip }>(`/api/travel/cancel/${trip.id}`, {});
      setTrip(res.trip);
    } finally {
      setBusy(false);
    }
  }

  if (trip === undefined) return <Spinner />;
  if (trip === null) {
    return (
      <div className="mx-auto max-w-md px-5 py-20 text-center">
        <p className="text-sm text-textSecondary">Booking not found.</p>
        <Link href="/travel/my-trips" className="mt-4 inline-block text-sm text-neon hover:underline">
          Back to My Trips
        </Link>
      </div>
    );
  }

  const explorer = trip.source === "travala" ? "https://basescan.org/tx/" : "#";

  return (
    <div className="mx-auto max-w-2xl px-5 pb-24 pt-6">
      <Link href="/travel/my-trips" className="mb-3 inline-flex items-center gap-1 text-sm text-textSecondary hover:text-white">
        <ChevronLeft className="h-4 w-4" /> My Trips
      </Link>

      <div className={`relative h-44 overflow-hidden rounded-card bg-gradient-to-br ${trip.image}`}>
        <div className="absolute bottom-4 left-4">
          <div className="mb-2">
            {trip.status === "confirmed" ? (
              <Pill tone="gain">Confirmed</Pill>
            ) : trip.status === "cancelled" ? (
              <Pill tone="loss">Cancelled</Pill>
            ) : (
              <Pill tone="accent">Pending</Pill>
            )}
          </div>
          <h1 className="text-2xl font-bold text-white drop-shadow">{trip.name}</h1>
          <p className="flex items-center gap-1 text-sm text-white/80">
            <MapPin className="h-3.5 w-3.5" /> {trip.city}
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Info Icon={CalendarDays} label="Dates" value={`${trip.checkIn} → ${trip.checkOut}`} />
        <Info Icon={CalendarDays} label="Nights" value={String(trip.nights)} />
        <Info Icon={Users} label="Guests" value={String(trip.guests)} />
      </div>

      <div className="mt-4 rounded-card border border-white/10 bg-charcoal p-5 text-sm">
        <p className="mb-3 text-sm font-semibold text-white">Payment</p>
        <Row label="Amount paid" value={`$${trip.amountUsd.toLocaleString()}`} />
        <Row label="Method" value={trip.method} />
        {trip.cashbackUsd > 0 && <Row label="Cashback earned" value={`$${trip.cashbackUsd} USDC`} highlight />}
        {trip.cardLast4 && <Row label="Card" value={`•••• ${trip.cardLast4}`} />}
        {trip.txHash && (
          <div className="flex items-center justify-between">
            <span className="text-textSecondary">Transaction</span>
            <a
              href={explorer + trip.txHash}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 font-mono text-xs text-neon hover:underline"
            >
              {trip.txHash.slice(0, 10)}…{trip.txHash.slice(-6)} <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        )}
        {trip.refundStatus && (
          <p className="mt-2 flex items-center gap-1.5 rounded-lg bg-loss/10 px-3 py-2 text-[11px] text-loss">
            <XCircle className="h-3 w-3" /> {trip.refundStatus}
          </p>
        )}
      </div>

      {trip.status === "confirmed" && (
        <p className="mt-3 flex items-center gap-1.5 rounded-lg bg-neon/[0.06] px-3 py-2 text-[11px] text-neon">
          <CheckCircle2 className="h-3.5 w-3.5" /> Confirmation &amp; e-voucher sent. Present it at check-in.
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-3">
        <button className="flex items-center gap-1.5 rounded-xl bg-white px-5 py-3 text-sm font-bold text-black transition hover:bg-white/90">
          <Ticket className="h-4 w-4" /> View voucher
        </button>
        {trip.status === "confirmed" && (
          <button
            onClick={cancel}
            disabled={busy}
            className="rounded-xl border border-loss/40 px-5 py-3 text-sm font-semibold text-loss transition hover:bg-loss/10 disabled:opacity-40"
          >
            {busy ? "Cancelling…" : "Cancel booking"}
          </button>
        )}
        <Link href="/travel/help" className="rounded-xl border border-white/15 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/[0.06]">
          Get support
        </Link>
      </div>

      <p className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-textSecondary">
        <ShieldCheck className="h-3 w-3 text-neon" /> Secured by FurlPay
      </p>
    </div>
  );
}

function Info({ Icon, label, value }: { Icon: typeof MapPin; label: string; value: string }) {
  return (
    <div className="rounded-card border border-white/10 bg-charcoal p-3">
      <p className="flex items-center gap-1 text-[11px] text-textSecondary">
        <Icon className="h-3 w-3" /> {label}
      </p>
      <p className="mt-1 text-sm font-semibold text-white">{value}</p>
    </div>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-textSecondary">{label}</span>
      <span className={highlight ? "font-semibold text-neon" : "text-white"}>{value}</span>
    </div>
  );
}
