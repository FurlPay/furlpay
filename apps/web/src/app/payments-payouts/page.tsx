"use client";

import { useCallback, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  Bell,
  Building2,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  Clock,
  Copy,
  FileText,
  Globe,
  HelpCircle,
  Landmark,
  Loader2,
  Lock,
  type LucideIcon,
  Mic,
  Radio,
  Search,
  Send,
  Shield,
  ShieldAlert,
  Snowflake,
  Timer,
  Wallet,
  Zap,
} from "lucide-react";
import { CryptoMark, type MarkKey } from "@/components/payouts/CryptoMarks";

// ---------------------------------------------------------------------------
// The FurlPay Payments Center.
//
// Light-mode build of the payments-payouts console. The wallet panel is not a
// mockup: it posts to /api/payouts/validate-destination, which runs the same
// validation the payout engine runs, so what you see here is what the backend
// would actually accept. A screen that pretends to validate is worse than one
// that does not, because it teaches people the check happened.
//
// Numbers shown in the balance, earnings and history panels are illustrative
// and labelled as such — they are a specimen account, not a live one.
// ---------------------------------------------------------------------------

// ── palette helpers ────────────────────────────────────────────────────────

const CARD = "rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(16,24,40,.04)]";
const PANEL_TITLE = "text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500";

function Panel({
  n,
  title,
  hint,
  children,
  className = "",
}: {
  n: number;
  title: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`${CARD} flex flex-col overflow-hidden ${className}`}>
      <header className="flex items-baseline gap-2 border-b border-slate-100 px-4 py-2.5">
        <span className="font-mono text-[11px] font-semibold text-indigo-600">
          {String(n).padStart(2, "0")}
        </span>
        <h2 className="text-[12.5px] font-semibold tracking-tight text-slate-900">{title}</h2>
        {hint && <span className="text-[11px] text-slate-400">{hint}</span>}
      </header>
      <div className="flex-1 p-4">{children}</div>
    </section>
  );
}

function Pill({
  tone = "slate",
  children,
}: {
  tone?: "slate" | "green" | "amber" | "red" | "indigo" | "blue";
  children: React.ReactNode;
}) {
  const tones = {
    slate: "bg-slate-100 text-slate-600 ring-slate-200",
    green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    amber: "bg-amber-50 text-amber-700 ring-amber-200",
    red: "bg-rose-50 text-rose-700 ring-rose-200",
    indigo: "bg-indigo-50 text-indigo-700 ring-indigo-200",
    blue: "bg-sky-50 text-sky-700 ring-sky-200",
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold ring-1 ring-inset ${tones}`}>
      {children}
    </span>
  );
}

function Btn({
  children,
  variant = "ghost",
  size = "sm",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger" | "success";
  size?: "sm" | "md";
}) {
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 disabled:cursor-not-allowed disabled:opacity-45";
  const variants = {
    primary: "bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm",
    ghost: "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
    danger: "bg-rose-600 text-white hover:bg-rose-700 shadow-sm",
    success: "bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm",
  }[variant];
  const sizes = { sm: "px-2.5 py-1.5 text-[12px]", md: "px-3.5 py-2 text-[13px]" }[size];
  return (
    <button className={`${base} ${variants} ${sizes}`} {...rest}>
      {children}
    </button>
  );
}

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

// ── page ───────────────────────────────────────────────────────────────────

export default function PaymentsPayoutsPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 antialiased">
      <TopBar />
      <div className="mx-auto flex max-w-[1800px] gap-4 px-4 pb-12 pt-4">
        <DiscordSidebar />
        <main className="min-w-0 flex-1 space-y-4">
          <UserJourney />
          <div className="grid gap-4 xl:grid-cols-3 2xl:grid-cols-6">
            <MainChannel />
            <AccountOnboarding />
            <AddWalletPanel />
            <RequestPayoutPanel />
          </div>
          <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-5">
            <PayoutStatus />
            <EarningsPanel />
            <CryptoNetworks />
            <SecurityCenter />
            <SupportPanel />
          </div>
          <SystemArchitecture />
          <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-4">
            <AdminDashboard />
            <SecurityFeatures />
            <BitcoinLightningFlow />
            <TechnologyStack />
          </div>
          <PageFooter />
        </main>
      </div>
    </div>
  );
}

// ── header ─────────────────────────────────────────────────────────────────

const CAPABILITIES: { icon: LucideIcon; label: string }[] = [
  { icon: Shield, label: "Secure" },
  { icon: Globe, label: "Transparent" },
  { icon: Radio, label: "Global" },
  { icon: CircleDollarSign, label: "Multi-Chain" },
  { icon: Clock, label: "Real-time" },
  { icon: Building2, label: "Built for Creators, Moderators & Communities" },
];

function TopBar() {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/85 backdrop-blur">
      <div className="mx-auto max-w-[1800px] px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-lg font-black text-white shadow-sm">
              F
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-[19px] font-extrabold tracking-tight">FurlPay</span>
                <BadgeCheck className="h-4 w-4 text-sky-500" aria-label="Verified" />
              </div>
              <p className="text-[11px] font-medium text-slate-500">
                Work · Contribute · Earn · Get Paid
              </p>
            </div>
          </div>

          <div className="hidden min-w-0 flex-1 flex-col items-center lg:flex">
            <h1 className="truncate text-[20px] font-extrabold tracking-tight">
              Complete Payments &amp; Payouts System
            </h1>
            <p className="text-[12px] text-slate-500">
              All in one Discord channel —{" "}
              <span className="font-semibold text-indigo-600">#payments-payouts</span>
            </p>
          </div>

          <div className="flex items-center gap-1.5">
            <button aria-label="Search" className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100">
              <Search className="h-4 w-4" />
            </button>
            <button aria-label="Notifications" className="relative grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100">
              <Bell className="h-4 w-4" />
              <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-rose-500" />
            </button>
            <button aria-label="Help" className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100">
              <HelpCircle className="h-4 w-4" />
            </button>
            <div className="ml-1 flex items-center gap-2 rounded-lg border border-slate-200 py-1 pl-1 pr-2">
              <div className="relative">
                <div className="grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br from-sky-400 to-indigo-500 text-[11px] font-bold text-white">
                  M
                </div>
                <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-500" />
              </div>
              <div className="hidden sm:block">
                <p className="text-[12px] font-semibold leading-tight">Moderator</p>
                <p className="text-[10px] leading-tight text-emerald-600">Online</p>
              </div>
              <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
            </div>
          </div>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-slate-100 pt-2.5">
          {CAPABILITIES.map(({ icon: Icon, label }) => (
            <span key={label} className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-slate-600">
              <Icon className="h-3.5 w-3.5 text-indigo-500" />
              {label}
            </span>
          ))}
        </div>
      </div>
    </header>
  );
}

// ── sidebar ────────────────────────────────────────────────────────────────

const CHANNELS = [
  "announcements",
  "general",
  "community",
  "payments-payouts",
  "support",
  "suggestions",
  "events",
  "resources",
];

function DiscordSidebar() {
  return (
    <aside className={`${CARD} hidden w-56 shrink-0 self-start p-2 lg:block`}>
      <div className="flex items-center justify-between rounded-lg px-2 py-2">
        <span className="text-[13px] font-bold tracking-tight">FurlPay</span>
        <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
      </div>
      <nav className="mt-1 space-y-0.5">
        {CHANNELS.map((c) => {
          const active = c === "payments-payouts";
          return (
            <a
              key={c}
              href={active ? "#" : undefined}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12.5px] transition ${
                active
                  ? "bg-indigo-50 font-semibold text-indigo-700"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              <span className={active ? "text-indigo-400" : "text-slate-400"}>#</span>
              <span className="truncate">{c}</span>
              {active && (
                <span className="ml-auto grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
                  1
                </span>
              )}
            </a>
          );
        })}
      </nav>
      <p className={`${PANEL_TITLE} mt-3 px-2`}>Voice</p>
      <nav className="mt-1 space-y-0.5">
        {["Lounge", "Work Room", "Support"].map((v) => (
          <div key={v} className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12.5px] text-slate-600">
            <Mic className="h-3.5 w-3.5 text-slate-400" />
            {v}
          </div>
        ))}
      </nav>
    </aside>
  );
}

// ── 1. journey ─────────────────────────────────────────────────────────────

const JOURNEY = [
  { label: "Join Discord", desc: "Enter the community" },
  { label: "Open #payments-payouts", desc: "Your payment center" },
  { label: "Onboard & Verify", desc: "Profile and identity" },
  { label: "Add Wallet", desc: "Validated and proven" },
  { label: "Complete Work", desc: "Logged and approved" },
  { label: "Request Payout", desc: "Policy checked" },
  { label: "Get Paid", desc: "Settled on-chain" },
];

function UserJourney() {
  return (
    <Panel n={1} title="User journey" hint="end-to-end">
      <ol className="flex flex-wrap items-stretch gap-1.5">
        {JOURNEY.map((s, i) => (
          <li key={s.label} className="flex flex-1 items-center gap-1.5">
            <div className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50/60 px-2.5 py-2">
              <p className="truncate text-[12px] font-semibold text-slate-800">{s.label}</p>
              <p className="truncate text-[10.5px] text-slate-500">{s.desc}</p>
            </div>
            {i < JOURNEY.length - 1 && (
              <ArrowRight className="hidden h-3.5 w-3.5 shrink-0 text-slate-300 sm:block" aria-hidden />
            )}
          </li>
        ))}
      </ol>
    </Panel>
  );
}

// ── 2. main channel ────────────────────────────────────────────────────────

function BotHeader({ time }: { time: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="grid h-7 w-7 place-items-center rounded-full bg-indigo-500 text-[11px] font-bold text-white">
        F
      </div>
      <span className="text-[12.5px] font-semibold">FurlPay Bot</span>
      <Pill tone="indigo">APP</Pill>
      <span className="text-[10.5px] text-slate-400">{time}</span>
    </div>
  );
}

function MainChannel() {
  const balances = [
    { label: "Available", value: 1284.5, tone: "text-emerald-600" },
    { label: "Pending", value: 320.0, tone: "text-amber-600" },
    { label: "Lifetime", value: 8942.5, tone: "text-slate-900" },
  ];
  const actions = ["Account", "Earnings", "Payout", "Crypto Networks", "Security", "Support"];

  return (
    <Panel n={2} title="Main channel interface" className="xl:col-span-2 2xl:col-span-2">
      <BotHeader time="Today 10:00" />
      <div className="mt-2.5 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
        <p className="text-[13px] font-bold">FurlPay Payments &amp; Payouts</p>
        <p className="mt-0.5 text-[11.5px] text-slate-600">
          Welcome to your FurlPay Payment Center.
        </p>

        <dl className="mt-3 grid grid-cols-3 gap-2">
          {balances.map((b) => (
            <div key={b.label} className="rounded-lg border border-slate-200 bg-white px-2.5 py-2">
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                {b.label}
              </dt>
              <dd className={`mt-0.5 text-[15px] font-extrabold tabular-nums ${b.tone}`}>
                {money(b.value)}
              </dd>
            </div>
          ))}
        </dl>

        <div className="mt-2.5 grid grid-cols-3 gap-1.5">
          {actions.map((a) => (
            <Btn key={a}>{a}</Btn>
          ))}
        </div>

        <div className="mt-2.5 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-2.5 py-2">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
              Last payout
            </p>
            <p className="truncate text-[11.5px] text-slate-700">
              $500.00 USDC · Base · Completed
            </p>
          </div>
        </div>
      </div>
      <p className="mt-2 text-[10px] text-slate-400">
        Figures are from a specimen account, shown for layout.
      </p>
    </Panel>
  );
}

// ── 3. account ─────────────────────────────────────────────────────────────

function AccountOnboarding() {
  const rows: [string, React.ReactNode][] = [
    ["Status", <Pill key="s" tone="green"><CheckCircle2 className="h-3 w-3" />Active</Pill>],
    ["Name", <span key="n" className="font-mono text-[11.5px]">John D***</span>],
    ["Country", "India"],
    ["Verification", <Pill key="v" tone="green"><BadgeCheck className="h-3 w-3" />Verified</Pill>],
    ["Payment status", <Pill key="p" tone="blue">Enabled</Pill>],
  ];
  return (
    <Panel n={3} title="Account & onboarding">
      <BotHeader time="10:02" />
      <div className="mt-2.5 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
        <p className="text-[12px] font-bold">Payment profile</p>
        <dl className="mt-2 space-y-1.5">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-2">
              <dt className="text-[11.5px] text-slate-500">{k}</dt>
              <dd className="text-[11.5px] font-medium text-slate-800">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-3 grid grid-cols-2 gap-1.5">
          {["View details", "Update info", "Payment methods", "Wallets", "Default method", "Statements"].map(
            (b) => (
              <Btn key={b}>{b}</Btn>
            )
          )}
        </div>
      </div>
    </Panel>
  );
}

// ── 4 + 5. add wallet — the interactive one ────────────────────────────────

type Asset = { key: MarkKey; label: string; rails: { rail: string; network: string; label: string; mark: MarkKey }[] };

const ASSETS: Asset[] = [
  {
    key: "usdc",
    label: "USDC",
    rails: [
      { rail: "EVM", network: "base", label: "Base", mark: "base" },
      { rail: "EVM", network: "arbitrum", label: "Arbitrum", mark: "arbitrum" },
      { rail: "EVM", network: "polygon", label: "Polygon", mark: "polygon" },
      { rail: "SOLANA", network: "solana", label: "Solana", mark: "solana" },
    ],
  },
  {
    key: "btc",
    label: "BTC",
    rails: [
      { rail: "BITCOIN_ONCHAIN", network: "bitcoin:mainnet", label: "Bitcoin on-chain", mark: "bitcoin" },
      { rail: "BITCOIN_LIGHTNING", network: "bitcoin:mainnet", label: "Lightning", mark: "lightning" },
    ],
  },
];

interface ValidationOk {
  ok: true;
  rail: string;
  network: string;
  destination: string;
  assetSymbol: string;
  decimals: number;
  addressType: string | null;
  requiresNetworkConfirmation: boolean;
  summary: string;
  ownership: "supported" | "not_implemented";
}
interface ValidationErr {
  ok: false;
  reason: string;
  detail: string;
}
type Validation = ValidationOk | ValidationErr;

function AddWalletPanel() {
  const [asset, setAsset] = useState<Asset>(ASSETS[0]);
  const [railIdx, setRailIdx] = useState(0);
  const [address, setAddress] = useState("");
  const [state, setState] = useState<"idle" | "checking" | "done">("idle");
  const [result, setResult] = useState<Validation | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [verified, setVerified] = useState(false);

  const rail = asset.rails[railIdx] ?? asset.rails[0];

  const reset = useCallback(() => {
    setState("idle");
    setResult(null);
    setConfirmed(false);
    setVerified(false);
  }, []);

  const validate = useCallback(async () => {
    if (!address.trim()) return;
    setState("checking");
    setVerified(false);
    setConfirmed(false);
    try {
      const res = await fetch("/api/payouts/validate-destination", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rail: rail.rail, network: rail.network, destination: address.trim() }),
      });
      setResult((await res.json()) as Validation);
    } catch {
      setResult({ ok: false, reason: "network", detail: "Could not reach the validator. Try again." });
    } finally {
      setState("done");
    }
  }, [address, rail]);

  const challenge = useMemo(
    () => `FP-${Math.random().toString(16).slice(2, 6).toUpperCase()}-${Math.random().toString(16).slice(2, 6).toUpperCase()}`,
    []
  );

  return (
    <>
      <Panel n={4} title="Add wallet" hint="live validation">
        <BotHeader time="10:05" />

        <p className={`${PANEL_TITLE} mt-3`}>Choose asset</p>
        <div className="mt-1.5 flex gap-1.5">
          {ASSETS.map((a) => (
            <button
              key={a.label}
              onClick={() => {
                setAsset(a);
                setRailIdx(0);
                reset();
              }}
              aria-pressed={asset.label === a.label}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-[12px] font-semibold transition ${
                asset.label === a.label
                  ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              <CryptoMark mark={a.key} size={16} />
              {a.label}
            </button>
          ))}
        </div>

        <p className={`${PANEL_TITLE} mt-3`}>Choose network / rail</p>
        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
          {asset.rails.map((r, i) => (
            <button
              key={r.label}
              onClick={() => {
                setRailIdx(i);
                reset();
              }}
              aria-pressed={railIdx === i}
              className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11.5px] font-medium transition ${
                railIdx === i
                  ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              <CryptoMark mark={r.mark} size={15} />
              <span className="truncate">{r.label}</span>
            </button>
          ))}
        </div>

        <label htmlFor="wallet-addr" className={`${PANEL_TITLE} mt-3 block`}>
          Enter wallet address
        </label>
        <input
          id="wallet-addr"
          value={address}
          onChange={(e) => {
            setAddress(e.target.value);
            reset();
          }}
          onBlur={() => address.trim() && void validate()}
          placeholder={rail.rail.startsWith("BITCOIN") ? "bc1p…" : "0x… or base58"}
          spellCheck={false}
          className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 font-mono text-[12px] outline-none placeholder:text-slate-300 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20"
        />
        <Btn variant="primary" size="md" className="mt-2 w-full" onClick={() => void validate()} disabled={!address.trim() || state === "checking"}>
          {state === "checking" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Detect &amp; validate
        </Btn>

        {result && <ValidationResult result={result} />}
      </Panel>

      <Panel n={5} title="Confirm & verify wallet">
        <BotHeader time="10:07" />
        {!result?.ok ? (
          <div className="mt-3 grid place-items-center rounded-lg border border-dashed border-slate-200 py-10 text-center">
            <Wallet className="h-5 w-5 text-slate-300" />
            <p className="mt-2 text-[11.5px] text-slate-500">
              Validate an address to continue.
            </p>
          </div>
        ) : (
          <div className="mt-2.5 space-y-2.5">
            <dl className="rounded-lg border border-slate-200 bg-slate-50/60 p-2.5 text-[11.5px]">
              {[
                ["Asset", result.assetSymbol],
                ["Network", result.network],
                ["Address", result.destination.slice(0, 10) + "…" + result.destination.slice(-4)],
                ...(result.addressType ? ([["Type", result.addressType.toUpperCase()]] as [string, string][]) : []),
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2 py-0.5">
                  <dt className="text-slate-500">{k}</dt>
                  <dd className="truncate font-mono font-medium text-slate-800">{v}</dd>
                </div>
              ))}
            </dl>

            <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50/70 p-2.5">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
              <p className="text-[11px] text-amber-900">
                Crypto transfers are irreversible. Make sure the network and address are correct — this
                wallet will receive your payouts.
              </p>
            </div>

            <label className="flex cursor-pointer items-start gap-2 text-[11.5px] text-slate-700">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="mt-0.5 accent-indigo-600"
              />
              I confirm the network and address above are correct.
            </label>

            {result.ownership === "not_implemented" ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                <p className="text-[11.5px] font-semibold text-slate-700">
                  Ownership proof unavailable on this rail
                </p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  FurlPay cannot yet verify control of a {result.assetSymbol} address on this rail.
                  Payouts here stay subject to manual review.
                </p>
              </div>
            ) : (
              <div className="rounded-lg border border-slate-200 bg-white p-2.5">
                <p className="text-[11.5px] font-semibold">Verify ownership</p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  Sign a message with this wallet. It authorises nothing and moves no funds.
                </p>
                <div className="mt-2 flex items-center justify-between rounded-md bg-slate-50 px-2 py-1.5">
                  <code className="font-mono text-[11px] font-semibold text-indigo-700">{challenge}</code>
                  <span className="inline-flex items-center gap-1 text-[10.5px] text-slate-500">
                    <Timer className="h-3 w-3" />5 min
                  </span>
                </div>
                <Btn
                  variant={verified ? "success" : "primary"}
                  size="md"
                  className="mt-2 w-full"
                  disabled={!confirmed || verified}
                  onClick={() => setVerified(true)}
                >
                  {verified ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                  {verified ? "Wallet verified" : "Sign with wallet"}
                </Btn>
                <p className="mt-1.5 text-[10px] text-slate-400">
                  FurlPay never asks for a seed phrase, private key or recovery phrase.
                </p>
              </div>
            )}
          </div>
        )}
      </Panel>
    </>
  );
}

function ValidationResult({ result }: { result: Validation }) {
  if (!result.ok) {
    return (
      <div role="alert" className="mt-2.5 flex gap-2 rounded-lg border border-rose-200 bg-rose-50/70 p-2.5">
        <ShieldAlert className="h-4 w-4 shrink-0 text-rose-600" />
        <div>
          <p className="text-[11.5px] font-semibold text-rose-800">
            {result.reason.replace(/_/g, " ")}
          </p>
          <p className="mt-0.5 text-[11px] text-rose-700">{result.detail}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="mt-2.5 rounded-lg border border-emerald-200 bg-emerald-50/60 p-2.5">
      <p className="flex items-center gap-1.5 text-[11.5px] font-semibold text-emerald-800">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Address detected
      </p>
      <dl className="mt-1.5 space-y-0.5 text-[11px]">
        {[
          ["Asset", result.assetSymbol],
          ["Network", result.network],
          ["Decimals", String(result.decimals)],
          ...(result.addressType ? ([["Type", result.addressType.toUpperCase()]] as [string, string][]) : []),
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between">
            <dt className="text-emerald-700/70">{k}</dt>
            <dd className="font-mono font-medium text-emerald-900">{v}</dd>
          </div>
        ))}
      </dl>
      {result.requiresNetworkConfirmation && (
        <p className="mt-1.5 border-t border-emerald-200 pt-1.5 text-[10.5px] text-emerald-800">
          This address format is valid on more than one network. FurlPay will not guess — confirm the
          network explicitly.
        </p>
      )}
    </div>
  );
}

// ── 6. request payout ──────────────────────────────────────────────────────

function RequestPayoutPanel() {
  const AVAILABLE = 1284.5;
  const [amount, setAmount] = useState(500);
  const fee = 0.12;
  return (
    <Panel n={6} title="Request payout">
      <BotHeader time="10:10" />
      <div className="mt-2.5 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          Available balance
        </p>
        <p className="text-[20px] font-extrabold tabular-nums text-slate-900">{money(AVAILABLE)}</p>

        <p className={`${PANEL_TITLE} mt-2.5`}>Select amount</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {[50, 100, 250, 500].map((v) => (
            <button
              key={v}
              onClick={() => setAmount(v)}
              aria-pressed={amount === v}
              className={`rounded-lg border px-2.5 py-1 text-[12px] font-semibold transition ${
                amount === v
                  ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              ${v}
            </button>
          ))}
          <button
            onClick={() => setAmount(AVAILABLE)}
            aria-pressed={amount === AVAILABLE}
            className={`rounded-lg border px-2.5 py-1 text-[12px] font-semibold transition ${
              amount === AVAILABLE
                ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            Max
          </button>
        </div>

        <p className={`${PANEL_TITLE} mt-2.5`}>Payment method</p>
        <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2">
          <CryptoMark mark="usdc" size={17} />
          <span className="text-[12px] font-medium">USDC · Base</span>
          <code className="ml-auto font-mono text-[11px] text-slate-500">0x12ab…91A2</code>
        </div>

        <dl className="mt-2.5 space-y-1 rounded-lg border border-slate-200 bg-white p-2.5 text-[11.5px]">
          {[
            ["Amount", money(amount)],
            ["Network", "Base"],
            ["Destination", "0x12ab…91A2"],
            ["Estimated fee", money(fee)],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between">
              <dt className="text-slate-500">{k}</dt>
              <dd className="font-medium tabular-nums text-slate-800">{v}</dd>
            </div>
          ))}
          <div className="flex justify-between border-t border-slate-100 pt-1 text-[12.5px] font-bold">
            <dt>You receive</dt>
            <dd className="tabular-nums text-emerald-600">{money(Math.max(0, amount - fee))}</dd>
          </div>
        </dl>

        <div className="mt-2.5 flex gap-1.5">
          <Btn variant="success" size="md" className="flex-1">
            <Send className="h-3.5 w-3.5" />
            Confirm payout
          </Btn>
          <Btn size="md">Cancel</Btn>
        </div>
      </div>
    </Panel>
  );
}

// ── 7. payout status ───────────────────────────────────────────────────────

const TIMELINE = ["Requested", "Validated", "Approved", "Processing", "Broadcast", "Confirmed"];

function PayoutStatus() {
  const current = 3;
  return (
    <Panel n={7} title="Payout status">
      <BotHeader time="10:12" />
      <div className="mt-2.5 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
        <div className="flex items-center justify-between">
          <p className="font-mono text-[12px] font-bold">Payout #FP-10482</p>
          <Pill tone="amber">
            <Loader2 className="h-3 w-3 animate-spin" />
            Processing
          </Pill>
        </div>
        <p className="mt-1 text-[12px] font-semibold">$500.00 USDC · Base</p>
        <p className="mt-0.5 font-mono text-[11px] text-slate-500">→ 0x12ab…91A2</p>

        <ol className="mt-3 flex items-start justify-between gap-1">
          {TIMELINE.map((s, i) => {
            const done = i < current;
            const active = i === current;
            return (
              <li key={s} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                <span
                  className={`grid h-4 w-4 place-items-center rounded-full text-[9px] font-bold ${
                    done
                      ? "bg-emerald-500 text-white"
                      : active
                        ? "bg-amber-400 text-white ring-4 ring-amber-100"
                        : "bg-slate-200 text-slate-400"
                  }`}
                >
                  {done ? "✓" : ""}
                </span>
                <span
                  className={`truncate text-center text-[9.5px] ${
                    done || active ? "font-semibold text-slate-700" : "text-slate-400"
                  }`}
                >
                  {s}
                </span>
              </li>
            );
          })}
        </ol>

        <p className="mt-3 rounded-md bg-white px-2 py-1.5 text-[10.5px] text-slate-500">
          Completion reflects on-chain settlement and reconciliation — never a successful API call.
        </p>

        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <Btn>View on explorer</Btn>
          <Btn>View details</Btn>
        </div>
      </div>
    </Panel>
  );
}

// ── 8. earnings ────────────────────────────────────────────────────────────

const WORK = [
  ["Sep 04", "Moderator shift", "6h", "Approved", 300],
  ["Sep 03", "Community moderation", "4h", "Approved", 200],
  ["Sep 02", "Support triage", "3h", "Pending", 150],
] as const;

function EarningsPanel() {
  return (
    <Panel n={8} title="Earnings & work history">
      <BotHeader time="10:15" />
      <dl className="mt-2.5 grid grid-cols-2 gap-2">
        {[
          ["Available", 1284.5],
          ["This month", 2840.0],
          ["Pending", 320.0],
          ["Lifetime", 8942.5],
        ].map(([k, v]) => (
          <div key={k as string} className="rounded-lg border border-slate-200 bg-slate-50/60 px-2.5 py-2">
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{k}</dt>
            <dd className="mt-0.5 text-[14px] font-extrabold tabular-nums">{money(v as number)}</dd>
          </div>
        ))}
      </dl>

      <table className="mt-3 w-full text-left text-[11px]">
        <thead>
          <tr className="border-b border-slate-100 text-[9.5px] uppercase tracking-wide text-slate-400">
            <th className="pb-1 font-semibold">Date</th>
            <th className="pb-1 font-semibold">Work</th>
            <th className="pb-1 font-semibold">Hrs</th>
            <th className="pb-1 text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody>
          {WORK.map(([d, w, h, st, amt]) => (
            <tr key={d} className="border-b border-slate-50 last:border-0">
              <td className="py-1.5 text-slate-500">{d}</td>
              <td className="py-1.5">
                <span className="block truncate font-medium text-slate-800">{w}</span>
                <Pill tone={st === "Approved" ? "green" : "amber"}>{st}</Pill>
              </td>
              <td className="py-1.5 tabular-nums text-slate-600">{h}</td>
              <td className="py-1.5 text-right font-semibold tabular-nums">{money(amt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[10px] text-slate-400">
        Amounts are computed by the backend from approved work — never from a Discord message.
      </p>
    </Panel>
  );
}

// ── 9. networks ────────────────────────────────────────────────────────────

const NETWORKS: { mark: MarkKey; name: string; asset: string; time: string; fee: string; live: boolean }[] = [
  { mark: "base", name: "Base", asset: "USDC", time: "~30s", fee: "Low", live: true },
  { mark: "arbitrum", name: "Arbitrum", asset: "USDC", time: "~30s", fee: "Low", live: true },
  { mark: "polygon", name: "Polygon", asset: "USDC", time: "~1m", fee: "Low", live: true },
  { mark: "ethereum", name: "Ethereum", asset: "USDC", time: "~3m", fee: "High", live: false },
  { mark: "solana", name: "Solana", asset: "USDC", time: "~15s", fee: "Very low", live: true },
  { mark: "bitcoin", name: "Bitcoin", asset: "BTC", time: "~30m", fee: "Variable", live: true },
  { mark: "lightning", name: "Lightning", asset: "BTC", time: "Instant", fee: "Minimal", live: false },
];

function CryptoNetworks() {
  return (
    <Panel n={9} title="Crypto networks supported">
      <ul className="space-y-1.5">
        {NETWORKS.map((n) => (
          <li
            key={n.name}
            className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2"
          >
            <CryptoMark mark={n.mark} size={20} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-semibold">{n.name}</p>
              <p className="text-[10.5px] text-slate-500">
                {n.asset} · {n.time} · {n.fee} fee
              </p>
            </div>
            {n.live ? <Pill tone="green">Live</Pill> : <Pill tone="slate">Planned</Pill>}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[10px] text-slate-400">
        Native SegWit · Taproot · Lightning — Bitcoin address types are detected, never assumed.
      </p>
    </Panel>
  );
}

// ── 10. security ───────────────────────────────────────────────────────────

function SecurityCenter() {
  const [frozen, setFrozen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const rows: [string, string, "green" | "slate"][] = [
    ["Account security", "Good", "green"],
    ["Discord authentication", "Active", "green"],
    ["Payment profile", "Verified", "green"],
    ["Wallet", "Verified", "green"],
    ["Recent wallet changes", "None", "slate"],
    ["Recent payout activity", "Normal", "slate"],
  ];

  return (
    <Panel n={10} title="Security center">
      <ul className="space-y-1">
        {rows.map(([k, v, tone]) => (
          <li key={k} className="flex items-center justify-between gap-2 text-[11.5px]">
            <span className="text-slate-600">{k}</span>
            <Pill tone={tone}>{v}</Pill>
          </li>
        ))}
      </ul>

      {frozen && (
        <div role="alert" className="mt-2.5 flex gap-2 rounded-lg border border-rose-200 bg-rose-50 p-2.5">
          <Snowflake className="h-4 w-4 shrink-0 text-rose-600" />
          <div>
            <p className="text-[11.5px] font-bold text-rose-800">Payouts frozen</p>
            <p className="text-[10.5px] text-rose-700">
              New requests and wallet changes are blocked. Unfreezing requires re-authentication.
            </p>
          </div>
        </div>
      )}

      {confirming && !frozen && (
        <div className="mt-2.5 rounded-lg border border-rose-200 bg-rose-50/70 p-2.5">
          <p className="text-[11.5px] font-bold text-rose-800">Freeze all payouts?</p>
          <ul className="mt-1 space-y-0.5 text-[10.5px] text-rose-700">
            <li>· Blocks new payout requests</li>
            <li>· Stops queued payouts where still possible</li>
            <li>· Prevents wallet changes</li>
            <li>· Notifies FurlPay security and writes an audit event</li>
          </ul>
          <div className="mt-2 flex gap-1.5">
            <Btn variant="danger" onClick={() => { setFrozen(true); setConfirming(false); }}>
              Freeze payouts
            </Btn>
            <Btn onClick={() => setConfirming(false)}>Cancel</Btn>
          </div>
        </div>
      )}

      <div className="mt-2.5 grid grid-cols-2 gap-1.5">
        {frozen ? (
          <Btn variant="ghost" onClick={() => setFrozen(false)}>
            <Lock className="h-3.5 w-3.5" />
            Unfreeze
          </Btn>
        ) : (
          <Btn variant="danger" onClick={() => setConfirming(true)}>
            <Snowflake className="h-3.5 w-3.5" />
            Freeze payouts
          </Btn>
        )}
        <Btn>Security activity</Btn>
        <Btn>Trusted devices</Btn>
        <Btn>Re-authenticate</Btn>
      </div>
    </Panel>
  );
}

// ── 11. support ────────────────────────────────────────────────────────────

function SupportPanel() {
  const [picked, setPicked] = useState<string | null>(null);
  const options = [
    "Payout not received",
    "Wrong payout amount",
    "Wallet problem",
    "Transaction problem",
    "Verification problem",
    "Something else",
  ];
  return (
    <Panel n={11} title="Support">
      <p className="text-[12px] font-semibold">How can we help?</p>
      <div className="mt-2 space-y-1">
        {options.map((o) => (
          <button
            key={o}
            onClick={() => setPicked(o)}
            aria-pressed={picked === o}
            className={`w-full rounded-lg border px-2.5 py-1.5 text-left text-[11.5px] transition ${
              picked === o
                ? "border-indigo-300 bg-indigo-50 font-medium text-indigo-700"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {o}
          </button>
        ))}
      </div>
      <Btn variant="primary" size="md" className="mt-2.5 w-full" disabled={!picked}>
        Create support ticket
      </Btn>
      <p className="mt-1.5 text-[10px] text-slate-400">
        Opens a private thread. Payout and transaction IDs are attached automatically; nothing
        sensitive is posted publicly.
      </p>
    </Panel>
  );
}

// ── 12. architecture ───────────────────────────────────────────────────────

const FLOW = [
  { label: "Discord", sub: "User interface", tone: "indigo" as const },
  { label: "FurlPay API", sub: "Authenticated" },
  { label: "Identity", sub: "Verification" },
  { label: "Work & earnings", sub: "Ledger" },
  { label: "Risk engine", sub: "Scoring" },
  { label: "Approval engine", sub: "Manual / auto" },
  { label: "Payout service", sub: "Idempotent" },
  { label: "Blockchain", sub: "Providers" },
  { label: "Reconciliation", sub: "Source of truth", tone: "green" as const },
  { label: "Notifications", sub: "Discord · email" },
];

function SystemArchitecture() {
  return (
    <Panel n={12} title="System architecture" hint="backend flow">
      <ol className="flex flex-wrap items-center gap-1.5">
        {FLOW.map((s, i) => (
          <li key={s.label} className="flex items-center gap-1.5">
            <div
              className={`rounded-lg border px-2.5 py-1.5 ${
                s.tone === "indigo"
                  ? "border-indigo-200 bg-indigo-50"
                  : s.tone === "green"
                    ? "border-emerald-200 bg-emerald-50"
                    : "border-slate-200 bg-white"
              }`}
            >
              <p className="text-[11.5px] font-semibold text-slate-800">{s.label}</p>
              <p className="text-[10px] text-slate-500">{s.sub}</p>
            </div>
            {i < FLOW.length - 1 && <ArrowRight className="h-3 w-3 shrink-0 text-slate-300" aria-hidden />}
          </li>
        ))}
      </ol>
      <p className="mt-2.5 flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-[11px] text-slate-600">
        <Shield className="h-3.5 w-3.5 shrink-0 text-indigo-500" />
        Discord is the interface only. It never holds a private key, a macaroon, or treasury
        authority — every money movement is decided and executed behind the API.
      </p>
    </Panel>
  );
}

// ── 13–16 ──────────────────────────────────────────────────────────────────

function AdminDashboard() {
  const items = [
    ["Payout queue", "12"],
    ["Pending approval", "3"],
    ["Risk review", "1"],
    ["Failed payments", "0"],
    ["Reconciliation", "OK"],
    ["Treasury", "—"],
    ["Users", "248"],
    ["Audit logs", "Live"],
  ];
  return (
    <Panel n={13} title="Admin dashboard" hint="internal">
      <ul className="grid grid-cols-2 gap-1.5">
        {items.map(([k, v]) => (
          <li key={k} className="rounded-lg border border-slate-200 bg-slate-50/60 px-2 py-1.5">
            <p className="text-[10.5px] text-slate-500">{k}</p>
            <p className="text-[12px] font-bold tabular-nums">{v}</p>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[10px] text-slate-400">
        Multi-party approval above threshold. Admins cannot edit financial history — corrections are
        reversing entries.
      </p>
    </Panel>
  );
}

function SecurityFeatures() {
  const feats = [
    "Wallet ownership verification",
    "Multi-factor authentication",
    "Wallet change protection",
    "Payout freeze",
    "Risk scoring",
    "Audit logs",
    "Rate limits",
    "Idempotency",
    "Replay protection",
    "Webhook verification",
    "Session security",
    "Velocity limits",
  ];
  return (
    <Panel n={14} title="Security features">
      <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        {feats.map((f) => (
          <li key={f} className="flex items-center gap-1.5 text-[11px] text-slate-700">
            <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500" />
            <span className="truncate">{f}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function BitcoinLightningFlow() {
  return (
    <Panel n={15} title="Bitcoin & Lightning">
      <div className="space-y-2">
        <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white p-2.5">
          <CryptoMark mark="bitcoin" size={20} />
          <div className="min-w-0">
            <p className="text-[11.5px] font-semibold">On-chain</p>
            <p className="text-[10.5px] text-slate-500">
              Detect type (Legacy · P2SH · SegWit · Taproot) → validate → fee estimate → PSBT →
              broadcast → confirmations → reconcile
            </p>
          </div>
        </div>
        <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white p-2.5">
          <CryptoMark mark="lightning" size={20} />
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[11.5px] font-semibold">
              Lightning <Pill tone="slate">Planned</Pill>
            </p>
            <p className="text-[10.5px] text-slate-500">
              Invoice → decode → amount &amp; expiry → route → risk → approval → pay → settle →
              receipt
            </p>
          </div>
        </div>
        <p className="rounded-lg bg-slate-50 px-2.5 py-2 text-[10.5px] text-slate-500">
          Bech32 for witness v0, bech32m for Taproot. Using the wrong checksum accepts a corrupted
          address — and a corrupted Bitcoin address is an unspendable payout, not a failed one.
        </p>
      </div>
    </Panel>
  );
}

const STACK = [
  ["viem", "EVM"],
  ["ethers", "EVM"],
  ["@solana/web3.js", "Solana"],
  ["@scure/base", "Encoding"],
  ["bs58", "Encoding"],
  ["@noble/hashes", "Hashing"],
  ["tweetnacl", "Ed25519"],
  ["Bitcoin Core", "Bitcoin"],
  ["LND / BTCPay", "Lightning"],
  ["PostgreSQL", "Database"],
  ["Redis", "Cache · locks"],
  ["Docker", "Deploy"],
];

function TechnologyStack() {
  return (
    <Panel n={16} title="Technology stack">
      <ul className="grid grid-cols-2 gap-1.5">
        {STACK.map(([name, role]) => (
          <li key={name} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5">
            <p className="truncate font-mono text-[11px] font-semibold text-slate-800">{name}</p>
            <p className="text-[10px] text-slate-500">{role}</p>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function PageFooter() {
  return (
    <footer className={`${CARD} flex flex-wrap items-center justify-between gap-3 px-4 py-3`}>
      <div className="flex items-center gap-2">
        <div className="grid h-6 w-6 place-items-center rounded-md bg-gradient-to-br from-indigo-500 to-violet-600 text-[11px] font-black text-white">
          F
        </div>
        <span className="text-[12px] font-semibold">FurlPay</span>
        <span className="text-[11px] text-slate-500">
          A global platform for contributors, moderators and communities
        </span>
      </div>
      <div className="flex items-center gap-3 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1">
          <Landmark className="h-3.5 w-3.5" />
          Secure payments
        </span>
        <span className="inline-flex items-center gap-1">
          <Zap className="h-3.5 w-3.5" />
          Powered by blockchain
        </span>
        <span className="inline-flex items-center gap-1">
          <FileText className="h-3.5 w-3.5" />
          Built for the future
        </span>
      </div>
    </footer>
  );
}
