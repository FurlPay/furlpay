"use client";

import Link from "next/link";
import { useRef } from "react";

// Pricing tiers with a pointer-tracking border. A single mousemove handler on
// the grid updates each card's --mx/--my CSS vars (relative to that card), so
// the masked green ring in globals.css glides left/right with the cursor as you
// move between prices.
const TIERS = [
  {
    name: "Standard",
    price: "$0",
    tagline: "For everyday spending",
    feats: ["Virtual stablecoin card", "Local USD/EUR account", "Fractional investing"],
  },
  {
    name: "Pro",
    price: "$9",
    tagline: "For power users",
    feats: ["Metal physical card", "Higher limits & velocity", "Priority FX rates"],
    highlight: true,
  },
  {
    name: "Ultra",
    price: "$29",
    tagline: "For builders & teams",
    feats: ["Full API + webhooks", "Dedicated MPC policy", "24/7 support"],
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
            <p className="text-[17px] font-bold">{t.name}</p>
            {t.highlight && (
              <span className="rounded-full bg-neon px-2.5 py-0.5 text-[10px] font-bold text-black">POPULAR</span>
            )}
          </div>
          <p className="mt-3 text-[36px] font-extrabold tracking-tighter">
            {t.price}
            <span className="text-[14px] font-medium text-textSecondary">/mo</span>
          </p>
          <p className="mb-5 text-[13px] text-textSecondary">{t.tagline}</p>
          <ul className="space-y-2 text-[13px] text-textSecondary">
            {t.feats.map((f) => (
              <li key={f} className="flex items-center gap-2">
                <span className="text-neon">✓</span> {f}
              </li>
            ))}
          </ul>
          <Link
            href="/signup"
            className={`mt-6 block rounded-pill py-2.5 text-center text-sm font-semibold ${
              t.highlight ? "btn-green" : "btn-outline"
            }`}
          >
            Get started
          </Link>
        </div>
      ))}
    </div>
  );
}
