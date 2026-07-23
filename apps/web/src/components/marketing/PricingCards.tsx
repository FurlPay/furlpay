"use client";

import Link from "next/link";
import { useRef } from "react";
import { Check, ShieldCheck, Zap, Layers } from "lucide-react";

// A price card is an OFFER TO SELL, so it is held to the same standard as
// components/marketing/VerifiedCapabilities.tsx: every bullet names something
// that exists in this repo today. Anything real-but-not-yet-exercised belongs
// in that component's roadmap list, never in a tier a customer can buy.
//
// Removed on 23 Jul 2026, and why — each of these was live here while
// VerifiedCapabilities simultaneously documented it as deliberately absent:
//   - "SAMA & HKMA sandbox alignment"  → FurlPay is in neither sandbox.
//   - "$0.10 / automated compliance check"  → the provider is not provisioned;
//     printing a per-unit price is an offer to sell a service we cannot deliver.
//   - "FATF Rec 10, 15 & 16 Travel Rule API"  → the route exists but no live
//     message has ever reached a counterparty VASP. Roadmap.
//   - "0.15% / 0.35% cross-border settlement", "10 bps tokenized asset
//     execution", "~4.5% treasury float sweeps"  → invented rates that also
//     contradicted the flat 0.5% documented in the FAQ on this same page.
//   - "Dedicated multi-bank virtual accounts"  → sandbox descriptors, not
//     connections; no signed agreement with any institution.
const TIERS = [
  {
    name: "Developer Core",
    price: "$0",
    tagline: "For startups & AI agent sandbox testing",
    feats: [
      "Full REST & MCP server API access",
      "OAuth 2.1 with DPoP sender-constrained tokens",
      "x402 pay-per-call settlement for AI agents",
      "Passkey (WebAuthn) authentication",
      "Community support",
    ],
    icon: Zap,
  },
  {
    name: "Growth Orchestrator",
    price: "$299",
    tagline: "For platforms, neobanks & travel OTAs",
    feats: [
      "Agent spend control plane with enforced per-agent policies",
      "Human passkey approval on every money-moving tool call",
      "Rail registry: protocol, chains, fees and per-transaction caps",
      "Corporate-actions ledger — splits, dividends, mergers, spin-offs",
      "Hong Kong bank directory: 20 licensed banks, HKMA open data",
    ],
    highlight: true,
    icon: Layers,
  },
  {
    name: "Enterprise & BaaS",
    price: "Custom",
    tagline: "For high-volume merchants & platforms",
    feats: [
      "Custom settlement rates below the standard 0.5%",
      "Settlement and uptime SLA",
      "Per-transaction audit trails with reconciliation exports",
      "Auth posture of every endpoint enforced in CI",
      "Dedicated account manager",
    ],
    icon: ShieldCheck,
  },
];

export default function PricingCards() {
  const gridRef = useRef<HTMLDivElement>(null);

  const handleMove = (e: React.MouseEvent) => {
    const cards = gridRef.current?.querySelectorAll<HTMLElement>("[data-spotlight]");
    cards?.forEach((card) => {
      const r = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${e.clientX - r.left}px`);
      card.style.setProperty("--my", `${e.clientY - r.top}px`);
    });
  };

  return (
    <div
      ref={gridRef}
      onMouseMove={handleMove}
      className="spotlight-group grid grid-cols-1 gap-4 md:grid-cols-3"
    >
      {TIERS.map((t) => (
        <div
          key={t.name}
          data-spotlight
          className={`card-spotlight p-7 ${t.highlight ? "is-pop shadow-glow" : ""}`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <t.icon className="h-4 w-4 text-neon" />
              <p className="text-[17px] font-bold">{t.name}</p>
            </div>
            {t.highlight && (
              <span className="rounded-full bg-neon px-2.5 py-0.5 text-[10px] font-bold text-black">POPULAR</span>
            )}
          </div>
          <p className="mt-3 text-[36px] font-extrabold tracking-tighter">
            {t.price}
            {t.price !== "Custom" && <span className="text-[14px] font-medium text-textSecondary">/mo</span>}
          </p>
          <p className="mb-5 text-[13px] text-textSecondary">{t.tagline}</p>
          <ul className="space-y-2 text-[13px] text-textSecondary">
            {t.feats.map((f) => (
              <li key={f} className="flex items-center gap-2">
                <Check className="h-4 w-4 shrink-0 text-neon" aria-hidden /> {f}
              </li>
            ))}
          </ul>
          <Link
            href="/signup"
            className={`mt-6 block rounded-pill py-2.5 text-center text-sm font-semibold ${
              t.highlight ? "btn-green" : "btn-outline"
            }`}
          >
            {t.price === "Custom" ? "Contact Enterprise" : "Start Building"}
          </Link>
        </div>
      ))}
    </div>
  );
}

