"use client";

import { PaymentCard } from "@/lib/types";
import { CardNetworkLogo } from "@furlpay/ui";

// The swipable card element — aspect ratio 1.586, 18px radius, gradient skin.
export default function VisaCard({ card }: { card: PaymentCard }) {
  return (
    <div
      className="relative flex aspect-[1.586] w-full flex-col justify-between rounded-card p-5 text-white shadow-2xl"
      style={{ background: `linear-gradient(135deg, ${card.gradient[0]} 0%, ${card.gradient[1]} 100%)` }}
    >
      {card.frozen && (
        <div className="absolute inset-0 flex items-center justify-center rounded-card bg-black/50 backdrop-blur-[2px]">
          <span className="rounded-full bg-white/15 px-4 py-1.5 text-sm font-semibold">Frozen</span>
        </div>
      )}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[13px] font-medium opacity-80">{card.label}</p>
          <p className="text-[11px] uppercase tracking-wider opacity-60">{card.kind}</p>
        </div>
        <div className="h-7 w-9 rounded-md bg-white/25" />
      </div>
      <div>
        <p className="font-mono text-lg tracking-[0.2em]">•••• •••• •••• {card.last4}</p>
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[12px] opacity-75">Settles in {card.settlementCurrency}</span>
          <span className="text-xl"><CardNetworkLogo network={card.network} /></span>
        </div>
      </div>
    </div>
  );
}
