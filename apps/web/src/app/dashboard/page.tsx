"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Bell, ArrowUpRight, Search, ScanLine, Plus, Copy, Check, Landmark, QrCode, Users, Sprout } from "lucide-react";
import { getJSON } from "@/lib/api";
import { FiatBalance, TokenBalance, Transaction } from "@/lib/types";
import NotificationBell from "@/components/NotificationBell";
import { Spinner, usd } from "@/components/ui";
import { SwapIcon, ArrowDown, InvestIcon, CardIcon } from "@/components/icons";
import TransactionList from "@/components/TransactionList";
import SwapModal from "@/components/SwapModal";
import ScanToPay, { ScanMode } from "@/components/ScanToPay";
import Modal from "@/components/Modal";
import { CoinLogo, ChainLogo } from "@furlpay/ui";
import FeatureHub from "@/components/FeatureHub";
import PriceChart from "@/components/PriceChart";
import DepositToast from "@/components/DepositToast";
import BottomNav from "@/components/BottomNav";
import AppSidebar from "@/components/AppSidebar";
import { Balance } from "@/components/user/BalanceVisibility";

interface Overview {
  user: {
    name: string;
    tier: string;
    region: string;
    receiveAddress: string | null;
    receiveAddressUnavailableReason: string | null;
  };
  netWorth: number;
  breakdown: { crypto: number; fiat: number; equities: number };
  tokenBalances: TokenBalance[];
  fiatBalances: FiatBalance[];
  recentTransactions: Transaction[];
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export default function HomePage() {
  const [data, setData] = useState<Overview | null>(null);
  const [swapOpen, setSwapOpen] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);
  const [scanner, setScanner] = useState<{ mode: ScanMode; manual?: boolean } | null>(null);

  const load = useCallback(() => {
    getJSON<Overview>("/api/overview").then(setData).catch(console.error);
  }, []);

  useEffect(() => load(), [load]);

  // The loading state wears the SHELL too. A bare spinner here would paint a
  // blank black page with no sidebar and no tab bar — this page is full-bleed
  // now, so nothing else supplies that chrome while the fetch is in flight.
  if (!data) {
    return (
      <div className="flex min-h-screen bg-oled">
        <AppSidebar />
        <div className="grid min-w-0 flex-1 place-items-center pb-28 lg:pb-8">
          <Spinner />
        </div>
        <div className="lg:hidden">
          <BottomNav />
        </div>
      </div>
    );
  }

  const { breakdown } = data;
  const available = breakdown.crypto + breakdown.fiat;
  const initial = data.user.name.trim().charAt(0).toUpperCase() || "U";

  return (
    <div className="flex min-h-screen bg-oled">
      <AppSidebar />

      <div className="min-w-0 flex-1 pb-28 lg:pb-8">
        {/* The page keeps its OWN header — the greeting, scan, search and bell
            are the wallet's identity and none of them exist in the app-wide
            chrome. It just gains a 1440px measure and a sidebar around it. */}
        <div className="mx-auto w-full max-w-[1440px]">
      {/* Top bar */}
      <header className="flex items-center justify-between px-5 pb-3 pt-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accentDeep text-lg font-bold shadow-[0_8px_20px_-8px_rgba(255,59,48,0.7)]">
            {initial}
          </div>
          <div>
            <p className="text-[12px] text-textSecondary">{greeting()}</p>
            <p className="-mt-0.5 text-[15px] font-bold tracking-tight">{data.user.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            aria-label="Scan to pay"
            onClick={() => setScanner({ mode: "scan" })}
            className="tap flex h-11 w-11 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.04]"
          >
            <ScanLine className="h-5 w-5 text-textSecondary" />
          </button>
          <button
            aria-label="Search"
            onClick={() => window.dispatchEvent(new Event("furlpay:search"))}
            className="tap flex h-11 w-11 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.04]"
          >
            <Search className="h-5 w-5 text-textSecondary" />
          </button>
          <NotificationBell />
        </div>
      </header>

      <div className="xl:grid xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] xl:items-start xl:gap-2">
        <div className="min-w-0">
      {/* Balance hero */}
      <section className="px-5">
        <div className="app-hero p-5">
          <div className="flex items-center justify-between">
            <p className="text-[13px] text-white/70">Est. total value</p>
            <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-white/80">
              {data.user.tier} · {data.user.region}
            </span>
          </div>
          <p className="mt-2 text-[44px] font-extrabold leading-none tracking-tighter">
            <Balance value={usd(data.netWorth)} />
          </p>

          <div className="mt-4 flex items-center justify-between rounded-2xl bg-white/[0.08] py-2.5 pl-4 pr-2.5 backdrop-blur-sm">
            <div>
              <p className="text-[11px] text-white/60">Available balance</p>
              <p className="text-[17px] font-bold tracking-tight">
                <Balance value={usd(available)} />
              </p>
            </div>
            <button
              aria-label="Add money"
              onClick={() => setDepositOpen(true)}
              className="tap flex h-10 w-10 items-center justify-center rounded-full bg-white text-black shadow-[0_6px_16px_-6px_rgba(255,255,255,0.5)]"
            >
              <Plus className="h-5 w-5" strokeWidth={2.5} />
            </button>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            <HeroStat label="On-chain" value={breakdown.crypto} />
            <HeroStat label="Fiat" value={breakdown.fiat} />
            <HeroStat label="Invest" value={breakdown.equities} />
          </div>
        </div>
      </section>

      {/* Portfolio performance chart */}
      <section className="mt-5 px-5">
        <div className="surface-card p-4">
          <PriceChart seed="furlpay-networth" endValue={data.netWorth} height={200} defaultTf="1M" />
        </div>
      </section>

      {/* Quick actions */}
      <section className="mt-5 grid grid-cols-4 gap-3 px-5">
        <QuickAction label="Scan & Pay" onClick={() => setScanner({ mode: "scan" })}>
          <ScanLine className="h-5 w-5" />
        </QuickAction>
        <Link href="/markets" className="contents">
          <QuickAction label="Buy Stocks">
            <InvestIcon />
          </QuickAction>
        </Link>
        <QuickAction label="Swap" onClick={() => setSwapOpen(true)}>
          <SwapIcon />
        </QuickAction>
        <QuickAction label="Receive" onClick={() => setScanner({ mode: "myqr" })}>
          <ArrowDown />
        </QuickAction>
        <QuickAction label="Add money" onClick={() => setDepositOpen(true)}>
          <Plus className="h-5 w-5" />
        </QuickAction>
        <Link href="/cards" className="contents">
          <QuickAction label="Cards">
            <CardIcon />
          </QuickAction>
        </Link>
        <QuickAction label="P2P" onClick={() => setScanner({ mode: "scan", manual: true })}>
          <Users className="h-5 w-5" />
        </QuickAction>
        <Link href="/earn" className="contents">
          <QuickAction label="Earn">
            <Sprout className="h-5 w-5" />
          </QuickAction>
        </Link>
      </section>

      {/* Super-app feature hub */}
      <FeatureHub />

      {/* Accounts carousel */}
      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between px-5">
          <h2 className="text-[17px] font-bold tracking-tight">Accounts</h2>
          <span className="text-[12px] text-textSecondary">
            {data.fiatBalances.length + data.tokenBalances.length} total
          </span>
        </div>
        <div className="no-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-1">
          {data.fiatBalances.map((f) => (
            <div key={f.currency} className="w-[168px] shrink-0 snap-start surface-card p-4">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/[0.06] text-[12px] font-bold">
                  {currencySymbol(f.currency)}
                </span>
                <p className="text-[13px] font-medium text-textSecondary">{f.currency}</p>
              </div>
              <p className="mt-3 text-xl font-bold tracking-tight">
                {f.amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}
              </p>
              <p className="mt-2 truncate text-[11px] text-textMuted">
                {f.localDetails?.iban ||
                  f.localDetails?.accountNumber ||
                  f.localDetails?.routingNumber}
              </p>
            </div>
          ))}
          {data.tokenBalances.map((t) => (
            <div key={t.token + t.chain} className="w-[168px] shrink-0 snap-start surface-card p-4">
              <div className="flex items-center gap-2">
                <CoinLogo token={t.token} size={26} />
                <p className="text-[13px] font-medium text-textSecondary">{t.token}</p>
                <span className="ml-auto">
                  <ChainLogo chain={t.chain} size={16} />
                </span>
              </div>
              <p className="mt-3 text-xl font-bold tracking-tight">
                {t.amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}
              </p>
              <p className="mt-2 text-[11px] text-textMuted">≈ {usd(t.usdValue)}</p>
            </div>
          ))}
          <button
            aria-label="Add account"
            onClick={() => setDepositOpen(true)}
            className="tap flex w-[64px] shrink-0 snap-start flex-col items-center justify-center rounded-[18px] border border-dashed border-white/15 text-textSecondary"
          >
            <span className="text-2xl leading-none">+</span>
          </button>
        </div>
      </section>

      {/* Recent activity */}
        </div>

        {/* Activity rail. Loses its top margin at xl, where it sits beside the
            balance hero rather than beneath the card carousel. */}
        <div className="min-w-0 xl:[&>section]:mt-0">
      <section className="mt-8 px-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[17px] font-bold tracking-tight">Recent activity</h2>
          <button className="flex items-center gap-0.5 text-[12px] font-semibold text-accent">
            See all <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="surface-card overflow-hidden">
          <TransactionList items={data.recentTransactions} />
        </div>
      </section>

        </div>
      </div>
        </div>

        <div className="lg:hidden">
          <BottomNav />
        </div>
      </div>

      <SwapModal open={swapOpen} onClose={() => setSwapOpen(false)} onDone={load} />
      <DepositToast />

      <ScanToPay
        open={!!scanner}
        mode={scanner?.mode ?? "scan"}
        manualEntry={scanner?.manual}
        onClose={() => setScanner(null)}
        onDone={load}
        user={{ name: data.user.name, receiveAddress: data.user.receiveAddress }}
        balances={data.tokenBalances}
      />

      <DepositModal
        open={depositOpen}
        onClose={() => setDepositOpen(false)}
        fiatBalances={data.fiatBalances}
        onShowQr={() => {
          setDepositOpen(false);
          setScanner({ mode: "myqr" });
        }}
      />
    </div>
  );
}

function HeroStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-white/[0.06] px-3 py-2.5 backdrop-blur-sm">
      <p className="text-[11px] text-white/60">{label}</p>
      <p className="mt-0.5 text-[15px] font-bold tracking-tight">
        <Balance value={usd(value)} />
      </p>
    </div>
  );
}

function QuickAction({
  label,
  children,
  onClick,
}: {
  label: string;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button onClick={onClick} className="tap app-tile flex flex-col items-center gap-2 py-3.5">
      <span className="app-tile-icon h-11 w-11">{children}</span>
      <span className="text-[12px] font-semibold tracking-tight">{label}</span>
    </button>
  );
}

// Deposit sheet — crypto QR, bank transfer details, or card on-ramp.
function DepositModal({
  open,
  onClose,
  fiatBalances,
  onShowQr,
}: {
  open: boolean;
  onClose: () => void;
  fiatBalances: FiatBalance[];
  onShowQr: () => void;
}) {
  const [bankOpen, setBankOpen] = useState(false);

  return (
    <Modal open={open} onClose={onClose} title="Add money">
      <div className="space-y-2">
        <DepositRow
          icon={<QrCode className="h-5 w-5" />}
          title="Deposit crypto"
          sub="Show your QR — USDC, EURC & more"
          onClick={onShowQr}
        />
        <DepositRow
          icon={<Landmark className="h-5 w-5" />}
          title="Bank transfer"
          sub="Free · arrives in minutes"
          onClick={() => setBankOpen((b) => !b)}
        />
        {bankOpen && (
          <div className="space-y-2 rounded-2xl bg-white/[0.04] p-3">
            {fiatBalances
              .filter((f) => f.localDetails)
              .map((f) => (
                <BankDetails key={f.currency} balance={f} />
              ))}
          </div>
        )}
        <Link href="/banking" className="block" onClick={onClose}>
          <DepositRow
            icon={<Plus className="h-5 w-5" />}
            title="Buy with card"
            sub="Visa / Mastercard on-ramp"
          />
        </Link>
      </div>
    </Modal>
  );
}

function DepositRow({
  icon,
  title,
  sub,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  sub: string;
  onClick?: () => void;
}) {
  return (
    <button onClick={onClick} className="tap flex w-full items-center gap-3 rounded-2xl bg-surface px-4 py-3.5 text-left">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.06]">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{title}</span>
        <span className="block text-[12px] text-textSecondary">{sub}</span>
      </span>
      <ArrowUpRight className="h-4 w-4 text-textMuted" />
    </button>
  );
}

function BankDetails({ balance }: { balance: FiatBalance }) {
  const [copied, setCopied] = useState<string | null>(null);
  const d = balance.localDetails!;
  const rows = [
    d.iban && (["IBAN", d.iban] as const),
    d.swift && (["SWIFT", d.swift] as const),
    d.routingNumber && (["Routing", d.routingNumber] as const),
    d.accountNumber && (["Account", d.accountNumber] as const),
  ].filter(Boolean) as [string, string][];

  async function copy(label: string, value: string) {
    await navigator.clipboard.writeText(value).catch(() => {});
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold text-textSecondary">{balance.currency}</p>
      {rows.map(([label, value]) => (
        <button
          key={label}
          onClick={() => copy(label, value)}
          className="flex w-full items-center justify-between rounded-xl px-2 py-1.5 text-left hover:bg-white/[0.04]"
        >
          <span className="text-[12px] text-textMuted">{label}</span>
          <span className="flex items-center gap-1.5 font-mono text-[12px]">
            {value}
            {copied === label ? <Check className="h-3.5 w-3.5 text-gain" /> : <Copy className="h-3.5 w-3.5 text-textMuted" />}
          </span>
        </button>
      ))}
    </div>
  );
}

function currencySymbol(code: string): string {
  const map: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", INR: "₹", JPY: "¥" };
  return map[code] ?? code.charAt(0);
}
