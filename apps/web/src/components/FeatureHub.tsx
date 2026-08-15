import Link from "next/link";
import {
  PiggyBank,
  Gift,
  Trophy,
  BarChart3,
  Landmark,
  ReceiptText,
  Code2,
  ShieldCheck,
  HandCoins,
  Users,
  Smartphone,
  Ticket,
  ArrowLeftRight,
  GraduationCap,
  Repeat,
  CreditCard,
  Plane,
  Sparkles,
  BookUser,
} from "lucide-react";

// The super-app feature grid — Furlpay's answer to the RedotPay hub. Real
// features link out; not-yet-built ones show a "Soon" chip so the surface still
// reads as a complete product map.
type Feature = {
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  href?: string;
  soon?: boolean;
};

const FEATURES: Feature[] = [
  { label: "Co-Pilot", Icon: Sparkles, href: "/chat" },
  { label: "Contacts", Icon: BookUser, href: "/contacts" },
  { label: "Travel", Icon: Plane, href: "/travel" },
  { label: "Earn", Icon: PiggyBank, href: "/earn" },
  { label: "Rewards", Icon: Trophy, href: "/rewards" },
  { label: "Analytics", Icon: BarChart3, href: "/analytics" },
  { label: "Cards", Icon: CreditCard, href: "/cards" },
  { label: "Banking", Icon: Landmark, href: "/banking" },
  { label: "Bills", Icon: ReceiptText, href: "/bills" },
  { label: "Referrals", Icon: Users, href: "/rewards#referrals" },
  { label: "Security", Icon: ShieldCheck, href: "/profile" },
  { label: "Developers", Icon: Code2, href: "/developer" },
  { label: "Learn", Icon: GraduationCap, href: "/docs" },
  { label: "Convert", Icon: ArrowLeftRight, href: "/swaps" },
  { label: "Credit", Icon: HandCoins, href: "/credit" },
  { label: "Top-Up", Icon: Smartphone, soon: true },
  { label: "Gifts", Icon: Gift, soon: true },
  { label: "Vouchers", Icon: Ticket, soon: true },
  { label: "Direct", Icon: Repeat, soon: true },
];

function Tile({ label, Icon, soon }: Feature) {
  return (
    <div className="tap flex flex-col items-center gap-2">
      <span className="app-tile flex h-14 w-14 items-center justify-center">
        <Icon className="h-6 w-6 text-white/90" />
      </span>
      <span className="flex items-center gap-1 text-[11px] font-medium text-textSecondary">
        {label}
        {soon && (
          <span className="rounded-full bg-white/[0.06] px-1 py-px text-[8px] font-bold uppercase tracking-wide text-textMuted">
            Soon
          </span>
        )}
      </span>
    </div>
  );
}

export default function FeatureHub() {
  return (
    <section className="mt-7">
      <h2 className="mb-3 px-5 text-[17px] font-bold tracking-tight">Explore</h2>
      <div className="grid grid-cols-4 gap-x-2 gap-y-5 px-5">
        {FEATURES.map((f) =>
          f.href ? (
            <Link key={f.label} href={f.href} aria-label={f.label}>
              <Tile {...f} />
            </Link>
          ) : (
            <button key={f.label} aria-label={`${f.label} (coming soon)`} className="cursor-default">
              <Tile {...f} />
            </button>
          )
        )}
      </div>
    </section>
  );
}
