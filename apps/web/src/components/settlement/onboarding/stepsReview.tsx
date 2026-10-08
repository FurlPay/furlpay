"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, BadgeCheck, CheckCircle2, CircleAlert, CircleDashed, CircleX, Minus, FileText, Lock, MessageSquare, ShieldCheck, UserRoundCheck, Wallet } from "lucide-react";
import { BLOCKER_LABEL, BUSINESS_TYPES, countryName, DOCUMENTS, type Check, type StepId } from "@/lib/settlement/onboarding";
import { api, AssetLogo, Badge, ChainLogo, chainName, Notice } from "../os/primitives";
import type { OnboardingView } from "./types";
import type { StepProps } from "./OnboardingApp";
import { Layout, ProgressCard, reviewLabel, reviewTone, StepHeader } from "./shared";

function Section({ title, edit, go, children }: { title: string; edit: StepId; go: (s: StepId) => void; children: ReactNode }) {
  return (
    <section className="os-card" style={{ marginTop: 16, padding: 18, background: "var(--os-sunk)" }}>
      <div className="os-section-head" style={{ marginBottom: 12 }}>
        <h2>{title}</h2>
        <button type="button" className="os-btn os-btn-sm" style={{ color: "var(--os-accent)", borderColor: "#00c88855" }} onClick={() => go(edit)}>
          Edit
        </button>
      </div>
      {children}
    </section>
  );
}

/** Preflight status glyphs: ✓ complete, ⚠ pending, ✕ blocked, — not configured. */
const CHECK_ICON: Record<Check["status"], { icon: ReactNode; color: string; label: string }> = {
  complete: { icon: <CheckCircle2 size={18} />, color: "var(--os-accent)", label: "Complete" },
  pending: { icon: <CircleDashed size={18} />, color: "var(--os-amber)", label: "Pending" },
  blocked: { icon: <CircleX size={18} />, color: "var(--os-red)", label: "Blocked" },
  not_configured: { icon: <Minus size={18} />, color: "var(--os-faint)", label: "Not configured" },
};

const SCREENING_LABEL = { clear: "Clear", cleared_by_review: "Cleared by compliance review", potential_match: "Potential match — in review", confirmed_match: "Blocked", failed: "Screening unavailable" } as const;
const REVIEW_LABEL = { not_submitted: "Not submitted", pending: "Awaiting compliance review", approved: "Approved", rejected: "Rejected", changes_requested: "Changes requested" } as const;

const MODEL = { treasury: "FurlPay Treasury", virtual_account: "Virtual Account", split: "Custom Split" } as const;
const fmtDate = (iso?: string) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—");

/** One concise line: the first blocker, plus how many more. */
function activateReason(codes: readonly (keyof typeof BLOCKER_LABEL)[]) {
  if (!codes.length) return "";
  return codes.length === 1 ? BLOCKER_LABEL[codes[0]] : `${BLOCKER_LABEL[codes[0]]} (+${codes.length - 1} more)`;
}

export function ReviewStep(p: StepProps) {
  const router = useRouter();
  const v = p.view;
  const st = v.state;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = st.activation.status === "ACTIVE";
  const b = st.business;
  const kyb = st.documents.filter((d) => ["incorporation", "articles", "address"].includes(d.kind));
  const kybStatus = kyb.length === 3 && kyb.every((d) => d.review === "approved") ? "Verified" : kyb.length ? "In review" : "Not submitted";

  async function activate() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const next = await api<OnboardingView>("/api/settlement/onboarding", { method: "POST", body: JSON.stringify({ action: "activate" }) });
      p.setView(next);
      if (next.state.activation.status === "ACTIVE") {
        p.notify("Your FurlPay account is active.");
        router.push("/settlement");
      }
    } catch (e) {
      const body = (e as { body?: OnboardingView }).body;
      if (body?.state) p.setView(body);
      setError(e instanceof Error ? e.message : "Activation failed. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Layout
      main={
        <>
          <StepHeader step="review" title="Review & Activate" subtitle="Review your setup and activate your FurlPay account." />
          <Section title="Business Profile" edit="business" go={p.go}>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.2fr) repeat(2, minmax(0,1fr))", gap: 16, alignItems: "center" }} className="os-review-grid">
              <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                <span className="os-avatar" style={{ width: 56, height: 56, borderRadius: 12, fontSize: 20 }}>
                  {(b?.legalName ?? "·").split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase()}
                </span>
                <span>
                  <strong style={{ fontSize: 16, display: "block" }}>{b?.legalName ?? "—"}</strong>
                  <small style={{ color: "var(--os-muted)" }}>
                    {b?.industry ?? "—"} · {countryName(b?.country) || "—"}
                  </small>
                </span>
              </div>
              <dl className="os-dl" style={{ margin: 0 }}>
                <div>
                  <dt>Legal Name</dt>
                  <dd>{b?.legalName ?? "—"}</dd>
                </div>
                <div>
                  <dt>Trading Name</dt>
                  <dd>{b?.tradingName ?? "—"}</dd>
                </div>
              </dl>
              <dl className="os-dl" style={{ margin: 0 }}>
                <div>
                  <dt>Date of Incorporation</dt>
                  <dd>{fmtDate(st.details?.incorporationDate)}</dd>
                </div>
                <div>
                  <dt>Entity Type</dt>
                  <dd>{BUSINESS_TYPES.find((t) => t.id === b?.type)?.label ?? "—"}</dd>
                </div>
              </dl>
            </div>
          </Section>

          <Section title="Verification Status" edit="identity" go={p.go}>
            <div className="os-tiles" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px,1fr))" }}>
              {[
                { icon: <ShieldCheck size={18} />, t: "Business Verification (KYB)", s: kybStatus, ok: kybStatus === "Verified" },
                { icon: <UserRoundCheck size={18} />, t: "Identity Verification (KYC)", s: v.facts.kycStatus === "verified" ? "Verified" : v.facts.kycStatus, ok: v.facts.kycStatus === "verified" },
                { icon: <BadgeCheck size={18} />, t: "Sanctions Screening", s: st.screening ? SCREENING_LABEL[st.screening.status] : "Not screened", ok: st.screening?.status === "clear" || st.screening?.status === "cleared_by_review" },
                { icon: <ShieldCheck size={18} />, t: "Compliance Review", s: REVIEW_LABEL[st.review?.status ?? "not_submitted"], ok: st.review?.status === "approved" },
              ].map((x) => (
                <div key={x.t} className="os-tile" style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <span className="os-icon-tile">{x.icon}</span>
                  <span>
                    <strong style={{ marginTop: 0 }}>{x.t}</strong>
                    <small style={{ color: x.ok ? "var(--os-accent)" : "var(--os-amber)", textTransform: "capitalize" }}>{x.s}</small>
                  </span>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Treasury & Wallets" edit="treasury" go={p.go}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 16 }} className="os-review-grid">
              <div>
                <small style={{ color: "var(--os-muted)" }}>Enabled Networks</small>
                <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                  {(st.treasury?.networks ?? []).map((n) => (
                    <span key={n} title={chainName(n)}>
                      <ChainLogo chain={n} size={26} />
                    </span>
                  ))}
                </div>
                <small style={{ display: "block", marginTop: 8, color: "var(--os-muted)" }}>{st.treasury?.networks.length ?? 0} networks enabled</small>
              </div>
              <div>
                <small style={{ color: "var(--os-muted)" }}>Supported Assets</small>
                <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                  {(st.treasury?.assets ?? []).map((a) => (
                    <span key={a} style={{ display: "grid", justifyItems: "center", gap: 4, fontSize: 11 }}>
                      <AssetLogo asset={a} size={26} />
                      {a}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <small style={{ color: "var(--os-muted)" }}>Default Account</small>
                <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10 }}>
                  <span className="os-icon-tile">
                    <Wallet size={18} />
                  </span>
                  <span>
                    <strong style={{ display: "block" }}>{st.treasury ? MODEL[st.treasury.destination] : "—"}</strong>
                    <small style={{ color: "var(--os-muted)" }}>Default settlement destination</small>
                  </span>
                </div>
              </div>
            </div>
          </Section>

          <Section title="Settlement Configuration" edit="settlement" go={p.go}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 16 }} className="os-review-grid">
              <div>
                <small style={{ color: "var(--os-muted)" }}>Settlement Model</small>
                <strong style={{ display: "block", marginTop: 8 }}>{st.settlement ? MODEL[st.settlement.model] : "—"}</strong>
                {st.settlement && (
                  <span style={{ display: "inline-block", marginTop: 8 }}>
                    <Badge tone="muted">Configured — not executing</Badge>
                  </span>
                )}
              </div>
              <div>
                <small style={{ color: "var(--os-muted)" }}>Split Rules</small>
                <ul style={{ margin: "8px 0 0", padding: 0, listStyle: "none", display: "grid", gap: 6 }}>
                  {(st.settlement?.rules ?? []).map((r) => (
                    <li key={r.id} className="mono" style={{ fontSize: 12.5 }}>
                      {r.percent}% → {r.label}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <small style={{ color: "var(--os-muted)" }}>Preferences</small>
                <dl className="os-dl" style={{ margin: "6px 0 0" }}>
                  {st.settlement &&
                    (
                      [
                        ["Auto conversion", st.settlement.preferences.autoConversion],
                        ["Network optimization", st.settlement.preferences.networkOptimization],
                        ["Compliance checks", st.settlement.preferences.complianceChecks],
                      ] as const
                    ).map(([k, on]) => (
                      <div key={k}>
                        <dt>{k}</dt>
                        <dd style={{ color: on ? "var(--os-accent)" : "var(--os-muted)" }}>{on ? "Enabled" : "Off"}</dd>
                      </div>
                    ))}
                </dl>
              </div>
            </div>
          </Section>

          <Section title="Documents & Policies" edit="identity" go={p.go}>
            <div className="os-tiles">
              {(["incorporation", "articles", "license", "address"] as const).map((k) => {
                const d = st.documents.find((x) => x.kind === k);
                return (
                  <div key={k} className="os-tile" style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <FileText size={18} color="var(--os-accent)" />
                    <span style={{ minWidth: 0 }}>
                      <strong style={{ marginTop: 0, fontSize: 12 }}>{DOCUMENTS[k].label}</strong>
                      {d ? <Badge tone={reviewTone(d.review)}>{reviewLabel(d.review)}</Badge> : <small>{DOCUMENTS[k].required ? "Not uploaded" : "Optional"}</small>}
                    </span>
                  </div>
                );
              })}
            </div>
          </Section>

          {st.activation.status === "REQUIRES_ACTION" && st.activation.blockers && (
            <Notice tone="warn" icon={<CircleAlert size={16} />}>
              <strong>Activation needs attention</strong>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {st.activation.blockers.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </Notice>
          )}
          {error && <Notice tone="error">{error}</Notice>}
          <div className="os-actions">
            <button type="button" className="os-btn" onClick={() => p.go("settlement")} disabled={busy}>
              <ArrowLeft size={16} /> Back
            </button>
            {!active && !v.readiness.ready && (
              <small style={{ color: "var(--os-amber)", alignSelf: "center", marginLeft: "auto", marginRight: 12, textAlign: "right" }} data-testid="activate-reason">
                {activateReason(v.readiness.blockers)}
              </small>
            )}
            {active ? (
              <Link className="os-btn os-btn-primary" href="/settlement">
                Go to Settlement Overview <ArrowRight size={16} />
              </Link>
            ) : (
              <button type="button" className="os-btn os-btn-primary" onClick={activate} disabled={busy || !v.readiness.ready} aria-busy={busy} title={v.readiness.ready ? undefined : activateReason(v.readiness.blockers)}>
                {busy ? "Activating…" : "Activate Account"} <ArrowRight size={16} />
              </button>
            )}
          </div>
          <p style={{ marginTop: 12, textAlign: "center", color: "var(--os-faint)", fontSize: 12 }}>
            <Lock size={12} style={{ display: "inline", verticalAlign: -1, marginRight: 4 }} />By activating, you agree to our{" "}
            <Link className="os-link" href="/terms">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link className="os-link" href="/privacy">
              Privacy Policy
            </Link>
            .
          </p>
        </>
      }
      rail={
        <>
          <ProgressCard view={v} />
          <section className="os-card">
            <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
              <span className="os-icon-tile" style={{ width: 56, height: 56, borderRadius: "50%", color: v.readiness.ready || active ? "var(--os-accent)" : "var(--os-amber)" }}>
                {v.readiness.ready || active ? <CheckCircle2 size={28} /> : <CircleAlert size={28} />}
              </span>
              <span>
                <h2>{active ? "Account active" : v.readiness.ready ? "Account Ready to Activate" : "Not ready to activate yet"}</h2>
                <small style={{ color: v.readiness.ready || active ? "var(--os-accent)" : "var(--os-amber)" }}>
                  {active ? `Activated ${new Date(st.activation.at!).toLocaleString()}` : v.readiness.ready ? "Everything looks good." : ((n) => `${n} item${n === 1 ? "" : "s"} outstanding`)(v.readiness.checks.filter((c) => !c.met).length)}
                </small>
              </span>
            </div>
            <ul className="os-list" style={{ gap: 12 }}>
              {v.readiness.checks.map((c) => (
                <li key={c.id}>
                  <span style={{ flex: "none", marginTop: 2, color: CHECK_ICON[c.status].color, display: "inline-flex" }} aria-label={CHECK_ICON[c.status].label} title={CHECK_ICON[c.status].label}>
                    {CHECK_ICON[c.status].icon}
                  </span>
                  <span>
                    <strong style={{ fontWeight: 500 }}>
                      {c.label} <span style={{ color: CHECK_ICON[c.status].color, fontWeight: 400, fontSize: 12 }}>· {CHECK_ICON[c.status].label}</span>
                    </strong>
                    <small>{c.detail}</small>
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <section className="os-card">
            <h2>What happens next?</h2>
            <ol className="os-list" style={{ listStyle: "none" }}>
              {[
                ["Compliance review", "A FurlPay compliance officer reviews your documents and screening result."],
                ["Account activation", "Activation is confirmed by the server once every check above is met."],
                ["Settlement rules", "Your rules are saved as configuration. Automatic settlement execution is not enabled yet."],
                ["Use the full workspace", "Payments, treasury, reconciliation and reports."],
              ].map(([t, s], i) => (
                <li key={t}>
                  <span className="os-num" style={{ margin: 0 }}>
                    {i + 1}
                  </span>
                  <span>
                    <strong>{t}</strong>
                    <small>{s}</small>
                  </span>
                </li>
              ))}
            </ol>
          </section>
          <section className="os-card">
            <div className="os-help-head">
              <span className="os-icon-tile">
                <MessageSquare size={20} />
              </span>
              <span>
                <strong>Need assistance?</strong>
                <small>Our onboarding team is here to help you get started.</small>
              </span>
            </div>
            <Link className="os-btn os-btn-block" href="/support">
              Chat with Onboarding Team
            </Link>
          </section>
        </>
      }
    />
  );
}
