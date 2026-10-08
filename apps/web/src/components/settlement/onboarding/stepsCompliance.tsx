"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { BadgeCheck, ChevronRight, FileText, Globe2, Landmark, MapPin, RefreshCw, ScanSearch, ShieldCheck, Signature, SlidersHorizontal, UserRoundCheck, Users, X } from "lucide-react";
import { BLACK_LIST, FATF_UPDATED_AT, GREY_LIST } from "@/lib/compliance/fatfLists";
import { BUSINESS_TYPES, countryName, DOCUMENTS, type DocumentKind } from "@/lib/settlement/onboarding";
import { api, Badge, Notice } from "../os/primitives";
import type { OnboardingView } from "./types";
import type { StepProps } from "./OnboardingApp";
import { fileSize, Layout, nextStep, prevStep, ProgressCard, RailList, reviewLabel, reviewTone, StepActions, StepHeader } from "./shared";

type Tone = "green" | "amber" | "red" | "muted";
type Row = { id: string; icon: ReactNode; title: string; body: string; status: string; tone: Tone; onOpen: () => void };

const docStatus = (v: OnboardingView, kinds: DocumentKind[]): { status: string; tone: Tone } => {
  const docs = kinds.map((k) => v.state.documents.find((d) => d.kind === k));
  if (docs.some((d) => !d)) return { status: "Action Required", tone: "amber" };
  if (docs.some((d) => d!.review === "rejected")) return { status: "Failed", tone: "red" };
  if (docs.every((d) => d!.review === "approved")) return { status: "Verified", tone: "green" };
  return { status: "In Review", tone: "amber" };
};
const RISK_LABEL = { low: "Low Risk", medium: "Medium Risk", high: "High Risk", critical: "High Risk" } as const;
const RISK_TONE = { low: "green", medium: "amber", high: "red", critical: "red" } as const;

export function ComplianceStep(p: StepProps) {
  const v = p.view;
  const [busy, setBusy] = useState<"" | "screen" | "continue">("");
  const [error, setError] = useState("");
  const [policy, setPolicy] = useState<"limits" | "countries" | null>(null);
  const owners = v.state.details?.owners ?? [];
  const screening = v.state.screening;

  async function screen() {
    setBusy("screen");
    setError("");
    try {
      p.setView(await api<OnboardingView>("/api/settlement/onboarding", { method: "POST", body: JSON.stringify({ action: "screen" }) }));
      p.notify("Sanctions screening complete.");
    } catch (e) {
      // A failed screening is recorded server-side ("Screening unavailable"); show that state.
      const body = (e as { body?: OnboardingView }).body;
      if (body?.state) p.setView(body);
      setError(e instanceof Error ? e.message : "Screening could not run.");
    } finally {
      setBusy("");
    }
  }
  async function next() {
    setBusy("continue");
    setError("");
    try {
      p.setView(await api<OnboardingView>("/api/settlement/onboarding", { method: "POST", body: JSON.stringify({ action: "complete", step: "compliance" }) }));
      p.go(nextStep("compliance"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not continue.");
    } finally {
      setBusy("");
    }
  }

  const SCREENING_BADGE = {
    clear: ["Clear", "green"],
    cleared_by_review: ["Cleared by review", "green"],
    potential_match: ["In review", "amber"],
    confirmed_match: ["Blocked", "red"],
    failed: ["Screening unavailable", "red"],
  } as const;
  const biz = docStatus(v, ["incorporation", "articles"]);
  const addr = docStatus(v, ["address"]);
  const rows: Row[] = [
    { id: "identity", icon: <UserRoundCheck size={18} />, title: "Business Identity", body: "Legal entity verification and registration check", ...biz, onOpen: () => p.go("identity") },
    {
      id: "owners",
      icon: <Users size={18} />,
      title: "Beneficial Owners",
      body: "UBO declaration (≥ 25% ownership)",
      status: owners.length ? "In Review" : "Action Required",
      tone: "amber",
      onOpen: () => p.go("details"),
    },
    {
      id: "sanctions",
      icon: <ScanSearch size={18} />,
      title: "Sanctions Screening",
      body: screening ? `${screening.list} · ${screening.names} names screened` : "Screen the business, owners and representative",
      status: !screening ? "Pending" : SCREENING_BADGE[screening.status][0],
      tone: !screening ? "muted" : SCREENING_BADGE[screening.status][1],
      onOpen: () => void screen(),
    },
    { id: "travel", icon: <Signature size={18} />, title: "Travel Rule", body: "Originator and beneficiary data collected per transfer", status: "Pending", tone: "muted", onOpen: () => setPolicy("limits") },
    {
      id: "risk",
      icon: <ShieldCheck size={18} />,
      title: "Risk Assessment",
      body: "Country risk from the FATF lists",
      status: v.risk ? RISK_LABEL[v.risk.level] : "Pending",
      tone: v.risk ? RISK_TONE[v.risk.level] : "muted",
      onOpen: () => setPolicy("countries"),
    },
    { id: "address", icon: <MapPin size={18} />, title: "Address Verification", body: "Business address and proof of address", ...addr, onOpen: () => p.go("identity") },
  ];
  const level = v.risk?.level;
  const ring = level === "low" ? 0.25 : level === "medium" ? 0.5 : level ? 0.85 : 0;
  const businessType = BUSINESS_TYPES.find((t) => t.id === v.state.business?.type)?.label;

  return (
    <Layout
      main={
        <>
          <StepHeader step="compliance" title="Compliance & Risk" subtitle="We verify your business and screen for regulatory compliance to keep your account secure." />
          <div className="os-tiles" style={{ marginTop: 24 }}>
            {[
              { icon: <BadgeCheck size={18} />, t: "KYC / KYB Verification", s: "Identity and business checks" },
              { icon: <ScanSearch size={18} />, t: "Sanctions Screening", s: "OFAC SDN list" },
              { icon: <Signature size={18} />, t: "Travel Rule Compliance", s: "VASP & counterparty data" },
              { icon: <ShieldCheck size={18} />, t: "Risk Assessment", s: "Country risk (FATF)" },
            ].map((c) => (
              <div key={c.t} className="os-tile">
                <span className="os-icon-tile" style={{ width: 36, height: 36 }}>
                  {c.icon}
                </span>
                <strong>{c.t}</strong>
                <small>{c.s}</small>
              </div>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.6fr) minmax(220px,1fr)", gap: 16, marginTop: 20 }} className="os-split-cols">
            <section>
              <div className="os-section-head">
                <h2>Verification Status</h2>
                <button type="button" className="os-btn os-btn-sm" onClick={screen} disabled={!!busy}>
                  <RefreshCw size={14} className={busy === "screen" ? "os-spin" : undefined} /> {screening ? "Re-run screening" : "Run screening"}
                </button>
              </div>
              <div className="os-rows">
                {rows.map((r) => (
                  <button key={r.id} type="button" className="os-row" onClick={r.onOpen}>
                    <span className="os-icon-tile" style={{ width: 36, height: 36 }}>
                      {r.icon}
                    </span>
                    <span className="os-row-body">
                      <strong>{r.title}</strong>
                      <small>{r.body}</small>
                    </span>
                    <Badge tone={r.tone}>{r.status}</Badge>
                    <ChevronRight size={15} color="var(--os-faint)" />
                  </button>
                ))}
              </div>
              {screening?.status === "potential_match" && (
                <Notice tone="error">
                  Screening returned {screening.matches.length} potential match{screening.matches.length === 1 ? "" : "es"} ({screening.matches.map((m) => m.name).join(", ")}). FurlPay compliance reviews matches before an account can be activated.
                </Notice>
              )}
              {screening?.status === "failed" && <Notice tone="error">Screening unavailable. {screening.error ?? ""} Nothing was recorded as clear; run screening again.</Notice>}
              {screening?.status === "cleared_by_review" && <Notice tone="info">A FurlPay compliance officer reviewed the potential match and cleared it.</Notice>}
              {screening?.status === "confirmed_match" && <Notice tone="error">Screening confirmed a sanctions match. This account cannot be activated. Contact support if you believe this is wrong.</Notice>}
            </section>
            <section className="os-card" style={{ padding: 18, background: "var(--os-sunk)" }}>
              <h2 style={{ fontSize: 15, fontWeight: 600 }}>Risk Profile</h2>
              <div style={{ display: "grid", placeItems: "center", margin: "16px 0" }}>
                <svg viewBox="0 0 120 120" width="132" height="132" role="img" aria-label={level ? `Country risk ${RISK_LABEL[level]}` : "Risk pending assessment"}>
                  <circle cx="60" cy="60" r="50" fill="none" stroke="#1c2621" strokeWidth="10" />
                  {ring > 0 && <circle cx="60" cy="60" r="50" fill="none" stroke={level === "low" ? "var(--os-accent)" : level === "medium" ? "var(--os-amber)" : "var(--os-red)"} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${ring * 314} 314`} transform="rotate(-90 60 60)" />}
                  <text x="60" y="58" textAnchor="middle" fill="var(--os-text)" style={{ font: "600 15px Inter" }}>
                    {level ? RISK_LABEL[level].split(" ")[0] : "Pending"}
                  </text>
                  <text x="60" y="76" textAnchor="middle" fill="var(--os-muted)" style={{ font: "500 10px Inter" }}>
                    {level ? "country risk" : "assessment"}
                  </text>
                </svg>
              </div>
              <dl className="os-dl">
                <div>
                  <dt>Business Type</dt>
                  <dd>{businessType ?? "—"}</dd>
                </div>
                <div>
                  <dt>Industry</dt>
                  <dd>{v.state.business?.industry ?? "—"}</dd>
                </div>
                <div>
                  <dt>Country</dt>
                  <dd>{countryName(v.state.business?.country) || "—"}</dd>
                </div>
                <div>
                  <dt>FATF status</dt>
                  <dd>{v.risk ? v.risk.fatf : "—"}</dd>
                </div>
                <div>
                  <dt>Risk Score</dt>
                  <dd>Pending assessment</dd>
                </div>
                <div>
                  <dt>Last Updated</dt>
                  <dd>{screening ? new Date(screening.screenedAt).toLocaleString() : "—"}</dd>
                </div>
              </dl>
            </section>
          </div>

          <section className="os-section">
            <div className="os-section-head">
              <div>
                <h2>Compliance Policies</h2>
                <p>Limits and rules that apply to your account.</p>
              </div>
            </div>
            <div className="os-tiles" style={{ gridTemplateColumns: "repeat(3, minmax(0,1fr))" }}>
              {[
                { icon: <SlidersHorizontal size={18} />, t: "Transaction Limits", s: "Per-transaction limit for your jurisdiction", action: <button type="button" className="os-btn os-btn-sm os-btn-block" onClick={() => setPolicy("limits")}>Configure</button> },
                { icon: <Landmark size={18} />, t: "Approval Rules", s: "Set approval thresholds for payouts", action: <Link className="os-btn os-btn-sm os-btn-block" href="/settlement/payouts/approvals">Configure</Link> },
                { icon: <Globe2 size={18} />, t: "Allowed Countries", s: "Jurisdictions FurlPay can serve", action: <button type="button" className="os-btn os-btn-sm os-btn-block" onClick={() => setPolicy("countries")}>Configure</button> },
              ].map((c) => (
                <div key={c.t} className="os-tile" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span className="os-icon-tile" style={{ width: 36, height: 36 }}>
                    {c.icon}
                  </span>
                  <strong>{c.t}</strong>
                  <small style={{ flex: 1 }}>{c.s}</small>
                  <div style={{ marginTop: 10 }}>{c.action}</div>
                </div>
              ))}
            </div>
          </section>
          {error && <Notice tone="error">{error}</Notice>}
          <StepActions busy={busy === "continue" ? "continue" : busy ? "save" : ""} onBack={() => p.go(prevStep("compliance"))} onContinue={next} />
          {policy && <PolicyDrawer kind={policy} view={v} onClose={() => setPolicy(null)} />}
        </>
      }
      rail={
        <>
          <ProgressCard view={v} />
          <RailList
            title="Why we verify businesses"
            intro="Financial regulation requires us to know who we work with before money moves."
            items={[
              { icon: <ScanSearch size={20} />, title: "Sanctions screening", body: "Names are screened against the OFAC SDN list. Screening re-runs when ownership or names change." },
              { icon: <Globe2 size={20} />, title: "Country risk", body: `Jurisdiction rules follow the FATF black and grey lists (updated ${FATF_UPDATED_AT}).` },
              { icon: <Users size={20} />, title: "Beneficial ownership", body: "Everyone who owns 25% or more must be declared." },
              { icon: <ShieldCheck size={20} />, title: "Human review", body: "Documents and potential matches are reviewed by FurlPay compliance." },
            ]}
          />
          <section className="os-card">
            <div className="os-section-head" style={{ marginBottom: 6 }}>
              <h2>Documents Submitted</h2>
              <button type="button" className="os-link" style={{ background: "none", border: 0 }} onClick={() => p.go("identity")}>
                View all
              </button>
            </div>
            {v.state.documents.length === 0 ? (
              <p className="os-rail-sub">No documents uploaded yet.</p>
            ) : (
              <ul className="os-list">
                {v.state.documents.map((d) => (
                  <li key={d.id}>
                    <span className="os-icon-tile">
                      <FileText size={18} />
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <strong>{DOCUMENTS[d.kind].label}</strong>
                      <small>
                        {d.contentType === "application/pdf" ? "PDF" : d.contentType === "image/png" ? "PNG" : "JPG"} · {fileSize(d.size)} · {new Date(d.uploadedAt).toLocaleDateString()}
                      </small>
                    </span>
                    <Badge tone={reviewTone(d.review)}>{reviewLabel(d.review)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      }
    />
  );
}

function PolicyDrawer({ kind, view, onClose }: { kind: "limits" | "countries"; view: OnboardingView; onClose: () => void }) {
  const rule = view.risk?.rule;
  return (
    <>
      <button className="os-backdrop" aria-label="Close" onClick={onClose} />
      <div className="os-drawer" role="dialog" aria-modal="true" aria-label={kind === "limits" ? "Transaction limits" : "Allowed countries"}>
        <div className="os-drawer-head">
          <h2>{kind === "limits" ? "Transaction limits" : "Allowed countries"}</h2>
          <button className="os-icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        {kind === "limits" ? (
          rule ? (
            <>
              <p style={{ color: "var(--os-muted)" }}>Set by FurlPay compliance for {countryName(rule.country)}. Limits are enforced on the server for every payment.</p>
              <dl className="os-dl">
                <div>
                  <dt>Per-transaction limit</dt>
                  <dd className="mono">{rule.maxTransactionUSD > 0 ? `$${rule.maxTransactionUSD.toLocaleString("en-US")}` : "Blocked"}</dd>
                </div>
                <div>
                  <dt>Enhanced due diligence</dt>
                  <dd>{rule.eddRequired ? "Required" : "Not required"}</dd>
                </div>
                <div>
                  <dt>Required checks</dt>
                  <dd>{rule.requiredChecks.join(", ") || "—"}</dd>
                </div>
                <div>
                  <dt>Travel Rule</dt>
                  <dd>Originator and beneficiary data collected per transfer</dd>
                </div>
              </dl>
              <p style={{ marginTop: 14, color: "var(--os-faint)", fontSize: 12 }}>{rule.notes}</p>
            </>
          ) : (
            <Notice tone="info">Choose your country of incorporation in Business Information to see the limits that apply.</Notice>
          )
        ) : (
          <>
            <p style={{ color: "var(--os-muted)" }}>FurlPay cannot serve FATF black-listed jurisdictions. Grey-listed jurisdictions require enhanced due diligence. Lists updated {FATF_UPDATED_AT}.</p>
            <h3 style={{ marginTop: 18, fontSize: 14 }}>Blocked ({BLACK_LIST.size})</h3>
            <p className="mono" style={{ color: "var(--os-red)", marginTop: 6 }}>{[...BLACK_LIST].join(" · ")}</p>
            <h3 style={{ marginTop: 18, fontSize: 14 }}>Enhanced due diligence ({GREY_LIST.size})</h3>
            <p className="mono" style={{ color: "var(--os-amber)", marginTop: 6, lineHeight: 1.8 }}>{[...GREY_LIST].join(" · ")}</p>
          </>
        )}
      </div>
    </>
  );
}
