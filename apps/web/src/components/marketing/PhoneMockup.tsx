"use client";

import { useEffect, useState } from "react";
import { EyeIcon, SnowflakeIcon, SlidersIcon, GearIcon } from "@/components/icons";
import { UsdcIcon, EurcIcon, SolIcon, AppleIcon, TeslaIcon, UsdCashIcon } from "@/components/marketing/TokenIcons";

// Floating Android phone showcasing the responsive Furlpay dashboard. Three
// screens auto-advance in a carousel; dots allow manual selection.
const SCREENS = ["Unified wallet", "Cards", "AI budgeting"];

export default function PhoneMockup() {
  const [i, setI] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % SCREENS.length), 3800);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex flex-col items-center">
      <div className="animate-float">
        {/* Android device frame */}
        <div className="relative h-[560px] w-[276px] rounded-[42px] border border-white/15 bg-[#0a0a0c] p-3 shadow-glow">
          {/* Punch-hole camera */}
          <div className="absolute left-1/2 top-4 z-10 h-2 w-2 -translate-x-1/2 rounded-full bg-white/25" />
          {/* Screen */}
          <div className="relative h-full w-full overflow-hidden rounded-[32px] bg-black">
            <div
              className="flex h-full w-full transition-transform duration-500 ease-out"
              style={{ transform: `translateX(-${i * 100}%)` }}
            >
              <Screen><WalletScreen /></Screen>
              <Screen><CardScreen /></Screen>
              <Screen><ChatScreen /></Screen>
            </div>
          </div>
        </div>
      </div>

      {/* Carousel dots */}
      <div className="mt-6 flex items-center gap-2">
        {SCREENS.map((label, idx) => (
          <button
            key={label}
            aria-label={label}
            onClick={() => setI(idx)}
            className={`h-2 rounded-full transition-all ${idx === i ? "w-6 bg-neon" : "w-2 bg-white/25"}`}
          />
        ))}
      </div>
    </div>
  );
}

function Screen({ children }: { children: React.ReactNode }) {
  return <div className="h-full w-full shrink-0 px-4 pt-8">{children}</div>;
}

function WalletScreen() {
  return (
    <div className="text-left">
      <p className="text-[11px] text-textSecondary">Total balance</p>
      <p className="text-[26px] font-extrabold tracking-tighter">$12,480.42</p>
      <p className="mb-3 text-[11px] font-semibold text-neon">+2.4% today</p>
      <Row Icon={UsdcIcon} name="USDC" sub="Base" val="$4,210.55" />
      <Row Icon={EurcIcon} name="EURC" sub="Base" val="$1,068.60" />
      <Row Icon={SolIcon} name="SOL" sub="Solana" val="$1,890.00" />
      <p className="mb-1 mt-3 text-[10px] uppercase tracking-wide text-textMuted">Stocks</p>
      <Row Icon={AppleIcon} name="AAPL" sub="3.4 shares" val="$789.17" up />
      <Row Icon={TeslaIcon} name="TSLA" sub="0.75 shares" val="$302.18" up />
      <p className="mb-1 mt-3 text-[10px] uppercase tracking-wide text-textMuted">Cash</p>
      <Row Icon={UsdCashIcon} name="USD" sub="Local account" val="$3,200.00" />
    </div>
  );
}

function Row({
  Icon,
  name,
  sub,
  val,
  up,
}: {
  Icon: React.ComponentType<{ className?: string }>;
  name: string;
  sub: string;
  val: string;
  up?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5 py-1.5">
      <Icon className="h-8 w-8 shrink-0" />
      <div className="flex-1">
        <p className="text-[13px] font-semibold leading-tight">{name}</p>
        <p className="text-[10px] text-textSecondary">{sub}</p>
      </div>
      <p className={`text-[12px] font-semibold ${up ? "text-gain" : ""}`}>{val}</p>
    </div>
  );
}

function CardScreen() {
  const actions = [
    { Icon: EyeIcon, label: "View" },
    { Icon: SnowflakeIcon, label: "Freeze" },
    { Icon: SlidersIcon, label: "Limit" },
    { Icon: GearIcon, label: "Settings" },
  ];
  return (
    <div>
      <p className="mb-3 text-left text-[13px] font-semibold">Furlpay Pro</p>
      <div className="relative h-[150px] w-full overflow-hidden rounded-2xl bg-gradient-to-br from-neonDeep to-[#053a2c] p-4">
        <div className="absolute right-4 top-4 text-[13px] font-bold italic text-white/90">VISA</div>
        <div className="mt-8 text-[15px] tracking-[0.2em] text-white/90">•••• 4417</div>
        <div className="mt-6 flex justify-between text-[10px] text-white/70">
          <span>ASHUTOSH</span>
          <span>08/29</span>
        </div>
        <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-white/10 blur-2xl" />
      </div>
      <div className="mt-5 grid grid-cols-4 gap-2">
        {actions.map(({ Icon, label }) => (
          <div key={label} className="flex flex-col items-center gap-1.5">
            <div className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/[0.05]">
              <Icon className="h-5 w-5 text-neon" />
            </div>
            <span className="text-[10px] text-textSecondary">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChatScreen() {
  return (
    <div className="flex h-full flex-col">
      <p className="mb-3 text-left text-[13px] font-semibold">Furl AI</p>
      <div className="flex-1 space-y-2.5">
        <Bubble me>Send $25 USDC to Sarah</Bubble>
        <Bubble>
          Sending <b>$25.00 USDC</b> to Sarah (0x9f…c31E) on Base. Gas sponsored. Confirm with fingerprint?
        </Bubble>
        <Bubble me>Yes</Bubble>
        <Bubble>
          Done — <span className="text-neon">settled in 1.9s</span>. New USDC balance: $4,185.55.
        </Bubble>
      </div>
      <div className="mt-3 flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2">
        <span className="text-[11px] text-textMuted">Ask Furl AI…</span>
      </div>
    </div>
  );
}

function Bubble({ children, me }: { children: React.ReactNode; me?: boolean }) {
  return (
    <div className={`flex ${me ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-3 py-2 text-[11px] leading-snug ${
          me ? "bg-neon text-black" : "bg-white/[0.06] text-textPrimary"
        }`}
      >
        {children}
      </div>
    </div>
  );
}
