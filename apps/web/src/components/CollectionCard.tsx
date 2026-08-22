"use client";

// Gradient discover card for curated collections. Icon names in
// lib/markets/collections.ts map to lucide components here (a static map keeps
// the bundle lean vs importing the whole icon set).
import Link from "next/link";
import {
  BrainCircuit, Cpu, Leaf, ShieldCheck, Car, CreditCard, Rocket, Plane, Crown, TrendingUp,
  Gem, Scale, CalendarClock, Bitcoin, Layers, Network, Landmark, Bot, Gamepad2, Sparkles,
} from "lucide-react";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  BrainCircuit, Cpu, Leaf, ShieldCheck, Car, CreditCard, Rocket, Plane, Crown, TrendingUp,
  Gem, Scale, CalendarClock, Bitcoin, Layers, Network, Landmark, Bot, Gamepad2,
};

export default function CollectionCard({
  slug,
  title,
  blurb,
  gradient,
  icon,
  count,
  size = "md",
}: {
  slug: string;
  title: string;
  blurb?: string;
  gradient: [string, string];
  icon: string;
  count?: number;
  size?: "sm" | "md";
}) {
  const Icon = ICONS[icon] ?? Sparkles;
  return (
    <Link
      href={`/markets/collections/${slug}`}
      style={{ background: `linear-gradient(135deg, ${gradient[0]}, ${gradient[1]}dd)` }}
      className={`relative shrink-0 snap-start overflow-hidden rounded-2xl p-3.5 transition-transform hover:scale-[1.02] ${
        size === "sm" ? "w-[136px]" : "w-[168px]"
      }`}
    >
      <div className="absolute -right-4 -top-4 h-16 w-16 rounded-full bg-white/10 blur-xl" />
      <Icon className="h-5 w-5 text-white/90" />
      <p className={`mt-2 font-bold leading-tight tracking-tight text-white ${size === "sm" ? "text-[13px]" : "text-[14px]"}`}>{title}</p>
      {size === "md" && blurb && <p className="mt-1 line-clamp-2 text-[10.5px] leading-snug text-white/70">{blurb}</p>}
      {count !== undefined && <p className="mt-1.5 text-[10px] font-semibold text-white/60">{count} assets</p>}
    </Link>
  );
}
