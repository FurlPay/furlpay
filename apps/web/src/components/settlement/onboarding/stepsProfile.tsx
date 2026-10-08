"use client";

import Link from "next/link";
import { useState } from "react";
import { Building2, CheckCircle2, ChevronUp, FileCheck2, Globe2, KeyRound, Landmark, Link2, Lock, MessageSquare, MoreVertical, Plus, ShieldCheck, UserRound, Users, Workflow, X } from "lucide-react";
import {
  BUSINESS_TYPES,
  businessSchema,
  detailsSchema,
  EMPLOYEE_BANDS,
  ID_TYPES,
  identitySchema,
  INDUSTRIES,
  ONBOARDING_COUNTRIES,
  REVENUE_BANDS,
  UBO_THRESHOLD,
  countryName,
} from "@/lib/settlement/onboarding";
import { api, Choice, Field, Notice } from "../os/primitives";
import type { OnboardingView } from "./types";
import type { StepProps } from "./OnboardingApp";
import { Layout, nextStep, prevStep, ProgressCard, RailList, StepActions, StepHeader, Upload, useStep } from "./shared";

type Business = {
  type: "company" | "individual" | "marketplace" | "nonprofit";
  legalName: string;
  tradingName: string;
  country: string;
  registrationNumber: string;
  industry: string;
  website: string;
  address: { line1: string; line2: string; city: string; region: string; postalCode: string };
};
const emptyBusiness: Business = { type: "company", legalName: "", tradingName: "", country: "", registrationNumber: "", industry: "", website: "", address: { line1: "", line2: "", city: "", region: "", postalCode: "" } };

/** Saved data or the user's own draft, merged onto empty defaults. */
function initial<T>(view: OnboardingView, step: "business" | "identity" | "details", empty: T): T {
  const saved = (view.state.drafts?.[step] ?? view.state[step]) as Partial<T> | undefined;
  if (!saved || typeof saved !== "object") return empty;
  const out = { ...empty, ...saved } as T;
  for (const [k, v] of Object.entries(empty as Record<string, unknown>)) {
    if (v && typeof v === "object" && !Array.isArray(v)) (out as Record<string, unknown>)[k] = { ...(v as object), ...((saved as Record<string, unknown>)[k] as object) };
    if ((out as Record<string, unknown>)[k] === undefined || (out as Record<string, unknown>)[k] === null) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

const SecureCard = () => (
  <section className="os-card">
    <ul className="os-list" style={{ marginTop: 0 }}>
      <li>
        <span className="os-icon-tile">
          <ShieldCheck size={20} />
        </span>
        <span>
          <strong>Your data stays private</strong>
          <small>Documents are kept in private storage. Only FurlPay compliance reviewers can open them, and every access is logged. Only the last four characters of an ID number are stored.</small>
        </span>
      </li>
    </ul>
  </section>
);

// ── Step 1 ─────────────────────────────────────────────────────────────────
export function BusinessStep(p: StepProps) {
  const s = useStep<Business>(p, "business", businessSchema, initial(p.view, "business", emptyBusiness));
  const d = s.draft;
  const e = s.errors;
  const addr = (k: keyof Business["address"], v: string) => s.set("address", { ...d.address, [k]: v });
  const company = d.type !== "individual";
  return (
    <Layout
      main={
        <>
          <StepHeader step="business" title="Business Information" subtitle="Tell us about your business to get started with FurlPay." />
          <section className="os-section">
            <div className="os-section-head">
              <h2>Business Type</h2>
            </div>
            <div className="os-choice-row" role="radiogroup" aria-label="Business type">
              {BUSINESS_TYPES.map((t) => (
                <Choice key={t.id} checked={d.type === t.id} onSelect={() => s.set("type", t.id)} title={t.label} hint={t.hint} />
              ))}
            </div>
          </section>
          <section className="os-section" style={{ borderTop: 0, paddingTop: 0 }}>
            <div className="os-grid">
              <Field label={company ? "Legal Business Name" : "Legal Name"} error={e.legalName}>
                <input className="os-input" value={d.legalName} onChange={(x) => s.set("legalName", x.target.value)} autoComplete="organization" />
              </Field>
              <Field label="Trading Name" optional error={e.tradingName}>
                <input className="os-input" value={d.tradingName} onChange={(x) => s.set("tradingName", x.target.value)} />
              </Field>
              <Field label={company ? "Country of Incorporation" : "Country of Residence"} error={e.country}>
                <select className="os-select" value={d.country} onChange={(x) => s.set("country", x.target.value)}>
                  <option value="">Select country</option>
                  {ONBOARDING_COUNTRIES.map((c) => (
                    <option key={c.iso} value={c.iso}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={company ? "Business Registration Number" : "Tax Identification Number"} error={e.registrationNumber}>
                <input className="os-input mono" value={d.registrationNumber} onChange={(x) => s.set("registrationNumber", x.target.value)} />
              </Field>
              <Field label="Industry" error={e.industry}>
                <div className="os-input-icon">
                  <Building2 size={16} />
                  <select className="os-select" value={d.industry} onChange={(x) => s.set("industry", x.target.value)}>
                    <option value="">Select industry</option>
                    {INDUSTRIES.map((i) => (
                      <option key={i}>{i}</option>
                    ))}
                  </select>
                </div>
              </Field>
              <Field label="Company Website" optional error={e.website}>
                <div className="os-input-icon">
                  <Link2 size={16} />
                  <input className="os-input" type="url" inputMode="url" placeholder="https://" value={d.website} onChange={(x) => s.set("website", x.target.value)} />
                </div>
              </Field>
            </div>
          </section>
          <section className="os-section">
            <div className="os-section-head">
              <div>
                <h2>Business Address</h2>
                <p>This should match your official registration documents.</p>
              </div>
            </div>
            <div className="os-grid">
              <Field label="Address Line 1" error={e["address.line1"]}>
                <input className="os-input" value={d.address.line1} onChange={(x) => addr("line1", x.target.value)} autoComplete="address-line1" />
              </Field>
              <Field label="Address Line 2" optional>
                <input className="os-input" value={d.address.line2} onChange={(x) => addr("line2", x.target.value)} autoComplete="address-line2" />
              </Field>
            </div>
            <div className="os-grid os-grid-3" style={{ marginTop: 16 }}>
              <Field label="City" error={e["address.city"]}>
                <input className="os-input" value={d.address.city} onChange={(x) => addr("city", x.target.value)} autoComplete="address-level2" />
              </Field>
              <Field label="State / Province" error={e["address.region"]}>
                <input className="os-input" value={d.address.region} onChange={(x) => addr("region", x.target.value)} autoComplete="address-level1" />
              </Field>
              <Field label="Postal Code" error={e["address.postalCode"]}>
                <input className="os-input mono" value={d.address.postalCode} onChange={(x) => addr("postalCode", x.target.value)} autoComplete="postal-code" />
              </Field>
            </div>
          </section>
          {s.error && <Notice tone="error">{s.error}</Notice>}
          <StepActions busy={s.busy} onLater={() => void s.save(false)} onContinue={async () => (await s.save(true)) && p.go(nextStep("business"))} />
        </>
      }
      rail={
        <>
          <ProgressCard view={p.view} />
          <RailList
            title="Join the global settlement infrastructure."
            intro="Accept USDC from anywhere. Settle anywhere. Pay anyone. Reconcile everything."
            items={[
              { icon: <Globe2 size={20} />, title: "Multi-chain payments", body: "Receive USDC on Arbitrum, Base, Ethereum, Solana and Polygon." },
              { icon: <Workflow size={20} />, title: "Payouts with approvals", body: "Single, scheduled and batch payouts governed by approval policies." },
              { icon: <Landmark size={20} />, title: "Conversion quotes", body: "Request a live quote and review every cost before converting." },
              { icon: <ShieldCheck size={20} />, title: "Compliance built in", body: "Sanctions screening, country risk rules and a full audit trail." },
            ]}
          />
          <SecureCard />
        </>
      }
    />
  );
}

// ── Step 2 ─────────────────────────────────────────────────────────────────
type Identity = {
  verification: "kyb" | "kyc";
  representative: { fullName: string; dateOfBirth: string; email: string; phoneCountry: string; phone: string; idType: "PASSPORT" | "NATIONAL_ID" | "DRIVERS_LICENSE"; idNumberLast4: string };
};

export function IdentityStep(p: StepProps) {
  const empty: Identity = { verification: "kyb", representative: { fullName: "", dateOfBirth: "", email: "", phoneCountry: p.view.state.business?.country ?? "", phone: "", idType: "PASSPORT", idNumberLast4: "" } };
  const s = useStep<Identity>(p, "identity", identitySchema, initial(p.view, "identity", empty));
  const [idNumber, setIdNumber] = useState(s.draft.representative.idNumberLast4 ? `••••${s.draft.representative.idNumberLast4}` : "");
  const [verifyState, setVerifyState] = useState<{ busy: boolean; error: string }>({ busy: false, error: "" });
  const d = s.draft;
  const r = d.representative;
  const e = s.errors;
  const rep = <K extends keyof Identity["representative"]>(k: K, v: Identity["representative"][K]) => s.set("representative", { ...r, [k]: v });
  const refresh = async () => p.setView(await api<OnboardingView>("/api/settlement/onboarding"));
  async function startVerification() {
    setVerifyState({ busy: true, error: "" });
    try {
      const res = await api<{ sessionUrl: string }>("/api/settlement/onboarding", { method: "POST", body: JSON.stringify({ action: "verify" }) });
      window.open(res.sessionUrl, "_blank", "noopener,noreferrer");
      setVerifyState({ busy: false, error: "" });
    } catch (x) {
      setVerifyState({ busy: false, error: x instanceof Error ? x.message : "Verification could not start." });
    }
  }
  const kyb = d.verification === "kyb";
  return (
    <Layout
      main={
        <>
          <StepHeader step="identity" title="Verify Your Identity" subtitle="We are required to verify your identity to comply with global regulations." />
          <div className="os-tabbar" role="tablist" aria-label="Verification type">
            <button role="tab" type="button" aria-selected={kyb} onClick={() => s.set("verification", "kyb")}>
              <Landmark size={17} /> Business Verification (KYB)
            </button>
            <button role="tab" type="button" aria-selected={!kyb} onClick={() => s.set("verification", "kyc")}>
              <UserRound size={17} /> Individual Verification (KYC)
            </button>
          </div>
          {p.view.storage === "none" && <Notice tone="error">Document storage is not configured on this deployment, so documents cannot be uploaded yet.</Notice>}
          {p.view.storage === "development" && <Notice tone="info">Development store: documents are kept in this server’s memory and are cleared when it restarts.</Notice>}
          {kyb && (
            <section className="os-section">
              <div className="os-section-head">
                <div>
                  <h2>Business Documents</h2>
                  <p>Upload official documents for your business. Files are stored privately and reviewed by FurlPay compliance.</p>
                </div>
              </div>
              <div className="os-uploads">
                <Upload kind="incorporation" view={p.view} onChange={refresh} />
                <Upload kind="articles" view={p.view} onChange={refresh} />
                <Upload kind="address" view={p.view} onChange={refresh} hint="Utility bill, bank statement, etc. PDF, JPG or PNG (Max 10MB)" />
              </div>
            </section>
          )}
          <section className="os-section">
            <div className="os-section-head">
              <div>
                <h2>Authorized Representative</h2>
                <p>Add the primary contact who will manage the FurlPay account.</p>
              </div>
            </div>
            <div className="os-grid">
              <Field label="Full Legal Name" error={e["representative.fullName"]}>
                <input className="os-input" value={r.fullName} onChange={(x) => rep("fullName", x.target.value)} autoComplete="name" />
              </Field>
              <Field label="Date of Birth" error={e["representative.dateOfBirth"]}>
                <input className="os-input" type="date" value={r.dateOfBirth} max={new Date().toISOString().slice(0, 10)} onChange={(x) => rep("dateOfBirth", x.target.value)} autoComplete="bday" />
              </Field>
              <Field label="Email Address" error={e["representative.email"]}>
                <input className="os-input" type="email" value={r.email} onChange={(x) => rep("email", x.target.value)} autoComplete="email" />
              </Field>
              <Field label="Phone Number" error={e["representative.phone"] ?? e["representative.phoneCountry"]}>
                <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 10 }}>
                  <select className="os-select" aria-label="Country calling code" value={r.phoneCountry} onChange={(x) => rep("phoneCountry", x.target.value)}>
                    <option value="">Code</option>
                    {ONBOARDING_COUNTRIES.map((c) => (
                      <option key={c.iso} value={c.iso}>
                        {c.iso} +{c.dial}
                      </option>
                    ))}
                  </select>
                  <input className="os-input mono" type="tel" value={r.phone} onChange={(x) => rep("phone", x.target.value)} autoComplete="tel-national" />
                </div>
              </Field>
              <Field label="Government ID" error={e["representative.idType"]}>
                <select className="os-select" value={r.idType} onChange={(x) => rep("idType", x.target.value as Identity["representative"]["idType"])}>
                  {ID_TYPES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="ID Number" error={e["representative.idNumberLast4"]}>
                <input
                  className="os-input mono"
                  value={idNumber}
                  autoComplete="off"
                  onChange={(x) => {
                    setIdNumber(x.target.value);
                    rep("idNumberLast4", x.target.value.replace(/[^A-Za-z0-9]/g, "").slice(-4));
                  }}
                />
              </Field>
            </div>
            <div className="os-section-head" style={{ marginTop: 20 }}>
              <div>
                <h2 style={{ fontSize: 14 }}>Upload Government ID</h2>
                <p>Clear photo of your government-issued ID (front and back).</p>
              </div>
            </div>
            <div className="os-uploads" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
              <Upload kind="id_front" view={p.view} onChange={refresh} compact hint="JPG, PNG or PDF (Max 10MB)" />
              <Upload kind="id_back" view={p.view} onChange={refresh} compact hint="JPG, PNG or PDF (Max 10MB)" />
            </div>
          </section>
          <section className="os-section">
            <div className="os-section-head">
              <div>
                <h2>Identity verification</h2>
                <p>
                  Account holder status: <strong>{p.view.facts.kycStatus}</strong>
                </p>
              </div>
              <button type="button" className="os-btn os-btn-sm" disabled={!p.view.facts.identityProvider || verifyState.busy} onClick={startVerification}>
                <KeyRound size={15} /> {verifyState.busy ? "Starting…" : "Start verification"}
              </button>
            </div>
            {!p.view.facts.identityProvider && <Notice tone="info">No identity verification provider is configured on this deployment. Uploaded documents are reviewed manually by FurlPay compliance.</Notice>}
            {verifyState.error && <Notice tone="error">{verifyState.error}</Notice>}
          </section>
          {s.error && <Notice tone="error">{s.error}</Notice>}
          <StepActions busy={s.busy} onBack={() => p.go(prevStep("identity"))} onContinue={async () => (await s.save(true)) && p.go(nextStep("identity"))} />
        </>
      }
      rail={
        <>
          <ProgressCard view={p.view} title="Verification Progress" />
          <RailList
            title="Your information is secure"
            items={[
              { icon: <Lock size={20} />, title: "Private storage", body: "Uploads go to private storage. There is no public link to any document." },
              { icon: <FileCheck2 size={20} />, title: "Checked on arrival", body: "Every file is checked against its declared type and the 10 MB limit before it is stored." },
              { icon: <ShieldCheck size={20} />, title: "Reviewed by people", body: "Uploading a document does not approve it. Each one is reviewed by FurlPay compliance." },
            ]}
          />
          <section className="os-card">
            <h2>Accepted Documents</h2>
            <div style={{ marginTop: 14, display: "grid", gap: 14 }}>
              <div>
                <strong>Business Documents</strong>
                <ul style={{ margin: "8px 0 0", paddingLeft: 18, color: "var(--os-muted)", lineHeight: 1.8 }}>
                  <li>Certificate of Incorporation</li>
                  <li>Articles of Association</li>
                  <li>Business License (if applicable)</li>
                  <li>Proof of Business Address (utility bill, bank statement, etc.)</li>
                </ul>
              </div>
              <div>
                <strong>Identity Documents</strong>
                <ul style={{ margin: "8px 0 0", paddingLeft: 18, color: "var(--os-muted)", lineHeight: 1.8 }}>
                  {ID_TYPES.map((t) => (
                    <li key={t.id}>{t.label}</li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
          <section className="os-card">
            <div className="os-help-head">
              <span className="os-icon-tile">
                <MessageSquare size={20} />
              </span>
              <span>
                <strong>Need assistance?</strong>
                <small>Our compliance team can help you through verification.</small>
              </span>
            </div>
            <Link className="os-btn os-btn-block" href="/support">
              Chat with Compliance Team
            </Link>
          </section>
        </>
      }
    />
  );
}

// ── Step 3 ─────────────────────────────────────────────────────────────────
type Owner = { id: string; name: string; type: "individual" | "corporate"; percent: number; role: string };
type Details = { incorporationDate: string; description: string; employees: string; revenue: string; owners: Owner[] };

export function DetailsStep(p: StepProps) {
  const s = useStep<Details>(p, "details", detailsSchema, initial(p.view, "details", { incorporationDate: "", description: "", employees: "", revenue: "", owners: [] }));
  const [editing, setEditing] = useState<Owner | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [requiredOpen, setRequiredOpen] = useState(true);
  const d = s.draft;
  const e = s.errors;
  const b = p.view.state.business;
  const total = d.owners.reduce((t, o) => t + o.percent, 0);
  const saveOwner = (o: Owner) => {
    s.set("owners", d.owners.some((x) => x.id === o.id) ? d.owners.map((x) => (x.id === o.id ? o : x)) : [...d.owners, o]);
    setEditing(null);
  };
  return (
    <Layout
      main={
        <>
          <StepHeader step="details" title="Business Details" subtitle="Provide additional details about your business, ownership structure, and operational model." />
          <section className="os-section">
            <div className="os-section-head">
              <h2>Business Information</h2>
              <button type="button" className="os-link" style={{ background: "none", border: 0 }} onClick={() => p.go("business")}>
                Edit
              </button>
            </div>
            <div className="os-grid">
              <Field label="Legal Business Name">
                <input className="os-input" value={b?.legalName ?? ""} readOnly aria-readonly />
              </Field>
              <Field label="Trading Name" optional>
                <input className="os-input" value={b?.tradingName ?? ""} readOnly aria-readonly />
              </Field>
              <Field label="Country of Incorporation">
                <input className="os-input" value={countryName(b?.country)} readOnly aria-readonly />
              </Field>
              <Field label="Date of Incorporation" error={e.incorporationDate}>
                <input className="os-input" type="date" value={d.incorporationDate} max={new Date().toISOString().slice(0, 10)} onChange={(x) => s.set("incorporationDate", x.target.value)} />
              </Field>
              <Field label="Industry">
                <input className="os-input" value={b?.industry ?? ""} readOnly aria-readonly />
              </Field>
              <Field label="Business Website">
                <input className="os-input" value={b?.website ?? ""} readOnly aria-readonly />
              </Field>
              <Field label="Business Description" span error={e.description} counter={`${d.description.length}/500`}>
                <textarea className="os-textarea" maxLength={500} value={d.description} onChange={(x) => s.set("description", x.target.value)} />
              </Field>
            </div>
          </section>
          <section className="os-section">
            <div className="os-section-head">
              <div>
                <h2>Ownership Structure</h2>
                <p>Provide details about your company’s ownership structure and ultimate beneficial owners (UBOs).</p>
              </div>
              <span className="mono" style={{ color: total > 100 ? "var(--os-red)" : "var(--os-muted)" }}>
                {total}% declared
              </span>
            </div>
            {d.owners.length > 0 ? (
              <table className="os-table">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Ownership type</th>
                    <th scope="col">Ownership %</th>
                    <th scope="col">Role</th>
                    <th scope="col">
                      <span className="os-visually-hidden">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {d.owners.map((o) => (
                    <tr key={o.id}>
                      <td>{o.name}</td>
                      <td>{o.type === "individual" ? "Individual" : "Corporate"}</td>
                      <td className="mono">{o.percent}%</td>
                      <td>{o.role}</td>
                      <td style={{ position: "relative", width: 44 }}>
                        <button type="button" className="os-icon-btn" style={{ width: 30, height: 30, border: 0, background: "none" }} aria-label={`Actions for ${o.name}`} onClick={() => setMenu(menu === o.id ? null : o.id)}>
                          <MoreVertical size={15} />
                        </button>
                        {menu === o.id && (
                          <div className="os-menu" role="menu">
                            <button role="menuitem" type="button" onClick={() => (setEditing(o), setMenu(null))}>
                              Edit owner
                            </button>
                            <button role="menuitem" type="button" onClick={() => (s.set("owners", d.owners.filter((x) => x.id !== o.id)), setMenu(null))}>
                              Remove owner
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Notice tone="info">No owners declared yet. Add everyone who holds {UBO_THRESHOLD}% or more of the business.</Notice>
            )}
            {e.owners && <p className="os-field-error" style={{ marginTop: 8 }}>{e.owners}</p>}
            <button type="button" className="os-btn os-btn-sm" style={{ marginTop: 14, color: "var(--os-accent)", borderColor: "#00c88855" }} onClick={() => setEditing({ id: crypto.randomUUID(), name: "", type: "individual", percent: 0, role: "" })}>
              <Plus size={15} /> Add Owner / Shareholder
            </button>
          </section>
          <section className="os-section">
            <div className="os-section-head">
              <h2>Business Operations</h2>
            </div>
            <div className="os-grid">
              <Field label="Number of Employees" error={e.employees}>
                <div className="os-input-icon">
                  <Users size={16} />
                  <select className="os-select" value={d.employees} onChange={(x) => s.set("employees", x.target.value)}>
                    <option value="">Select</option>
                    {EMPLOYEE_BANDS.map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </div>
              </Field>
              <Field label="Annual Revenue (USD)" error={e.revenue}>
                <select className="os-select" value={d.revenue} onChange={(x) => s.set("revenue", x.target.value)}>
                  <option value="">Select</option>
                  {REVENUE_BANDS.map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </Field>
            </div>
          </section>
          {s.error && <Notice tone="error">{s.error}</Notice>}
          <StepActions busy={s.busy} onBack={() => p.go(prevStep("details"))} onContinue={async () => (await s.save(true)) && p.go(nextStep("details"))} />
          {editing && <OwnerDrawer owner={editing} others={d.owners.filter((o) => o.id !== editing.id)} onSave={saveOwner} onClose={() => setEditing(null)} />}
        </>
      }
      rail={
        <>
          <ProgressCard view={p.view} />
          <section className="os-card">
            <div className="os-section-head" style={{ marginBottom: 0 }}>
              <h2>Required Information</h2>
              <button type="button" className="os-icon-btn" style={{ width: 30, height: 30 }} aria-expanded={requiredOpen} aria-label="Toggle required information" onClick={() => setRequiredOpen(!requiredOpen)}>
                <ChevronUp size={15} style={{ transform: requiredOpen ? undefined : "rotate(180deg)" }} />
              </button>
            </div>
            {requiredOpen && (
              <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
                {[
                  { label: "Legal business name and registration", done: Boolean(b?.legalName && b.registrationNumber) },
                  { label: `Ownership structure (≥ ${UBO_THRESHOLD}% owners)`, done: total >= UBO_THRESHOLD && total <= 100 },
                  { label: "Industry and business description", done: Boolean(b?.industry && d.description.trim()) },
                  { label: "Operational details", done: Boolean(d.employees && d.revenue && d.incorporationDate) },
                ].map((r) => (
                  <span key={r.label} className="os-check">
                    <CheckCircle2 size={16} color={r.done ? "var(--os-accent)" : "var(--os-faint)"} /> {r.label}
                  </span>
                ))}
              </div>
            )}
          </section>
          <SecureCard />
        </>
      }
    />
  );
}

function OwnerDrawer({ owner, others, onSave, onClose }: { owner: Owner; others: Owner[]; onSave: (o: Owner) => void; onClose: () => void }) {
  const [o, setO] = useState(owner);
  const [error, setError] = useState("");
  const remaining = 100 - others.reduce((t, x) => t + x.percent, 0);
  function submit() {
    if (!o.name.trim() || !o.role.trim()) return setError("Name and role are required.");
    if (!(o.percent >= 0 && o.percent <= 100)) return setError("Ownership must be between 0 and 100%.");
    if (o.percent > remaining) return setError(`Only ${remaining}% remains unallocated.`);
    if (others.some((x) => x.name.trim().toLowerCase() === o.name.trim().toLowerCase())) return setError("This owner is already listed.");
    onSave({ ...o, name: o.name.trim(), role: o.role.trim() });
  }
  return (
    <>
      <button className="os-backdrop" aria-label="Close" onClick={onClose} />
      <div className="os-drawer" role="dialog" aria-modal="true" aria-label="Owner">
        <div className="os-drawer-head">
          <h2>{others.length && owner.name ? "Edit owner" : "Add owner / shareholder"}</h2>
          <button className="os-icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div style={{ display: "grid", gap: 16 }}>
          <Field label="Name">
            <input className="os-input" autoFocus value={o.name} onChange={(x) => setO({ ...o, name: x.target.value })} />
          </Field>
          <Field label="Ownership type">
            <select className="os-select" value={o.type} onChange={(x) => setO({ ...o, type: x.target.value as Owner["type"] })}>
              <option value="individual">Individual</option>
              <option value="corporate">Corporate</option>
            </select>
          </Field>
          <Field label={`Ownership % (up to ${remaining}%)`}>
            <input className="os-input mono" type="number" min={0} max={100} step="0.01" value={Number.isFinite(o.percent) ? o.percent : 0} onChange={(x) => setO({ ...o, percent: Number(x.target.value) })} />
          </Field>
          <Field label="Role">
            <input className="os-input" placeholder="e.g. CEO, Director" value={o.role} onChange={(x) => setO({ ...o, role: x.target.value })} />
          </Field>
          {error && <Notice tone="error">{error}</Notice>}
          <button type="button" className="os-btn os-btn-primary" onClick={submit}>
            Save owner
          </button>
        </div>
      </div>
    </>
  );
}
