"use client";

import { useEffect, useState } from "react";

// Interactive walkthrough of the on-chain compliance guardrail, reproducing the
// two scenarios from "Compliance-Aware Agentic Payments on Stablecoin Rails".
// The stepper mirrors the real X402PolicyWrapper flow; when the contracts are
// deployed, the status banner links to them on Arbiscan.

type Badge = "AUTH" | "PASS" | "PENDING" | "PROPOSED" | "TRANCHED" | "ATTESTED" | "SETTLED" | "RELEASED";

interface Step {
  label: string;
  detail: string;
  badge: Badge;
}

const SCENARIO_I: Step[] = [
  { label: "Buyer agent signs the payment", detail: "EIP-3009 USDC authorization for 25 USDC — no gas, no custody.", badge: "AUTH" },
  { label: "Sanctions check", detail: "Payer and recipient screened against the Chainalysis oracle and the OFAC registry.", badge: "PASS" },
  { label: "Source-of-funds check", detail: "25 USDC is under the source-of-funds threshold.", badge: "PASS" },
  { label: "PolicyWrapper settles", detail: "transferWithAuthorization moves USDC payer → recipient. The wrapper never holds funds.", badge: "SETTLED" },
  { label: "Attestation recorded", detail: "A PASS attestation is written on-chain, bound to the transaction id.", badge: "PASS" },
];

const SCENARIO_II: Step[] = [
  { label: "Buyer agent signs the payment", detail: "EIP-3009 USDC authorization for 1,500 USDC.", badge: "AUTH" },
  { label: "Sanctions check", detail: "Payer and recipient screened. Clean.", badge: "PASS" },
  { label: "Source-of-funds check", detail: "1,500 USDC exceeds the threshold and no attestation is on file.", badge: "PENDING" },
  { label: "Compliance agent proposes a tranche", detail: "1,000 USDC settles now; 500 USDC is escrowed pending evidence.", badge: "PROPOSED" },
  { label: "Tranche settles, remainder escrowed", detail: "The compliant tranche pays the recipient; the remainder is pulled into ComplianceEscrow.", badge: "TRANCHED" },
  { label: "Source-of-funds attestation", detail: "The buyer submits evidence; the operator records its hash on-chain.", badge: "ATTESTED" },
  { label: "Escrow releases the remainder", detail: "With a valid attestation, the escrow pays the recipient the held 500 USDC.", badge: "RELEASED" },
  { label: "Final attestation", detail: "The transaction attestation is finalized as PASS (source-of-funds resolved).", badge: "PASS" },
];

const BADGE_STYLES: Record<Badge, string> = {
  AUTH: "border-white/15 bg-white/[0.04] text-textSecondary",
  PASS: "border-neon/40 bg-neon/10 text-neon",
  SETTLED: "border-neon/40 bg-neon/10 text-neon",
  RELEASED: "border-neon/40 bg-neon/10 text-neon",
  ATTESTED: "border-neon/40 bg-neon/10 text-neon",
  PENDING: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  PROPOSED: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  TRANCHED: "border-sky-400/40 bg-sky-400/10 text-sky-300",
};

interface GuardStatus {
  chain: string;
  chainId: number;
  readReady: boolean;
  settleReady: boolean;
  explorer: string;
  addresses: Record<string, string | undefined>;
}

export default function AgenticComplianceDemo() {
  const [scenario, setScenario] = useState<"I" | "II">("I");
  const [revealed, setRevealed] = useState(1);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<GuardStatus | null>(null);

  const steps = scenario === "I" ? SCENARIO_I : SCENARIO_II;

  useEffect(() => {
    fetch("/api/x402/policy/evaluate")
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => s && setStatus(s))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!running) return;
    if (revealed >= steps.length) {
      setRunning(false);
      return;
    }
    const t = setTimeout(() => setRevealed((n) => n + 1), 750);
    return () => clearTimeout(t);
  }, [running, revealed, steps.length]);

  function selectScenario(s: "I" | "II") {
    setScenario(s);
    setRevealed(1);
    setRunning(false);
  }

  function run() {
    setRevealed(1);
    setRunning(true);
  }

  const wrapper = status?.addresses?.policyWrapper;

  return (
    <div className="glow-border overflow-hidden rounded-2xl">
      {/* Live status */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-white/[0.02] px-5 py-3">
        <div className="flex items-center gap-2 text-[13px]">
          <span className={`h-2 w-2 rounded-full ${status?.readReady ? "bg-neon" : "bg-amber-400"}`} />
          {status?.readReady ? (
            <span className="text-textSecondary">
              Live guardrail on {status.chain} ·{" "}
              {wrapper ? (
                <a
                  href={`${status.explorer}/address/${wrapper}`}
                  className="text-neon hover:underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  PolicyWrapper
                </a>
              ) : (
                "PolicyWrapper"
              )}
            </span>
          ) : (
            <span className="text-textSecondary">
              Reference flow — contracts pending deployment on Arbitrum One.
            </span>
          )}
        </div>
        <div className="flex gap-1.5">
          {(["I", "II"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => selectScenario(s)}
              className={`rounded-full px-3 py-1 text-[12px] font-semibold transition-colors ${
                scenario === s ? "bg-neon text-black" : "border border-white/15 text-textSecondary hover:text-white"
              }`}
            >
              Scenario {s}
            </button>
          ))}
        </div>
      </div>

      {/* Scenario header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
        <div>
          <h3 className="text-[17px] font-bold">
            {scenario === "I" ? "Compliant payment settles immediately" : "Pending compliance, resolved via escrow"}
          </h3>
          <p className="mt-1 text-[13px] text-textSecondary">
            {scenario === "I"
              ? "All checks pass, so settlement is instant and an attestation is recorded."
              : "The payment exceeds the source-of-funds threshold, so it is tranched and escrowed until evidence is provided."}
          </p>
        </div>
        <button type="button" onClick={run} className="btn-green px-5 py-2 text-[14px]">
          {running ? "Running…" : "Run the flow"}
        </button>
      </div>

      {/* Steps */}
      <ol className="space-y-2 px-5 pb-5 pt-4">
        {steps.map((step, i) => {
          const shown = i < revealed;
          return (
            <li
              key={step.label}
              className={`flex items-start gap-3 rounded-xl border p-3 transition-all duration-300 ${
                shown ? "border-white/10 bg-white/[0.02] opacity-100" : "border-transparent opacity-30"
              }`}
            >
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/15 text-[12px] font-semibold text-textSecondary">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[14px] font-semibold">{step.label}</p>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${BADGE_STYLES[step.badge]}`}>
                    {step.badge}
                  </span>
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-textSecondary">{step.detail}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
