import Link from "next/link";
import type { ReactNode } from "react";

// Shared presentational blocks for marketing landing pages. Kept intentionally
// small and unopinionated so /products/*, /solutions/*, and comparison pages
// read as one system. Colours/classes come from the existing design tokens
// (bg-oled, text-neon, glass-card, btn-green, btn-outline).

export function Hero({
  eyebrow,
  title,
  subtitle,
  primary = { href: "/signup", label: "Get started" },
  secondary,
}: {
  eyebrow: string;
  title: ReactNode;
  subtitle: ReactNode;
  primary?: { href: string; label: string };
  secondary?: { href: string; label: string };
}) {
  return (
    <div>
      <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.18em] text-neon">{eyebrow}</p>
      <h1 className="max-w-3xl text-[40px] font-extrabold leading-tight tracking-tighter sm:text-[52px]">
        {title}
      </h1>
      <p className="mt-5 max-w-2xl text-[17px] leading-relaxed text-textSecondary">{subtitle}</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href={primary.href} className="btn-green px-6 py-3 text-[15px]">
          {primary.label}
        </Link>
        {secondary && (
          <Link href={secondary.href} className="btn-outline px-6 py-3 text-[15px]">
            {secondary.label}
          </Link>
        )}
      </div>
    </div>
  );
}

export function FeatureGrid({
  items,
}: {
  items: { title: string; body: string }[];
}) {
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((f) => (
        <div key={f.title} className="glass-card p-6">
          <h3 className="text-[16px] font-bold">{f.title}</h3>
          <p className="mt-2 text-[14px] leading-relaxed text-textSecondary">{f.body}</p>
        </div>
      ))}
    </div>
  );
}

// A section with a heading and free-form children.
export function Section({
  title,
  children,
  className = "",
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`mt-16 ${className}`}>
      {title && <h2 className="mb-6 text-[26px] font-bold tracking-tighter">{title}</h2>}
      {children}
    </section>
  );
}

export function CtaBand({
  title,
  subtitle,
  primary = { href: "/signup", label: "Create your account" },
  secondary = { href: "/docs", label: "Read the docs" },
}: {
  title: string;
  subtitle?: string;
  primary?: { href: string; label: string };
  secondary?: { href: string; label: string };
}) {
  return (
    <section className="mt-20 rounded-2xl border border-white/10 bg-white/[0.02] p-10 text-center">
      <h2 className="text-[26px] font-bold tracking-tighter">{title}</h2>
      {subtitle && <p className="mx-auto mt-2 max-w-lg text-[14px] text-textSecondary">{subtitle}</p>}
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link href={primary.href} className="btn-green px-6 py-3 text-[15px]">
          {primary.label}
        </Link>
        <Link href={secondary.href} className="btn-outline px-6 py-3 text-[15px]">
          {secondary.label}
        </Link>
      </div>
    </section>
  );
}

// Competitor comparison table (Feature | Furlpay | Competitor).
export function CompareTable({
  competitor,
  rows,
}: {
  competitor: string;
  rows: { feature: string; furlpay: string; other: string; furlpayWins?: boolean }[];
}) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-white/10">
      <table className="w-full min-w-[520px] text-left text-[14px]">
        <thead>
          <tr className="border-b border-white/10 bg-white/[0.03]">
            <th className="px-5 py-4 font-semibold text-textSecondary">Feature</th>
            <th className="px-5 py-4 font-bold text-neon">Furlpay</th>
            <th className="px-5 py-4 font-semibold text-textSecondary">{competitor}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.06]">
          {rows.map((row) => (
            <tr key={row.feature} className="transition-colors hover:bg-white/[0.02]">
              <td className="px-5 py-4 font-medium">{row.feature}</td>
              <td className={`px-5 py-4 ${row.furlpayWins ? "font-semibold text-neon" : ""}`}>
                {row.furlpay}
              </td>
              <td className="px-5 py-4 text-textSecondary">{row.other}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
