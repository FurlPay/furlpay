import Link from "next/link";
import { Building2, Wallet, CreditCard, SlidersHorizontal, CheckSquare, FileText, Percent, Headphones, Check } from "lucide-react";

export const metadata = {
  title: "Business Travel — FurlPay Travels",
  description: "Manage team travel with crypto. Team wallets, single-use virtual cards with MCC locks, spending policies, and instant reconciliation.",
};

const FEATURES = [
  { Icon: Wallet, title: "Team wallet", body: "Fund a shared company wallet with USDC for all employee travel." },
  { Icon: CreditCard, title: "Virtual card per trip", body: "Auto-issue a single-use Visa VCN per trip, MCC-locked to lodging + airlines." },
  { Icon: SlidersHorizontal, title: "Spending policies", body: "Per-trip budgets, hotel star limits, and flight-class restrictions by employee." },
  { Icon: CheckSquare, title: "Approval workflows", body: "Require manager approval for bookings over a threshold." },
  { Icon: FileText, title: "Auto-reconciliation", body: "Every transaction tagged with employee, project, and cost center." },
  { Icon: FileText, title: "Tax reports", body: "Downloadable CSV/PDF expense reports by quarter." },
  { Icon: Percent, title: "Corporate rates", body: "Up to 15% off negotiated rates across stays and flights." },
  { Icon: Headphones, title: "24/7 support", body: "A dedicated business support channel for your team." },
];

export default function BusinessTravelPage() {
  return (
    <div className="mx-auto max-w-4xl px-5 pb-24 pt-8">
      <div className="overflow-hidden rounded-card border border-white/10 bg-gradient-to-br from-sky-600/20 via-charcoal to-teal-600/10 p-7">
        <div className="flex items-center gap-2 text-sky-300">
          <Building2 className="h-6 w-6" />
          <span className="text-xs font-semibold uppercase tracking-wider">FurlPay Business Travel</span>
        </div>
        <h1 className="mt-3 text-3xl font-bold text-white">Manage team travel with crypto.</h1>
        <p className="mt-2 max-w-xl text-sm text-textSecondary">
          Virtual cards, spending policies, and instant reconciliation — funded in USDC. Give employees travel
          spend that can only be spent on travel.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link href="/travel" className="rounded-xl bg-neon px-5 py-3 text-sm font-bold text-black transition hover:bg-neonDeep">
            Get started — free for teams
          </Link>
          <Link href="/talk-to-us" className="rounded-xl border border-white/15 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/[0.06]">
            Talk to sales
          </Link>
        </div>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {FEATURES.map((f) => (
          <div key={f.title} className="rounded-card border border-white/10 bg-charcoal p-5">
            <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-neon/15 text-neon">
              <f.Icon className="h-4 w-4" />
            </div>
            <p className="text-sm font-semibold text-white">{f.title}</p>
            <p className="mt-1 text-xs text-textSecondary">{f.body}</p>
          </div>
        ))}
      </div>

      <div className="mt-8 rounded-card border border-white/10 bg-charcoal p-6">
        <p className="text-sm font-semibold text-white">How a trip works</p>
        <ul className="mt-3 space-y-2 text-sm text-textSecondary">
          {[
            "Founder deposits USDC into the FurlPay team wallet.",
            "Employee books a flight/hotel; FurlPay issues a single-use, MCC-locked Visa card matching the trip total.",
            "The card can only spend on travel merchants — non-travel merchants are blocked.",
            "Every transaction auto-reconciles by employee, project, and cost center.",
          ].map((s) => (
            <li key={s} className="flex items-start gap-2">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-neon" /> {s}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
