"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, Play, RefreshCw, ShieldAlert } from "lucide-react";
import { api, Badge, Notice } from "@/components/settlement/os/primitives";
import { CASE_TYPES, SEVERITIES, type CaseAction, type ComplianceCase } from "@/lib/compliance/cases";
import type { MonitoringAlert, MonitoringRule } from "@/lib/compliance/monitoring";
import { REPORT_LABEL, REPORT_TYPES } from "@/lib/compliance/reports";
import type { ScreeningRecord } from "@/lib/compliance/screeningHistory";

// Case queue, monitoring and reports. Every action calls the server, which
// enforces the role, the state machine and the audit log; this UI renders only
// what the server returns and offers only the actions it says are allowed.

type Row = Omit<ComplianceCase, "events"> & { eventCount: number; sla: string; self: boolean };
type Detail = { case: ComplianceCase; sla: string; allowed: CaseAction[]; self: boolean; linked: Record<string, any> | null };
type Err = { message: string; status?: number } | null;

const SEV_TONE = { low: "muted", medium: "amber", high: "red", critical: "red" } as const;
const SLA_TONE: Record<string, "green" | "amber" | "red" | "muted"> = { met: "green", on_track: "muted", due_soon: "amber", overdue: "red" };
const label = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : "—");
const errOf = (e: unknown): Err => ({ message: e instanceof Error ? e.message : "Request failed", status: (e as { status?: number }).status });

function Denied({ err, retry }: { err: Err; retry: () => void }) {
  if (!err) return null;
  if (err.status === 401 || err.status === 403)
    return (
      <Notice tone="error" icon={<ShieldAlert size={16} />}>
        This workspace is limited to FurlPay compliance officers.
      </Notice>
    );
  return (
    <Notice tone="error">
      {err.message}{" "}
      <button type="button" className="os-link" onClick={retry}>
        Retry
      </button>
    </Notice>
  );
}

const ACTION_LABEL: Record<CaseAction, string> = { triage: "Triage", assign: "Assign", start: "Start investigation", escalate: "Escalate", request_decision: "Request decision", resolve: "Resolve", close: "Close", reopen: "Reopen", note: "Add note" };
const NEEDS_REASON: CaseAction[] = ["escalate", "resolve", "close", "reopen", "note"];

export function CaseQueue() {
  const [filter, setFilter] = useState({ status: "open", type: "", severity: "", assignee: "", overdue: false });
  const [rows, setRows] = useState<Row[] | null>(null);
  const [sync, setSync] = useState<{ opened?: number; resolved?: number; error?: string } | null>(null);
  const [err, setErr] = useState<Err>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [form, setForm] = useState({ reason: "", assignee: "", resolution: "no_action", severity: "" });
  const [busy, setBusy] = useState("");
  const [actErr, setActErr] = useState("");

  const load = useCallback(async () => {
    setErr(null);
    const q = new URLSearchParams({ status: filter.status });
    if (filter.type) q.set("type", filter.type);
    if (filter.severity) q.set("severity", filter.severity);
    if (filter.assignee) q.set("assignee", filter.assignee);
    if (filter.overdue) q.set("overdue", "1");
    try {
      const r = await api<{ cases: Row[]; sync: typeof sync }>(`/api/compliance/cases?${q}`);
      setRows(r.cases);
      setSync(r.sync);
    } catch (e) {
      setErr(errOf(e));
      setRows([]);
    }
  }, [filter]);
  useEffect(() => {
    void load();
  }, [load]);
  const open = useCallback(async (id: string) => {
    setSel(id);
    setDetail(null);
    setActErr("");
    try {
      setDetail(await api<Detail>(`/api/compliance/cases/${id}`));
    } catch (e) {
      setActErr(errOf(e)?.message ?? "Case unavailable");
    }
  }, []);

  async function act(action: CaseAction) {
    if (!detail || busy) return;
    setBusy(action);
    setActErr("");
    const body: Record<string, unknown> = { action };
    if (form.reason.trim()) body.reason = form.reason.trim();
    if (action === "assign") body.assignee = form.assignee.trim();
    if (action === "resolve") body.resolution = form.resolution;
    if (action === "triage" && form.severity) body.severity = form.severity;
    try {
      await api(`/api/compliance/cases/${detail.case.id}`, { method: "POST", body: JSON.stringify(body) });
      // Clear only what was submitted — text typed while the request ran is kept.
      const sent = form.reason;
      setForm((f) => (f.reason === sent ? { ...f, reason: "" } : f));
      await open(detail.case.id);
      void load();
    } catch (e) {
      setActErr(e instanceof Error ? e.message : "The action was not recorded.");
    } finally {
      setBusy("");
    }
  }

  const c = detail?.case;
  return (
    <>
      <div className="os-section-head" style={{ marginBottom: 12 }}>
        <div>
          <p className="os-eyebrow">Compliance</p>
          <h1 className="os-title">Case Management</h1>
          <p className="os-subtitle">One case per underlying event — onboarding reviews, sanctions hits and monitoring alerts. Every action is recorded with who, when and why.</p>
        </div>
        <button type="button" className="os-btn os-btn-sm" onClick={() => void load()}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>
      <Denied err={err} retry={load} />
      {!err && (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }} role="group" aria-label="Case filters">
            <select className="os-select" aria-label="Status" value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })} style={{ height: 36, width: "auto" }}>
              <option value="open">Open</option>
              <option value="closed">Resolved & closed</option>
              <option value="all">All</option>
            </select>
            <select className="os-select" aria-label="Case type" value={filter.type} onChange={(e) => setFilter({ ...filter, type: e.target.value })} style={{ height: 36, width: "auto" }}>
              <option value="">All types</option>
              {CASE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {label(t)}
                </option>
              ))}
            </select>
            <select className="os-select" aria-label="Severity" value={filter.severity} onChange={(e) => setFilter({ ...filter, severity: e.target.value })} style={{ height: 36, width: "auto" }}>
              <option value="">All severities</option>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
            </select>
            <select className="os-select" aria-label="Assignee" value={filter.assignee} onChange={(e) => setFilter({ ...filter, assignee: e.target.value })} style={{ height: 36, width: "auto" }}>
              <option value="">Anyone</option>
              <option value="me">Assigned to me</option>
              <option value="unassigned">Unassigned</option>
            </select>
            <label style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--os-muted)" }}>
              <input type="checkbox" checked={filter.overdue} onChange={(e) => setFilter({ ...filter, overdue: e.target.checked })} /> Overdue only
            </label>
          </div>
          {sync && "error" in sync && sync.error && <Notice tone="warn">Cases could not be derived from onboarding: {sync.error}</Notice>}
          <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 400px) minmax(0, 1fr)", gap: 16 }} className="os-split-cols">
            <section className="os-card" style={{ padding: 0, overflow: "hidden" }} aria-label="Case queue">
              {rows === null ? (
                <p style={{ padding: 16, color: "var(--os-muted)" }}>Loading…</p>
              ) : rows.length === 0 ? (
                <p style={{ padding: 16, color: "var(--os-muted)" }}>No cases match these filters.</p>
              ) : (
                <div className="os-rows" style={{ gap: 0 }}>
                  {rows.map((r) => (
                    <button key={r.id} type="button" className="os-row" aria-current={sel === r.id} onClick={() => void open(r.id)} style={{ borderRadius: 0, borderWidth: "0 0 1px", background: sel === r.id ? "var(--os-sunk)" : undefined, flexWrap: "wrap" }}>
                      <span className="os-row-body">
                        <strong>{r.title}</strong>
                        <small>
                          {label(r.type)} · {label(r.status)} · {r.assignee ? `assigned ${r.assignee}` : "unassigned"}
                          {r.self ? " · about you" : ""}
                        </small>
                      </span>
                      <span style={{ display: "flex", gap: 6 }}>
                        <Badge tone={SEV_TONE[r.severity]}>{label(r.severity)}</Badge>
                        <Badge tone={SLA_TONE[r.sla] ?? "muted"}>{label(r.sla)}</Badge>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </section>
            <section className="os-card" style={{ padding: 20, minWidth: 0 }} aria-label="Case detail">
              {!sel ? (
                <p style={{ color: "var(--os-muted)" }}>Select a case.</p>
              ) : !c ? (
                actErr ? <Notice tone="error">{actErr}</Notice> : <p style={{ color: "var(--os-muted)" }}>Loading case…</p>
              ) : (
                <>
                  <div className="os-section-head">
                    <div>
                      <h2>{c.title}</h2>
                      <small style={{ color: "var(--os-muted)" }}>
                        {label(c.type)} · subject {c.subjectId} · opened {when(c.createdAt)} · SLA {when(c.slaDueAt)}
                        {c.escalationLevel ? ` · escalation ${c.escalationLevel}` : ""}
                      </small>
                    </div>
                    <span style={{ display: "flex", gap: 6 }}>
                      <Badge tone={SEV_TONE[c.severity]}>{label(c.severity)}</Badge>
                      <Badge tone="muted">{label(c.status)}</Badge>
                    </span>
                  </div>
                  {detail?.self && <Notice tone="warn">This case is about you. Another compliance officer must handle it.</Notice>}
                  {c.resolution && (
                    <Notice tone="info">
                      Resolved: {label(c.resolution)} — {c.decisionReason}
                    </Notice>
                  )}

                  {detail?.linked?.business && (
                    <>
                      <h3 className="os-review-h">Linked onboarding case</h3>
                      <dl className="os-dl">
                        <div><dt>Business</dt><dd>{detail.linked.business.legalName} · {detail.linked.business.country}</dd></div>
                        <div><dt>Review</dt><dd>{label(detail.linked.review)}</dd></div>
                        <div><dt>Screening</dt><dd>{detail.linked.screening ? `${label(detail.linked.screening.status)} · ${detail.linked.screening.list}` : "Not run"}</dd></div>
                        <div><dt>Next re-screen</dt><dd>{when(detail.linked.nextRescreenAt)}{detail.linked.riskLevel ? ` (country risk ${detail.linked.riskLevel})` : ""}</dd></div>
                      </dl>
                    </>
                  )}
                  {(detail?.linked?.screeningHistory?.length ?? 0) > 0 && detail?.linked && (
                    <>
                      <h3 className="os-review-h">Screening history</h3>
                      <ol className="os-list" style={{ listStyle: "none" }} aria-label="Screening history">
                        {[...(detail.linked.screeningHistory as ScreeningRecord[])].reverse().map((h, i) => (
                          <li key={i}>
                            <span>
                              <strong>
                                {label(h.disposition)} · {h.kind === "run" ? `run (${h.trigger ?? "—"})` : "decision"}
                              </strong>
                              <small>
                                {when(h.at)} · {h.provider} · {h.by}
                                {h.matches?.length ? ` · ${h.matches.map((m) => `${m.name} ${Math.round(m.score * 100)}%`).join(", ")}` : ""}
                                {h.reason ? ` — ${h.reason}` : ""}
                              </small>
                            </span>
                          </li>
                        ))}
                      </ol>
                    </>
                  )}
                  {(detail?.linked?.transactions?.length ?? 0) > 0 && detail?.linked && (
                    <>
                      <h3 className="os-review-h">Linked transactions</h3>
                      <table className="os-table">
                        <thead>
                          <tr>
                            <th scope="col">ID</th>
                            <th scope="col">Direction</th>
                            <th scope="col">Amount</th>
                            <th scope="col">Status</th>
                            <th scope="col">Time</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.linked.transactions.map((t: { id: string; direction: string; amountUsd: number; status: string; timestamp: string }) => (
                            <tr key={t.id}>
                              <td className="mono">{t.id}</td>
                              <td>{t.direction}</td>
                              <td className="mono">${t.amountUsd.toLocaleString("en-US")}</td>
                              <td>{t.status}</td>
                              <td>{when(t.timestamp)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}

                  {detail && detail.allowed.length > 0 && (
                    <>
                      <h3 className="os-review-h">Action</h3>
                      <div style={{ display: "grid", gap: 10 }}>
                        <label className="os-field">
                          <span>Reason / note (required to escalate, resolve, close, reopen or note)</span>
                          <textarea className="os-textarea" rows={2} maxLength={1000} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
                        </label>
                        {detail.allowed.includes("assign") && (
                          <label className="os-field">
                            <span>Assignee (compliance officer account id)</span>
                            <input className="os-input" value={form.assignee} onChange={(e) => setForm({ ...form, assignee: e.target.value })} />
                          </label>
                        )}
                        {detail.allowed.includes("resolve") && (
                          <label className="os-field">
                            <span>Resolution</span>
                            <select className="os-select" value={form.resolution} onChange={(e) => setForm({ ...form, resolution: e.target.value })}>
                              {["no_action", "false_positive", "confirmed", "account_restricted", "reported"].map((r) => (
                                <option key={r} value={r}>
                                  {label(r)}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                        {detail.allowed.includes("triage") && (
                          <label className="os-field">
                            <span>Severity (triage)</span>
                            <select className="os-select" value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
                              <option value="">Keep {c.severity}</option>
                              {SEVERITIES.map((s) => (
                                <option key={s} value={s}>
                                  {label(s)}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {detail.allowed.map((a) => (
                            <button
                              key={a}
                              type="button"
                              className={`os-btn os-btn-sm ${a === "resolve" ? "os-btn-primary" : ""}`}
                              disabled={!!busy || (NEEDS_REASON.includes(a) && form.reason.trim().length < 5) || (a === "assign" && form.assignee.trim().length < 3)}
                              onClick={() => void act(a)}
                            >
                              {busy === a ? "Saving…" : ACTION_LABEL[a]}
                            </button>
                          ))}
                        </div>
                        {actErr && <Notice tone="error">{actErr}</Notice>}
                      </div>
                    </>
                  )}

                  <h3 className="os-review-h">Timeline</h3>
                  <ol className="os-list" style={{ listStyle: "none" }} aria-label="Case timeline">
                    {[...c.events].reverse().map((e, i) => (
                      <li key={i}>
                        <span>
                          <strong>
                            {label(e.action)}
                            {e.to ? ` → ${label(e.to)}` : ""}
                          </strong>
                          <small>
                            {when(e.at)} · {e.actor}
                            {e.note ? ` — ${e.note}` : ""}
                          </small>
                        </span>
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </section>
          </div>
        </>
      )}
    </>
  );
}

export function MonitoringPanel() {
  const [rules, setRules] = useState<MonitoringRule[] | null>(null);
  const [err, setErr] = useState<Err>(null);
  const [form, setForm] = useState({ subjectId: "", from: "", to: "", dryRun: true });
  const [result, setResult] = useState<{ evaluated: number; alerts: MonitoringAlert[]; opened: number; dryRun: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [runErr, setRunErr] = useState("");
  const load = useCallback(async () => {
    setErr(null);
    try {
      setRules((await api<{ rules: MonitoringRule[] }>("/api/compliance/monitoring")).rules);
    } catch (e) {
      setErr(errOf(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function run() {
    setBusy(true);
    setRunErr("");
    try {
      setResult(
        await api("/api/compliance/monitoring", {
          method: "POST",
          body: JSON.stringify({ subjectId: form.subjectId.trim(), dryRun: form.dryRun, ...(form.from ? { from: new Date(`${form.from}T00:00:00Z`).toISOString() } : {}), ...(form.to ? { to: new Date(`${form.to}T00:00:00Z`).toISOString() } : {}) }),
        })
      );
    } catch (e) {
      setRunErr(e instanceof Error ? e.message : "Evaluation failed.");
    } finally {
      setBusy(false);
    }
  }
  if (err) return <Denied err={err} retry={load} />;
  return (
    <>
      <section className="os-card" style={{ padding: 18, marginTop: 16 }} aria-label="Monitoring rules">
        <h2>Rules</h2>
        <p style={{ color: "var(--os-muted)", marginTop: 0 }}>Versioned rules over the account ledger. A threshold change is a reviewed code change. Alerts open cases; they never move or hold money.</p>
        {!rules ? (
          <p style={{ color: "var(--os-muted)" }}>Loading…</p>
        ) : (
          <div className="os-rows">
            {rules.map((r) => (
              <div key={r.id} className="os-row" style={{ cursor: "default", flexWrap: "wrap" }}>
                <span className="os-row-body">
                  <strong>
                    {r.name} <span className="mono" style={{ color: "var(--os-faint)", fontWeight: 400 }}>v{r.version}</span>
                  </strong>
                  <small>
                    {r.description} {Object.entries(r.params).map(([k, v]) => `${k}=${v}`).join(" · ")}
                    {r.disabledReason ? ` — ${r.disabledReason}` : ""}
                  </small>
                </span>
                <Badge tone={r.enabled ? "green" : "muted"}>{r.enabled ? "Enabled" : "Disabled"}</Badge>
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="os-card" style={{ padding: 18, marginTop: 16 }} aria-label="Evaluate an account">
        <h2>Evaluate an account</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
          <label className="os-field">
            <span>Account id</span>
            <input className="os-input" value={form.subjectId} onChange={(e) => setForm({ ...form, subjectId: e.target.value })} />
          </label>
          <label className="os-field">
            <span>From (optional)</span>
            <input className="os-input" type="date" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} />
          </label>
          <label className="os-field">
            <span>To (optional)</span>
            <input className="os-input" type="date" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} />
          </label>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10, color: "var(--os-muted)" }}>
          <input type="checkbox" checked={form.dryRun} onChange={(e) => setForm({ ...form, dryRun: e.target.checked })} /> Back-test only (do not open cases)
        </label>
        <button type="button" className="os-btn os-btn-primary" style={{ marginTop: 12 }} disabled={busy || form.subjectId.trim().length < 3} onClick={() => void run()}>
          <Play size={15} /> {busy ? "Evaluating…" : "Evaluate"}
        </button>
        {runErr && <Notice tone="error">{runErr}</Notice>}
        {result && (
          <div style={{ marginTop: 14 }} aria-live="polite" data-testid="monitoring-result">
            <p>
              {result.evaluated} transactions evaluated · {result.alerts.length} alert{result.alerts.length === 1 ? "" : "s"}
              {result.dryRun ? " (back-test, no cases opened)" : ` · ${result.opened} new case${result.opened === 1 ? "" : "s"} opened`}
            </p>
            <ul className="os-list">
              {result.alerts.map((a) => (
                <li key={a.key}>
                  <span>
                    <strong>{a.title}</strong>
                    <small>{a.explanation}</small>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </>
  );
}

export function ReportsPanel() {
  const [type, setType] = useState<(typeof REPORT_TYPES)[number]>("cases");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const q = new URLSearchParams({ type, ...(from ? { from } : {}), ...(to ? { to } : {}) });
  return (
    <section className="os-card" style={{ padding: 18 }} aria-label="Export a report">
      <h2>Export a report</h2>
      <p style={{ color: "var(--os-muted)", marginTop: 0 }}>CSV from stored records. Exports never include dates of birth, emails, phone numbers, ID numbers or documents, and every export is recorded in the audit log.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
        <label className="os-field">
          <span>Report</span>
          <select className="os-select" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
            {REPORT_TYPES.map((t) => (
              <option key={t} value={t}>
                {REPORT_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="os-field">
          <span>From (optional)</span>
          <input className="os-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="os-field">
          <span>To (optional, inclusive)</span>
          <input className="os-input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      <a className="os-btn os-btn-primary" style={{ marginTop: 12, display: "inline-flex" }} href={`/api/compliance/reports?${q}`} download>
        <Download size={15} /> Download CSV
      </a>
    </section>
  );
}
