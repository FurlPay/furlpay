"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ArrowRight, RefreshCw, ShieldAlert } from "lucide-react";
import { api, Badge, Notice } from "@/components/settlement/os/primitives";
import type { Capability, CapabilityStatus, Health, OnboardingSummary } from "@/lib/compliance/overview";
import { COMPLIANCE_MODULES, type ComplianceModuleId } from "@/lib/compliance/modules";
import { MonitoringPanel, ReportsPanel } from "./ComplianceOps";

export type Overview = {
  generatedAt: string;
  users: { total: number | null; verified: number | null; unavailable?: string };
  onboarding: (OnboardingSummary & { truncated: boolean }) | null;
  onboardingUnavailable?: string;
  capabilities: Capability[];
  health: Health;
  settlement: { usdcSettled30d: number | null; unavailable: string };
};

const STATUS: Record<CapabilityStatus, { label: string; tone: "green" | "amber" | "red" | "muted" }> = {
  live: { label: "Live", tone: "green" },
  configured: { label: "Configured", tone: "green" },
  not_configured: { label: "Not configured", tone: "amber" },
  not_available: { label: "Not available", tone: "muted" },
};
const HEALTH_TONE = { operational: "green", degraded: "amber", attention: "amber", unavailable: "red" } as const;
const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toLocaleString("en-US"));

function useOverview() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<{ message: string; status?: number } | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api<Overview>("/api/compliance/overview"));
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : "Compliance overview unavailable.", status: (e as { status?: number }).status });
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return { data, error, load };
}

function Gate({ error, retry, children }: { error: { message: string; status?: number } | null; retry: () => void; children: ReactNode }) {
  if (error?.status === 401 || error?.status === 403)
    return (
      <Notice tone="error" icon={<ShieldAlert size={16} />}>
        This workspace is limited to FurlPay compliance officers.
      </Notice>
    );
  if (error)
    return (
      <Notice tone="error">
        {error.message}{" "}
        <button type="button" className="os-link" onClick={retry}>
          Retry
        </button>
      </Notice>
    );
  return <>{children}</>;
}

function Kpi({ label, value, hint, href }: { label: string; value: string; hint: string; href?: string }) {
  const body = (
    <>
      <small className="os-eyebrow" style={{ display: "block" }}>
        {label}
      </small>
      <strong className="mono" style={{ fontSize: 26, display: "block", margin: "6px 0 4px" }}>
        {value}
      </strong>
      <small style={{ color: "var(--os-muted)" }}>{hint}</small>
    </>
  );
  return href ? (
    <Link href={href} className="os-card" style={{ padding: 18, display: "block" }}>
      {body}
    </Link>
  ) : (
    <div className="os-card" style={{ padding: 18 }}>
      {body}
    </div>
  );
}

function CapabilityList({ caps }: { caps: Capability[] }) {
  return (
    <div className="os-rows">
      {caps.map((c) => (
        <div key={c.id} className="os-row" style={{ cursor: "default", flexWrap: "wrap" }}>
          <span className="os-row-body">
            <strong>{c.label}</strong>
            <small>
              {c.provider ? `${c.provider} · ` : ""}
              {c.detail}
              {c.requires && c.status !== "live" && c.status !== "configured" ? ` Requires: ${c.requires}.` : ""}
            </small>
          </span>
          <Badge tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Badge>
        </div>
      ))}
    </div>
  );
}

function Title({ eyebrow, title, subtitle, onRefresh }: { eyebrow: string; title: string; subtitle: string; onRefresh: () => void }) {
  return (
    <div className="os-section-head" style={{ marginBottom: 16 }}>
      <div>
        <p className="os-eyebrow">{eyebrow}</p>
        <h1 className="os-title">{title}</h1>
        <p className="os-subtitle">{subtitle}</p>
      </div>
      <button type="button" className="os-btn os-btn-sm" onClick={onRefresh}>
        <RefreshCw size={14} /> Refresh
      </button>
    </div>
  );
}

export function ComplianceOverview() {
  const { data, error, load } = useOverview();
  const o = data?.onboarding;
  return (
    <>
      <Title eyebrow="Compliance & Risk" title="Secure identity. Compliant payments." subtitle="Identity, business verification, screening and review — every figure from a durable record." onRefresh={load} />
      <Gate error={error} retry={load}>
        {!data ? (
          <p style={{ color: "var(--os-muted)" }}>Loading…</p>
        ) : (
          <>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
              <Link className="os-btn os-btn-primary" href="/ops/compliance/cases">
                Open review queue <ArrowRight size={15} />
              </Link>
              <Link className="os-btn" href="/ops/compliance/settings">
                Provider configuration
              </Link>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }} data-testid="compliance-kpis">
              <Kpi label="Total users" value={fmt(data.users.total)} hint={data.users.unavailable ?? "All registered accounts"} href="/ops/compliance/kyc" />
              <Kpi label="Verified users" value={fmt(data.users.verified)} hint={data.users.unavailable ?? "Identity verified by the provider"} href="/ops/compliance/kyc" />
              <Kpi label="Businesses (KYB)" value={fmt(o?.cases)} hint={o ? `${o.submitted} submitted for review${o.truncated ? " · first 500 shown" : ""}` : data.onboardingUnavailable ?? "—"} href="/ops/compliance/kyb" />
              <Kpi label="Active accounts" value={fmt(o?.active)} hint="Activated after every gate passed" href="/ops/compliance/kyb" />
              <Kpi label="USDC settled (30d)" value="—" hint={data.settlement.unavailable} />
              <Kpi label="Open alerts" value={fmt(o?.openAlerts)} hint="Cases awaiting review + potential sanctions matches" href="/ops/compliance/cases" />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16, marginTop: 16 }}>
              <section className="os-card" style={{ padding: 18 }} aria-label="Compliance health">
                <div className="os-section-head">
                  <h2>Compliance health</h2>
                  <Badge tone={HEALTH_TONE[data.health.level]}>{data.health.level[0].toUpperCase() + data.health.level.slice(1)}</Badge>
                </div>
                <strong className="mono" style={{ fontSize: 30 }}>
                  {data.health.score}
                  <small style={{ fontSize: 14, color: "var(--os-muted)" }}> / 100</small>
                </strong>
                <ul className="os-list" style={{ marginTop: 10 }}>
                  {data.health.reasons.length ? data.health.reasons.map((r) => <li key={r}>{r}</li>) : <li>No open issues.</li>}
                </ul>
                <small style={{ color: "var(--os-faint)" }}>Score from a documented formula over configuration and case data (lib/compliance/overview.ts).</small>
              </section>

              <section className="os-card" style={{ padding: 18 }} aria-label="Verification pipeline">
                <h2>Verification pipeline</h2>
                {!o ? (
                  <Notice tone="warn">{data.onboardingUnavailable}</Notice>
                ) : (
                  <dl className="os-dl">
                    <div><dt>Awaiting review</dt><dd className="mono">{o.pendingReview}</dd></div>
                    <div><dt>Changes requested</dt><dd className="mono">{o.changesRequested}</dd></div>
                    <div><dt>Approved</dt><dd className="mono">{o.approved}</dd></div>
                    <div><dt>Rejected</dt><dd className="mono">{o.rejected}</dd></div>
                    <div><dt>Documents awaiting review</dt><dd className="mono">{o.documentsAwaitingReview}</dd></div>
                  </dl>
                )}
              </section>

              <section className="os-card" style={{ padding: 18 }} aria-label="Sanctions screening">
                <h2>Sanctions screening</h2>
                {!o ? (
                  <Notice tone="warn">{data.onboardingUnavailable}</Notice>
                ) : (
                  <dl className="os-dl">
                    <div><dt>Clear</dt><dd className="mono">{o.screening.clear}</dd></div>
                    <div><dt>Potential match (in review)</dt><dd className="mono">{o.screening.potentialMatch}</dd></div>
                    <div><dt>Cleared by review</dt><dd className="mono">{o.screening.clearedByReview}</dd></div>
                    <div><dt>Confirmed match</dt><dd className="mono">{o.screening.confirmedMatch}</dd></div>
                    <div><dt>Screening unavailable</dt><dd className="mono">{o.screening.failed}</dd></div>
                    <div><dt>Not yet screened</dt><dd className="mono">{o.screening.notRun}</dd></div>
                  </dl>
                )}
              </section>
            </div>

            <section className="os-card" style={{ padding: 18, marginTop: 16 }} aria-label="Capabilities">
              <h2>Capabilities</h2>
              <p style={{ color: "var(--os-muted)", marginTop: 0 }}>What runs on this deployment, from real configuration. Nothing unavailable returns a pass.</p>
              <CapabilityList caps={data.capabilities} />
            </section>
            <p style={{ color: "var(--os-faint)", fontSize: 12, marginTop: 12 }}>Generated {new Date(data.generatedAt).toLocaleString()}</p>
          </>
        )}
      </Gate>
    </>
  );
}

const MODULE_INTRO: Record<ComplianceModuleId, string> = {
  kyc: "Individual identity verification: documents, selfie and liveness through the configured provider.",
  kyb: "Business verification: onboarding submissions, documents and ownership, reviewed by compliance officers.",
  aml: "Sanctions, PEP and adverse-media screening of businesses, owners and representatives.",
  fraud: "Device, behaviour and velocity signals.",
  monitoring: "Pattern monitoring over payments and settlement activity.",
  travel: "Wallet address screening and Travel Rule information exchange between providers.",
  india: "DigiLocker, Aadhaar offline eKYC and authorised Aadhaar authentication.",
  policies: "Country risk and the rules that decide which checks apply.",
  reports: "Exports and regulatory reporting.",
  settings: "Every capability, its provider and what it needs to run.",
};
const MODULE_CAPS: Record<ComplianceModuleId, string[] | "all"> = {
  kyc: ["kyc"],
  kyb: ["kyb", "sanctions"],
  aml: ["sanctions", "pep"],
  fraud: ["fraud"],
  monitoring: ["monitoring"],
  travel: ["wallet", "travel_rule"],
  india: ["india"],
  policies: ["country"],
  reports: [],
  settings: "all",
};

export function ComplianceModule({ id }: { id: ComplianceModuleId }) {
  const { data, error, load } = useOverview();
  const meta = COMPLIANCE_MODULES.find((m) => m.id === id)!;
  const sel = MODULE_CAPS[id];
  const caps = data ? (sel === "all" ? data.capabilities : data.capabilities.filter((c) => sel.includes(c.id))) : [];
  const o = data?.onboarding;
  return (
    <>
      <Title eyebrow="Compliance" title={meta.label} subtitle={MODULE_INTRO[id]} onRefresh={load} />
      <Gate error={error} retry={load}>
        {!data ? (
          <p style={{ color: "var(--os-muted)" }}>Loading…</p>
        ) : (
          <>
            {id === "kyc" && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 16 }}>
                <Kpi label="Total users" value={fmt(data.users.total)} hint={data.users.unavailable ?? "All registered accounts"} />
                <Kpi label="Verified users" value={fmt(data.users.verified)} hint={data.users.unavailable ?? "Verified by the identity provider"} />
              </div>
            )}
            {(id === "kyb" || id === "aml") && o && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 16 }}>
                {id === "kyb" ? (
                  <>
                    <Kpi label="Cases" value={fmt(o.cases)} hint={`${o.submitted} submitted`} href="/ops/compliance/reviews?scope=all" />
                    <Kpi label="Awaiting review" value={fmt(o.pendingReview)} hint="Open in the review queue" href="/ops/compliance/cases" />
                    <Kpi label="Approved" value={fmt(o.approved)} hint={`${o.active} activated`} />
                  </>
                ) : (
                  <>
                    <Kpi label="Potential matches" value={fmt(o.screening.potentialMatch)} hint="Awaiting an officer's decision" href="/ops/compliance/cases" />
                    <Kpi label="Confirmed matches" value={fmt(o.screening.confirmedMatch)} hint="Onboarding blocked" />
                    <Kpi label="Screening unavailable" value={fmt(o.screening.failed)} hint="Never treated as clear" />
                  </>
                )}
              </div>
            )}
            {(id === "kyb" || id === "aml") && !o && <Notice tone="warn">{data.onboardingUnavailable}</Notice>}
            {id === "reports" ? (
              <ReportsPanel />
            ) : (
              <section className="os-card" style={{ padding: 18 }} aria-label="Capabilities">
                <h2>{id === "settings" ? "Providers and capabilities" : "Status"}</h2>
                <CapabilityList caps={caps} />
              </section>
            )}
            {id === "monitoring" && <MonitoringPanel />}
            {(id === "kyb" || id === "aml") && (
              <Link className="os-btn" href="/ops/compliance/cases" style={{ marginTop: 16 }}>
                Open review queue <ArrowRight size={15} />
              </Link>
            )}
          </>
        )}
      </Gate>
    </>
  );
}
