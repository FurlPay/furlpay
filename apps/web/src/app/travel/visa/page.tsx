import Link from "next/link";
import { ChevronLeft, Stamp, PlaneTakeoff, BadgeCheck } from "lucide-react";
import EntryRequirementsCheck from "@/components/travel/EntryRequirementsCheck";

export const metadata = {
  title: "Visa & Immigration Center — FurlPay Travels",
  description:
    "Check indicative visa requirements and passport-validity rules for your nationality and destination before you book.",
};

export default function TravelVisaPage() {
  return (
    <div className="mx-auto max-w-2xl px-5 pb-24 pt-6">
      <Link href="/travel" className="mb-3 inline-flex items-center gap-1 text-sm text-textSecondary hover:text-white">
        <ChevronLeft className="h-4 w-4" /> Travel
      </Link>

      <div className="flex items-center gap-2 text-neon">
        <Stamp className="h-6 w-6" />
        <span className="text-xs font-semibold uppercase tracking-wider">Visa & Immigration Center</span>
      </div>
      <h1 className="mt-3 text-2xl font-bold text-white">Know before you go</h1>
      <p className="mt-1 text-sm text-textSecondary">
        Check visa rules and passport validity for your trip. Sort it out before you book non-refundable travel — an
        expired passport or a missing visa means denied boarding.
      </p>

      <div className="mt-5">
        <EntryRequirementsCheck />
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <div className="rounded-card border border-white/10 bg-charcoal p-4">
          <PlaneTakeoff className="h-5 w-5 text-neon" />
          <p className="mt-2 text-sm font-semibold text-white">Checked at booking</p>
          <p className="mt-1 text-xs text-textSecondary">
            When you add passport details at checkout, FurlPay blocks a booking whose passport expires before departure —
            you can&apos;t travel on it.
          </p>
        </div>
        <div className="rounded-card border border-white/10 bg-charcoal p-4">
          <BadgeCheck className="h-5 w-5 text-neon" />
          <p className="mt-2 text-sm font-semibold text-white">Indicative, not legal advice</p>
          <p className="mt-1 text-xs text-textSecondary">
            Rules change often and depend on your exact itinerary. Always confirm with the operating airline or the
            destination&apos;s embassy before you travel.
          </p>
        </div>
      </div>
    </div>
  );
}
