"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, TrendingUp, ShieldCheck } from "lucide-react";
import { getJSON, postJSON } from "@/lib/api";
import { Spinner, usd } from "@/components/ui";
import Modal from "@/components/Modal";

interface Vault {
  address: string;
  name: string;
  symbol: string;
  netApy: number;
  tvlUsd: number;
  fee: number;
  curators: string[];
  risk: "Low" | "Medium";
  live: boolean;
}
interface Position {
  id: string;
  vault: string;
  vaultName: string;
  apy: number;
  principalUsd: number;
  currentValueUsd: number;
  earnedUsd: number;
  days: number;
  live: boolean;
}
interface EarnData {
  live: boolean;
  vaults: Vault[];
  positions: Position[];
  summary: { totalPrincipal: number; totalValue: number; totalEarned: number; blendedApy: number; projectedYearly: number };
  idleUsdc: number;
  bestApy: number;
  disclosure: string;
}

type Sheet = { mode: "deposit"; vault: Vault } | { mode: "withdraw"; position: Position } | null;

export default function EarnPage() {
  const [data, setData] = useState<EarnData | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);

  const load = useCallback(() => {
    getJSON<EarnData>("/api/earn").then(setData).catch(console.error);
  }, []);
  useEffect(() => load(), [load]);

  if (!data) return <Spinner />;
  const { summary } = data;

  return (
    <>
      <header className="flex items-center gap-3 px-4 pb-4 pt-3">
        <Link href="/dashboard" aria-label="Back" className="tap rounded-full border border-white/[0.08] bg-white/[0.04] p-2">
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-[22px] font-bold tracking-tight">Earn</h1>
        {data.live ? (
          <span className="ml-auto rounded-full bg-neon/15 px-2.5 py-1 text-[10px] font-bold text-neon">LIVE · Morpho</span>
        ) : (
          <span className="ml-auto rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-bold text-white/60">DEMO</span>
        )}
      </header>

      {/* Earnings hero */}
      <section className="px-5">
        <div className="app-hero p-5">
          <div className="flex items-center justify-between">
            <p className="text-[13px] text-white/70">Total earned</p>
            <span className="rounded-full bg-neon/15 px-2.5 py-1 text-[11px] font-bold text-neon">
              Up to {data.bestApy}% APY
            </span>
          </div>
          <p className="mt-1 text-[40px] font-extrabold leading-none tracking-tighter text-neon">
            {usd(summary.totalEarned)}
          </p>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <HeroStat label="Deposited" value={usd(summary.totalPrincipal)} />
            <HeroStat label="Blended APY" value={`${summary.blendedApy}%`} />
            <HeroStat label="Est. / year" value={usd(summary.projectedYearly)} />
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-white/60">
            Deposits go straight into curated ERC-4626 vaults on Morpho (Arbitrum). Net APY after fees &amp;
            rewards — no lock-up, withdraw anytime.
          </p>
        </div>
      </section>

      {/* Idle USDC nudge */}
      {data.idleUsdc > 0 && data.vaults.length > 0 && (
        <section className="mt-4 px-5">
          <button
            onClick={() => setSheet({ mode: "deposit", vault: bestVault(data.vaults) })}
            className="glow-border flex w-full items-center justify-between p-4 text-left"
          >
            <div>
              <p className="text-[13px] font-semibold">You have {usd(data.idleUsdc)} idle USDC</p>
              <p className="text-[12px] text-textSecondary">Put it to work at up to {data.bestApy}% APY.</p>
            </div>
            <span className="rounded-pill bg-neon px-4 py-2 text-[13px] font-bold text-black">Deposit</span>
          </button>
        </section>
      )}

      {/* Active positions */}
      {data.positions.length > 0 && (
        <section className="mt-7 px-5">
          <h2 className="mb-3 text-[17px] font-bold tracking-tight">Your positions</h2>
          <div className="space-y-3">
            {data.positions.map((p) => (
              <div key={p.id} className="surface-card flex items-center gap-3 p-4">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-neon/15 text-neon">
                  <TrendingUp className="h-4 w-4" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold">{p.vaultName}</p>
                  <p className="text-[12px] text-textSecondary">
                    {usd(p.currentValueUsd)} · {p.days} days · {p.apy}% APY
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <p className="font-bold text-neon">+{usd(p.earnedUsd)}</p>
                  <button
                    onClick={() => setSheet({ mode: "withdraw", position: p })}
                    className="rounded-pill border border-white/15 px-3 py-1.5 text-[12px] font-semibold"
                  >
                    Withdraw
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Vaults */}
      <section className="mt-7 px-5">
        <h2 className="mb-3 text-[17px] font-bold tracking-tight">USDC vaults</h2>
        <div className="space-y-3">
          {data.vaults.map((v) => (
            <button
              key={v.address}
              onClick={() => setSheet({ mode: "deposit", vault: v })}
              className="surface-card flex w-full items-center gap-3 p-4 text-left"
            >
              <div className="flex-1">
                <p className="font-semibold">{v.name}</p>
                <p className="text-[12px] text-textSecondary">
                  {v.curators.join(", ") || "Morpho"} · {usd(v.tvlUsd)} TVL
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className="flex items-center gap-1 font-bold text-neon">
                    <TrendingUp className="h-3.5 w-3.5" /> {v.netApy}%
                  </p>
                  <p className="text-[11px] text-textSecondary">{v.risk} risk</p>
                </div>
                <span className="rounded-pill border border-neon/40 px-3 py-1.5 text-[12px] font-semibold text-neon">
                  Earn
                </span>
              </div>
            </button>
          ))}
        </div>

        <div className="mt-4 flex items-start gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-white/50" />
          <p className="text-[11px] leading-relaxed text-textMuted">{data.disclosure}</p>
        </div>
      </section>

      {sheet && (
        <EarnSheet
          sheet={sheet}
          idleUsdc={data.idleUsdc}
          onClose={() => setSheet(null)}
          onDone={() => {
            setSheet(null);
            load();
          }}
        />
      )}
    </>
  );
}

function EarnSheet({
  sheet,
  idleUsdc,
  onClose,
  onDone,
}: {
  sheet: NonNullable<Sheet>;
  idleUsdc: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const isDeposit = sheet.mode === "deposit";
  const max = isDeposit ? idleUsdc : sheet.position.currentValueUsd;
  const title = isDeposit ? sheet.vault.name : sheet.position.vaultName;
  const apy = isDeposit ? sheet.vault.netApy : sheet.position.apy;
  const vault = isDeposit ? sheet.vault.address : sheet.position.vault;

  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const amountUsd = Number(amount);
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) return setError("Enter a valid amount.");
    if (amountUsd > max + 1e-6) return setError(`Max ${usd(max)}.`);
    setBusy(true);
    setError(null);
    const { ok, data } = await postJSON<{ error?: string; mode?: string }>(
      isDeposit ? "/api/earn/deposit" : "/api/earn/withdraw",
      { amountUsd, vault },
    );
    setBusy(false);
    if (!ok) {
      setError(
        data?.error === "earn_unavailable"
          ? "Live Earn isn't enabled on this environment yet."
          : "Couldn't complete. Try again.",
      );
      return;
    }
    // In live mode the response carries an unsigned tx bundle the wallet signs;
    // the demo simulates and settles immediately.
    onDone();
  };

  return (
    <Modal open onClose={onClose} title={isDeposit ? "Deposit to Earn" : "Withdraw"}>
      <p className="text-[13px] text-textSecondary">
        {title} · <span className="font-semibold text-neon">{apy}% APY</span>
      </p>
      <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
        <div className="flex items-center justify-between text-[11px] text-white/40">
          <span>{isDeposit ? "Deposit" : "Withdraw"} (USDC)</span>
          <button className="text-neon" onClick={() => setAmount(String(round2(max)))}>
            Max {usd(max)}
          </button>
        </div>
        <input
          autoFocus
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
          inputMode="decimal"
          placeholder="0.00"
          className="mt-1 w-full bg-transparent text-3xl font-semibold outline-none"
        />
      </div>
      {error && <p className="mt-2 text-[12px] text-red-400">{error}</p>}
      <button
        onClick={submit}
        disabled={busy || !amount}
        className="mt-4 w-full rounded-pill bg-neon py-3.5 font-bold text-black disabled:opacity-40"
      >
        {busy ? "Working…" : isDeposit ? `Deposit ${amount ? usd(Number(amount)) : ""}` : `Withdraw ${amount ? usd(Number(amount)) : ""}`}
      </button>
    </Modal>
  );
}

function bestVault(vaults: Vault[]): Vault {
  return vaults.slice().sort((a, b) => b.netApy - a.netApy)[0];
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white/[0.06] px-3 py-2.5">
      <p className="text-[11px] text-white/60">{label}</p>
      <p className="mt-0.5 text-[15px] font-bold tracking-tight">{value}</p>
    </div>
  );
}
