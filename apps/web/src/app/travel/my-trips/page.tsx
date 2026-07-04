"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, MapPin, CalendarDays, ArrowRight, Plane } from "lucide-react";
import { getJSON } from "@/lib/api";
import { Spinner, Pill } from "@/components/ui";
import type { Trip } from "@/lib/travel/store";

type Buckets = { upcoming: Trip[]; past: Trip[]; cancelled: Trip[] };
const TABS = [
  { id: "upcoming", label: "Upcoming" },
  { id: "past", label: "Past" },
  { id: "cancelled", label: "Cancelled" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export default function MyTripsPage() {
  const [data, setData] = useState<Buckets | null>(null);
  const [tab, setTab] = useState<TabId>("upcoming");

  useEffect(() => {
    getJSON<Buckets>("/api/travel/trips").then(setData).catch(() => setData({ upcoming: [], past: [], cancelled: [] }));
  }, []);

  if (!data) return <Spinner />;
  const trips = data[tab];

  return (
    <div className="mx-auto max-w-3xl px-5 pb-24 pt-6">
      <Link href="/travel" className="mb-3 inline-flex items-center gap-1 text-sm text-textSecondary hover:text-white">
        <ChevronLeft className="h-4 w-4" /> Travel
      </Link>
      <h1 className="text-2xl font-bold text-white">My Trips</h1>

      <div className="mt-4 flex gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${
              tab === t.id ? "bg-white text-black" : "bg-white/[0.06] text-textSecondary hover:bg-white/10"
            }`}
          >
            {t.label} <span className="opacity-60">{data[t.id].length}</span>
          </button>
        ))}
      </div>

      <div className="mt-5 space-y-3">
        {trips.length === 0 ? (
          <div className="rounded-card border border-white/10 bg-charcoal p-10 text-center">
            <Plane className="mx-auto h-8 w-8 text-textSecondary" />
            <p className="mt-3 text-sm text-textSecondary">No {tab} trips yet.</p>
            <Link href="/travel" className="mt-4 inline-block rounded-xl bg-neon px-5 py-2.5 text-sm font-bold text-black">
              Book a trip
            </Link>
          </div>
        ) : (
          trips.map((t) => (
            <Link
              key={t.id}
              href={`/travel/booking/${t.id}`}
              className="flex items-center gap-4 rounded-card border border-white/10 bg-charcoal p-3 transition hover:border-white/20"
            >
              <div className={`h-20 w-24 shrink-0 rounded-xl bg-gradient-to-br ${t.image}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-semibold text-white">{t.name}</p>
                  <StatusPill status={t.status} />
                </div>
                <p className="mt-0.5 flex items-center gap-1 text-xs text-textSecondary">
                  <MapPin className="h-3 w-3" /> {t.city}
                </p>
                <p className="mt-0.5 flex items-center gap-1 text-[11px] text-textSecondary">
                  <CalendarDays className="h-3 w-3" /> {t.checkIn} → {t.checkOut} · {t.method}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-bold text-white">${t.amountUsd.toLocaleString()}</p>
                {t.cashbackUsd > 0 && <p className="text-[11px] text-neon">+${t.cashbackUsd} back</p>}
                <ArrowRight className="ml-auto mt-1 h-4 w-4 text-textSecondary" />
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: Trip["status"] }) {
  if (status === "confirmed") return <Pill tone="gain">Confirmed</Pill>;
  if (status === "pending") return <Pill tone="accent">Pending</Pill>;
  return <Pill tone="loss">Cancelled</Pill>;
}
