"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Check, FileText, RefreshCw, Trash2, UploadCloud } from "lucide-react";
import type { ZodTypeAny } from "zod";
import { DOCUMENT_MAX_BYTES, DOCUMENT_TYPES, DOCUMENTS, STEPS, type DocumentKind, type DocumentRecord, type EditableStep, type StepId } from "@/lib/settlement/onboarding";
import { api, Badge, ProgressBar } from "../os/primitives";
import type { OnboardingView } from "./types";
import type { StepProps } from "./OnboardingApp";

export type Errors = Record<string, string>;

/** Zod issues → { "address.line1": "Required" } for inline field errors. */
export function issuesToErrors(issues: { path: (string | number)[]; message: string }[]): Errors {
  const out: Errors = {};
  for (const i of issues) {
    const key = i.path.join(".") || "_";
    if (!out[key]) out[key] = i.message;
  }
  return out;
}

/** Draft + validation + save for one editable step. The server re-validates everything. */
export function useStep<T>(p: StepProps, step: EditableStep, schema: ZodTypeAny, initial: T) {
  const [draft, setDraft] = useState<T>(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState<"" | "save" | "continue">("");
  const [error, setError] = useState("");
  async function save(complete: boolean): Promise<boolean> {
    if (busy) return false;
    setError("");
    const local = schema.safeParse(draft);
    if (!local.success && complete) {
      setErrors(issuesToErrors(local.error.issues));
      setError("Please fix the highlighted fields.");
      return false;
    }
    setErrors(local.success || !complete ? {} : errors);
    setBusy(complete ? "continue" : "save");
    try {
      const v = await api<OnboardingView>("/api/settlement/onboarding", { method: "PUT", body: JSON.stringify({ step, data: local.success ? local.data : draft, complete }) });
      p.setView(v);
      if (!complete) p.notify("Progress saved. You can continue later.");
      return true;
    } catch (e) {
      const body = (e as { body?: OnboardingView & { blockers?: string[] } }).body;
      if (body?.state) p.setView(body);
      setError(e instanceof Error ? e.message : "Could not save.");
      return false;
    } finally {
      setBusy("");
    }
  }
  const set = <K extends keyof T>(key: K, value: T[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const docs = p.view.state.documents.map((d) => d.id).join();
  useEffect(() => setError(""), [docs]);
  return { draft, setDraft, set, errors, busy, error, save };
}

export const nextStep = (s: StepId) => STEPS[STEPS.indexOf(s) + 1] ?? s;
export const prevStep = (s: StepId) => STEPS[STEPS.indexOf(s) - 1] ?? s;

export function StepHeader({ step, title, subtitle }: { step: StepId; title: string; subtitle: string }) {
  return (
    <header>
      <span className="os-eyebrow">
        Step {STEPS.indexOf(step) + 1} of {STEPS.length}
      </span>
      <h1 className="os-title">{title}</h1>
      <p className="os-subtitle">{subtitle}</p>
    </header>
  );
}

export function StepActions({ onBack, onLater, onContinue, busy, continueLabel = "Continue", disabled }: { onBack?: () => void; onLater?: () => void; onContinue: () => void; busy: string; continueLabel?: string; disabled?: boolean }) {
  return (
    <div className="os-actions">
      {onBack ? (
        <button type="button" className="os-btn" onClick={onBack} disabled={!!busy}>
          <ArrowLeft size={16} /> Back
        </button>
      ) : onLater ? (
        <button type="button" className="os-btn" onClick={onLater} disabled={!!busy}>
          {busy === "save" ? "Saving…" : "Save and continue later"}
        </button>
      ) : (
        <span />
      )}
      <button type="button" className="os-btn os-btn-primary" onClick={onContinue} disabled={!!busy || disabled}>
        {busy === "continue" ? "Saving…" : continueLabel} <ArrowRight size={16} />
      </button>
    </div>
  );
}

export function Layout({ main, rail }: { main: ReactNode; rail: ReactNode }) {
  return (
    <>
      <main className="os-card os-main">{main}</main>
      <aside className="os-rail" aria-label="Onboarding context">
        {rail}
      </aside>
    </>
  );
}

export function ProgressCard({ view, title = "Onboarding Progress" }: { view: OnboardingView; title?: string }) {
  return (
    <section className="os-card">
      <h2>{title}</h2>
      <p className="os-rail-sub">
        {view.progress.done} of {view.progress.total} completed
      </p>
      <ProgressBar pct={view.progress.pct} label="Onboarding progress" />
    </section>
  );
}

export function RailList({ title, intro, items }: { title: string; intro?: string; items: { icon: ReactNode; title: string; body: string }[] }) {
  return (
    <section className="os-card">
      <h2>{title}</h2>
      {intro && <p className="os-rail-sub">{intro}</p>}
      <ul className="os-list">
        {items.map((i) => (
          <li key={i.title}>
            <span className="os-icon-tile">{i.icon}</span>
            <span>
              <strong>{i.title}</strong>
              <small>{i.body}</small>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export const reviewTone = (r: DocumentRecord["review"]) => (r === "approved" ? "green" : r === "rejected" ? "red" : "amber");
export const reviewLabel = (r: DocumentRecord["review"]) => (r === "approved" ? "Verified" : r === "rejected" ? "Rejected" : "In review");
export const fileSize = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/**
 * One document slot. Validates type and size before sending, shows real upload
 * progress (XHR), and supports retry, replace and remove. The server re-checks
 * the file signature and stores it privately; only compliance reviewers can open it (audited).
 */
export function Upload({ kind, view, onChange, hint, compact, disabled }: { kind: DocumentKind; view: OnboardingView; onChange: () => Promise<void>; hint?: string; compact?: boolean; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [pct, setPct] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [drag, setDrag] = useState(false);
  const [last, setLast] = useState<File | null>(null);
  const doc = view.state.documents.find((d) => d.kind === kind);
  const unavailable = view.storage === "none";
  const meta = DOCUMENTS[kind];

  function send(file: File) {
    setError("");
    setLast(file);
    if (!DOCUMENT_TYPES.includes(file.type as (typeof DOCUMENT_TYPES)[number])) return setError("Upload a PDF, JPG or PNG file.");
    if (file.size > DOCUMENT_MAX_BYTES) return setError("This file is larger than 10 MB.");
    const form = new FormData();
    form.append("kind", kind);
    form.append("file", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/settlement/onboarding/documents");
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => e.lengthComputable && setPct(Math.round((e.loaded / e.total) * 100));
    xhr.onerror = () => {
      setPct(null);
      setError("Network error. Nothing was uploaded.");
    };
    xhr.onload = async () => {
      setPct(null);
      if (xhr.status >= 200 && xhr.status < 300) {
        await onChange();
        return;
      }
      try {
        setError((JSON.parse(xhr.responseText) as { error?: string }).error ?? `Upload failed (${xhr.status}).`);
      } catch {
        setError(`Upload failed (${xhr.status}).`);
      }
    };
    setPct(0);
    xhr.send(form);
  }
  async function remove() {
    if (!doc) return;
    setError("");
    try {
      await api(`/api/settlement/onboarding/documents?id=${encodeURIComponent(doc.id)}`, { method: "DELETE" });
      await onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove the file.");
    }
  }
  const off = unavailable || disabled;
  return (
    <div
      className="os-upload"
      data-dashed={compact ? "true" : undefined}
      data-drag={drag ? "true" : undefined}
      onDragOver={(e) => {
        if (off) return;
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files?.[0];
        if (f && !off) send(f);
      }}
    >
      {doc ? <Check size={22} /> : <FileText size={22} />}
      <strong>{meta.label}</strong>
      <small>{hint ?? "PDF, JPG or PNG (Max 10MB)"}</small>
      <input
        ref={input}
        type="file"
        className="os-visually-hidden"
        accept={DOCUMENT_TYPES.join(",")}
        aria-label={`Upload ${meta.label}`}
        disabled={off}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) send(f);
          e.target.value = "";
        }}
      />
      {pct !== null && (
        <div className="os-upload-bar" role="progressbar" aria-label={`Uploading ${meta.label}`} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <i style={{ width: `${pct}%` }} />
        </div>
      )}
      {doc && pct === null && (
        <div className="os-upload-file">
          <FileText size={14} />
          <span title={doc.name}>
            {doc.name} · {fileSize(doc.size)}
          </span>
          <Badge tone={reviewTone(doc.review)}>{reviewLabel(doc.review)}</Badge>
          <button type="button" className="os-icon-btn" style={{ width: 28, height: 28 }} onClick={remove} aria-label={`Remove ${meta.label}`} disabled={off}>
            <Trash2 size={13} />
          </button>
        </div>
      )}
      {error && (
        <small className="os-field-error" role="alert">
          {error}
        </small>
      )}
      {error && last ? (
        <button type="button" className="os-btn os-btn-sm" onClick={() => send(last)}>
          <RefreshCw size={14} /> Retry
        </button>
      ) : (
        <button type="button" className="os-btn os-btn-sm" disabled={off || pct !== null} onClick={() => input.current?.click()}>
          <UploadCloud size={15} /> {unavailable ? "Storage not configured" : doc ? "Replace file" : "Upload File"}
        </button>
      )}
    </div>
  );
}
