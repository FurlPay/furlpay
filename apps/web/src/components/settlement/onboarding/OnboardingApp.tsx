"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Check, CircleHelp, Headphones, RefreshCw } from "lucide-react";
import Header from "../os/Header";
import { api, Notice } from "../os/primitives";
import { STEP_META, STEPS, type StepId } from "@/lib/settlement/onboarding";
import { onboardingPath } from "@/lib/settlement/routes";
import type { OnboardingView } from "./types";
import { BusinessStep, ComplianceStep, DetailsStep, IdentityStep, ReviewStep, SettlementStep, TreasuryStep } from "./steps";

const LOAD_TIMEOUT_MS = 20_000;

export default function OnboardingApp({ step }: { step: StepId | null }) {
  const router = useRouter();
  const [view, setView] = useState<OnboardingView | null>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      // A cold start that never answers must end in an error with Retry, not an endless skeleton.
      setView(await api<OnboardingView>("/api/settlement/onboarding", { signal: AbortSignal.timeout(LOAD_TIMEOUT_MS) }));
    } catch (e) {
      const timedOut = e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError");
      setError(timedOut ? "Onboarding took too long to load. Retry in a moment." : e instanceof Error ? e.message : "Onboarding is unavailable.");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  // No step in the URL → resume where the user left off.
  useEffect(() => {
    if (view && !step) router.replace(onboardingPath(view.resume));
  }, [view, step, router]);
  // A step whose prerequisites are incomplete is not reachable by URL either.
  useEffect(() => {
    if (view && step && view.steps[step] === "BLOCKED") router.replace(onboardingPath(view.resume));
  }, [view, step, router]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const go = useCallback((s: StepId) => router.push(onboardingPath(s)), [router]);
  const current = step ?? view?.resume ?? "business";

  return (
    <div className="os">
      <Header user={view ? { name: view.account.name, company: view.state.business?.tradingName ?? view.state.business?.legalName } : null} environment={view?.environment} />
      <div className="os-onboard">
        <aside className="os-card os-steps" aria-label="Onboarding steps">
          <header>
            <h2>Business Onboarding</h2>
            <p>Get started with FurlPay in a few steps.</p>
          </header>
          <ol>
            {STEPS.map((s, i) => {
              const status = view?.steps[s] ?? "NOT_STARTED";
              const here = s === current;
              const label = here ? STEP_META[s].hint : status === "COMPLETED" ? "Completed" : status === "REQUIRES_ACTION" ? "Action required" : STEP_META[s].hint;
              return (
                <li key={s} data-status={status}>
                  <button type="button" className="os-step" data-status={status} aria-current={here ? "step" : undefined} disabled={!view || status === "BLOCKED"} onClick={() => go(s)}>
                    <span className="os-step-mark">{status === "COMPLETED" && !here ? <Check size={17} strokeWidth={3} /> : i + 1}</span>
                    <span>
                      <strong>{STEP_META[s].title}</strong>
                      <small>{label}</small>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="os-help">
            <div className="os-help-head">
              <span className="os-icon-tile">
                <CircleHelp size={20} />
              </span>
              <span>
                <strong>Need help?</strong>
                <small>Our team is here to assist you</small>
              </span>
            </div>
            <Link className="os-btn os-btn-block" href="/support">
              <Headphones size={16} /> Contact Support
            </Link>
          </div>
        </aside>

        {error ? (
          <main className="os-card os-main">
            <h1 className="os-title">Business onboarding</h1>
            <Notice tone="error">{error}</Notice>
            <div className="os-actions">
              <button className="os-btn" onClick={() => void load()}>
                <RefreshCw size={16} /> Retry
              </button>
              <Link className="os-btn" href="/login?next=%2Fsettlement%2Fonboarding">
                Sign in
              </Link>
            </div>
          </main>
        ) : !view || !step ? (
          <main className="os-card os-main" aria-busy="true" aria-label="Loading onboarding">
            <div className="os-skeleton" style={{ width: 110, height: 22 }} />
            <div className="os-skeleton" style={{ width: "55%", height: 38, marginTop: 16 }} />
            <div className="os-skeleton" style={{ width: "75%", height: 18, marginTop: 12 }} />
            <div className="os-skeleton" style={{ height: 300, marginTop: 30 }} />
          </main>
        ) : (
          <StepView step={step} view={view} setView={setView} go={go} notify={setToast} />
        )}
      </div>
      {toast && (
        <div className="os-toast" role="status">
          <Check size={17} color="var(--os-accent)" /> {toast}
        </div>
      )}
    </div>
  );
}

export type StepProps = {
  view: OnboardingView;
  setView: (v: OnboardingView) => void;
  go: (s: StepId) => void;
  notify: (m: string) => void;
};

function StepView({ step, ...p }: StepProps & { step: StepId }) {
  switch (step) {
    case "business":
      return <BusinessStep {...p} />;
    case "identity":
      return <IdentityStep {...p} />;
    case "details":
      return <DetailsStep {...p} />;
    case "compliance":
      return <ComplianceStep {...p} />;
    case "treasury":
      return <TreasuryStep {...p} />;
    case "settlement":
      return <SettlementStep {...p} />;
    case "review":
      return <ReviewStep {...p} />;
  }
}
