"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, FileText, RefreshCw, ShieldAlert, XCircle } from "lucide-react";
import { BLOCKER_LABEL, countryName, DOCUMENTS, type DocumentRecord } from "@/lib/settlement/onboarding";
import { api, Badge, Notice } from "../os/primitives";
import Header from "../os/Header";
import type { OnboardingView } from "../onboarding/types";

// Compliance officer workspace for business onboarding cases. Every action
// here is authorised and audited server-side (/api/settlement/onboarding/review);
// this page only renders what the server returns.

type CaseSummary = {
  ownerId: string;
  business: { legalName: string; country: string; type: string } | null;
  review: string;
  submittedAt: string | null;
  screening: string;
  documents: { total: number; approved: number; rejected: number };
  activation: string;
  updatedAt: string;
  self: boolean;
};
type CaseDetail = OnboardingView & { ownerId: string; self?: boolean; applicant: { name: string; kycStatus: string } };
type Action = "approve_document" | "reject_document" | "clear_screening" | "confirm_match" | "approve_case" | "reject_case" | "request_changes";

const TONE: Record<string, "green" | "amber" | "red" | "muted"> = { approved: "green", clear: "green", cleared_by_review: "green", pending: "amber", potential_match: "amber", changes_requested: "amber", rejected: "red", confirmed_match: "red", failed: "red" };
const label = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : "—");

export default function ReviewQueue() {
  const [scope, setScope] = useState<"open" | "all">("open");
  const [query, setQuery] = useState("");
  const [screeningFilter, setScreeningFilter] = useState("");
  const [cases, setCases] = useState<CaseSummary[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [denied, setDenied] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const r = await api<{ cases: CaseSummary[] }>(`/api/settlement/onboarding/review?scope=${scope}`);
      setCases(r.cases);
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 401 || status === 403) setDenied("This workspace is limited to FurlPay compliance officers.");
      else setError(e instanceof Error ? e.message : "Review queue unavailable.");
      setCases([]);
    }
  }, [scope]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selected) return setDetail(null);
    const ac = new AbortController();
    setDetail(null);
    api<CaseDetail>(`/api/settlement/onboarding/review?owner=${encodeURIComponent(selected)}`, { signal: ac.signal })
      .then((r) => { if (!ac.signal.aborted) setDetail(r); })
      .catch((e) => { if (!ac.signal.aborted) setError(e instanceof Error ? e.message : "Case unavailable."); });
    return () => ac.abort();
  }, [selected]);

  async function decide(action: Action, documentId?: string) {
    if (!detail || busy) return;
    setBusy(action + (documentId ?? ""));
    setError("");
    try {
      const next = await api<CaseDetail>("/api/settlement/onboarding/review", {
        method: "POST",
        body: JSON.stringify({ action, owner: detail.ownerId, ...(documentId ? { documentId } : {}), ...(reason.trim() ? { reason: reason.trim() } : {}) }),
      });
      setDetail(next);
      setReason("");
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The decision was not recorded.");
    } finally {
      setBusy("");
    }
  }

  if (denied) {
    return (
      <main className="os os-main" style={{ padding: 24 }}>
        <Notice tone="error" icon={<ShieldAlert size={16} />}>
          {denied}
        </Notice>
      </main>
    );
  }

  const st = detail?.state;
  const visible = cases?.filter((c) => (!screeningFilter || c.screening === screeningFilter) && [c.ownerId, c.business?.legalName, c.business?.country, countryName(c.business?.country), c.review, c.screening].join(" ").toLowerCase().includes(query.toLowerCase()));
  const readOnly = Boolean(detail?.self) || st?.activation.status === "ACTIVE";

  return (
    <main className="os" style={{ minHeight: "100vh" }}>
      <Header />
      <div className="os-main" style={{ padding: "24px 16px", maxWidth: 1320, margin: "0 auto" }}>
        <div className="os-section-head">
          <div>
            <p className="os-eyebrow">Compliance</p>
            <h1 className="os-title">Onboarding reviews</h1>
            <p className="os-subtitle">Review business documents and screening results. Decisions are recorded with your identity, the time and your reason.</p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <select className="os-select" aria-label="Queue scope" value={scope} onChange={(e) => setScope(e.target.value as "open" | "all")} style={{ height: 36 }}>
              <option value="open">Needs review</option>
              <option value="all">All cases</option>
            </select>
            <button type="button" className="os-btn os-btn-sm" onClick={() => void load()}>
              <RefreshCw size={14} /> Refresh
            </button>
          </div>
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        <div className="st-table-tools" style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 16 }}><input className="os-input" aria-label="Search review cases" placeholder="Business, country, case ID or status" value={query} onChange={(e) => setQuery(e.target.value)} /><select className="os-select" aria-label="Screening status filter" value={screeningFilter} onChange={(e) => setScreeningFilter(e.target.value)}><option value="">All screening statuses</option>{["not_run", "clear", "potential_match", "cleared_by_review", "confirmed_match", "failed"].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 360px) minmax(0, 1fr)", gap: 16, marginTop: 16 }} className="os-split-cols">
          <section className="os-card" style={{ padding: 0, overflow: "hidden" }} aria-label="Cases">
            {cases === null ? (
              <p style={{ padding: 16, color: "var(--os-muted)" }}>Loading…</p>
            ) : visible?.length === 0 ? (
              <p style={{ padding: 16, color: "var(--os-muted)" }}>No cases {scope === "open" ? "awaiting review" : "recorded"}.</p>
            ) : (
              <div className="os-rows" style={{ gap: 0 }}>
                {visible?.map((c) => (
                  <button key={c.ownerId} type="button" className="os-row" aria-current={selected === c.ownerId} onClick={() => setSelected(c.ownerId)} style={{ borderRadius: 0, borderWidth: "0 0 1px", background: selected === c.ownerId ? "var(--os-sunk)" : undefined }}>
                    <span className="os-row-body">
                      <strong>{c.business?.legalName ?? "Unnamed business"}</strong>
                      <small>
                        {countryName(c.business?.country) || "—"} · submitted {when(c.submittedAt)}
                        {c.self ? " · your own case" : ""}
                      </small>
                    </span>
                    <Badge tone={TONE[c.review] ?? "muted"}>{label(c.review)}</Badge>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="os-card os-review-detail" style={{ padding: 20, minWidth: 0 }} aria-label="Case detail">
            {!selected ? (
              <p style={{ color: "var(--os-muted)" }}>Select a case.</p>
            ) : !detail || !st ? (
              <p style={{ color: "var(--os-muted)" }}>Loading case…</p>
            ) : (
              <>
                <div className="os-section-head">
                  <div>
                    <h2>{st.business?.legalName ?? "Unnamed business"}</h2>
                    <small style={{ color: "var(--os-muted)" }}>
                      Applicant {detail.applicant.name} · identity verification: {label(detail.applicant.kycStatus)} · review: {label(st.review?.status ?? "not_submitted")}
                    </small>
                  </div>
                  <Badge tone={TONE[st.review?.status ?? ""] ?? "muted"}>{label(st.review?.status ?? "not_submitted")}</Badge>
                </div>
                {detail.self && <Notice tone="warn">This is your own onboarding case. Another compliance officer must review it.</Notice>}
                {st.activation.status === "ACTIVE" && <Notice tone="info">This account is active. Decisions are closed.</Notice>}

                <h3 className="os-review-h">Business</h3>
                <dl className="os-dl">
                  <div><dt>Legal name</dt><dd>{st.business?.legalName ?? "—"}</dd></div>
                  <div><dt>Trading name</dt><dd>{st.business?.tradingName ?? "—"}</dd></div>
                  <div><dt>Country</dt><dd>{countryName(st.business?.country) || "—"}{detail.risk ? ` · FATF ${detail.risk.fatf}` : ""}</dd></div>
                  <div><dt>Registration number</dt><dd className="mono">{st.business?.registrationNumber ?? "—"}</dd></div>
                  <div><dt>Representative</dt><dd>{st.identity?.representative.fullName ?? "—"}</dd></div>
                  <div><dt>Beneficial owners</dt><dd>{st.details?.owners.map((o) => `${o.name} (${o.percent}%)`).join(", ") || "—"}</dd></div>
                </dl>

                <h3 className="os-review-h">Sanctions screening</h3>
                {!st.screening ? (
                  <p style={{ color: "var(--os-muted)" }}>Not run.</p>
                ) : (
                  <>
                    <p>
                      <Badge tone={TONE[st.screening.status] ?? "muted"}>{label(st.screening.status)}</Badge>{" "}
                      <small style={{ color: "var(--os-muted)" }}>
                        {st.screening.list} · {st.screening.names} names · {when(st.screening.screenedAt)}
                      </small>
                    </p>
                    {st.screening.matches.length > 0 && (
                      <ul style={{ margin: "8px 0", paddingLeft: 18 }}>
                        {st.screening.matches.map((m, i) => (
                          <li key={i}>
                            {m.name} — score {Math.round(m.score * 100)}% · {m.source}
                          </li>
                        ))}
                      </ul>
                    )}
                    {st.screening.review && (
                      <small style={{ color: "var(--os-muted)" }}>
                        Decided by {st.screening.review.by} at {when(st.screening.review.at)}: {st.screening.review.reason}
                      </small>
                    )}
                    {st.screening.status === "potential_match" && !readOnly && (
                      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                        <button type="button" className="os-btn os-btn-sm" disabled={!!busy} onClick={() => decide("clear_screening")}>
                          <CheckCircle2 size={14} /> Clear as false positive
                        </button>
                        <button type="button" className="os-btn os-btn-sm" style={{ color: "var(--os-red)" }} disabled={!!busy} onClick={() => decide("confirm_match")}>
                          <XCircle size={14} /> Confirm match
                        </button>
                      </div>
                    )}
                  </>
                )}

                <h3 className="os-review-h">Documents</h3>
                {st.documents.length === 0 ? (
                  <p style={{ color: "var(--os-muted)" }}>No documents uploaded.</p>
                ) : (
                  <div className="os-rows">
                    {st.documents.map((d: DocumentRecord) => (
                      <div key={d.id} className="os-row" style={{ cursor: "default" }}>
                        <FileText size={18} color="var(--os-accent)" />
                        <span className="os-row-body">
                          <strong>{DOCUMENTS[d.kind].label}</strong>
                          <small>
                            {d.contentType} · {(d.size / 1024).toFixed(0)} KB · uploaded {when(d.uploadedAt)}
                            {d.reviewedBy ? ` · ${label(d.review)} by ${d.reviewedBy}${d.reviewReason ? `: ${d.reviewReason}` : ""}` : ""}
                          </small>
                        </span>
                        <Badge tone={TONE[d.review] ?? "muted"}>{label(d.review)}</Badge>
                        {!detail.self && (
                          <a className="os-btn os-btn-sm" href={`/api/settlement/onboarding/review/document?owner=${encodeURIComponent(detail.ownerId)}&id=${d.id}`} target="_blank" rel="noopener noreferrer">
                            <ExternalLink size={14} /> Open
                          </a>
                        )}
                        {!readOnly && (
                          <>
                            <button type="button" className="os-btn os-btn-sm" disabled={!!busy || d.review === "approved"} onClick={() => decide("approve_document", d.id)}>
                              Approve
                            </button>
                            <button type="button" className="os-btn os-btn-sm" disabled={!!busy || d.review === "rejected"} onClick={() => decide("reject_document", d.id)}>
                              Reject
                            </button>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <h3 className="os-review-h">Activation gates (applicant view)</h3>
                <ul className="os-list">
                  {detail.readiness.blockers.length === 0 ? <li>All gates met.</li> : detail.readiness.blockers.map((b) => <li key={b}>{BLOCKER_LABEL[b]}</li>)}
                </ul>

                {!readOnly && (
                  <>
                    <h3 className="os-review-h">Decision</h3>
                    <label className="os-field">
                      <span>Reason (required for rejections, change requests and screening decisions)</span>
                      <textarea className="os-textarea" rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
                    </label>
                    <div className="os-actions">
                      <button type="button" className="os-btn" disabled={!!busy} onClick={() => decide("request_changes")}>
                        Request changes
                      </button>
                      <button type="button" className="os-btn" style={{ color: "var(--os-red)" }} disabled={!!busy} onClick={() => decide("reject_case")}>
                        Reject
                      </button>
                      <button type="button" className="os-btn os-btn-primary" disabled={!!busy} onClick={() => decide("approve_case")}>
                        Approve case
                      </button>
                    </div>
                  </>
                )}

                {(st.review?.history.length ?? 0) > 0 && (
                  <>
                    <h3 className="os-review-h">History</h3>
                    <ol className="os-list" style={{ listStyle: "none" }}>
                      {[...(st.review?.history ?? [])].reverse().map((h, i) => (
                        <li key={i}>
                          <span>
                            <strong>{label(h.action)}{h.target ? ` · ${h.target}` : ""}</strong>
                            <small>
                              {when(h.at)} · {h.by}
                              {h.reason ? ` — ${h.reason}` : ""}
                            </small>
                          </span>
                        </li>
                      ))}
                    </ol>
                  </>
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
