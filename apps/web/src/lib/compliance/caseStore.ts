// ---------------------------------------------------------------------------
// Compliance case persistence. Server-only.
//
//   production:  Supabase table `compliance_cases` (migration 0039), reached
//                with the service role from the API only (RLS on, no
//                anon/authenticated grants). `source_key` is UNIQUE, so the
//                same underlying event can never open two cases.
//   development: in-memory map (same semantics, per-case lock).
//   neither:     fail closed — CaseStoreUnavailable, nothing is pretended.
//
// Writes are optimistic: an update only lands if `version` is unchanged, so two
// officers acting at once cannot overwrite each other's decision.
// ---------------------------------------------------------------------------

import { sbInsertIgnoreDuplicates, sbSelect, sbUpdate } from "@/lib/supabase";
import { backend } from "@/lib/settlement/onboardingStore";
import type { CaseStatus, CaseType, ComplianceCase, Severity } from "./cases";

export class CaseStoreUnavailable extends Error {}

const TABLE = "compliance_cases";
const MAX_EVENTS = 300;

type Row = {
  id: string;
  source_key: string;
  case_type: CaseType;
  status: CaseStatus;
  severity: Severity;
  subject_id: string;
  assignee: string | null;
  sla_due_at: string;
  data: ComplianceCase;
  created_at: string;
  updated_at: string;
  version: number;
};

const g = globalThis as unknown as { __furlCases?: Map<string, ComplianceCase>; __furlCaseLocks?: Map<string, Promise<unknown>> };
const memory = (g.__furlCases ??= new Map());
const locks = (g.__furlCaseLocks ??= new Map());

function toRow(c: ComplianceCase): Row {
  const data = { ...c, events: c.events.slice(-MAX_EVENTS) };
  return { id: c.id, source_key: c.sourceKey, case_type: c.type, status: c.status, severity: c.severity, subject_id: c.subjectId, assignee: c.assignee, sla_due_at: c.slaDueAt, data, created_at: c.createdAt, updated_at: c.updatedAt, version: c.version };
}

function available() {
  const b = backend();
  if (b === "none") throw new CaseStoreUnavailable("Case storage is not configured on this deployment.");
  return b;
}

/** Insert unless a case with the same sourceKey exists; returns the stored case either way. */
export async function insertCaseIfAbsent(c: ComplianceCase): Promise<{ case: ComplianceCase; created: boolean }> {
  if (available() === "development") {
    const existing = [...memory.values()].find((x) => x.sourceKey === c.sourceKey);
    if (existing) return { case: structuredClone(existing), created: false };
    memory.set(c.id, structuredClone(c));
    return { case: structuredClone(c), created: true };
  }
  await sbInsertIgnoreDuplicates<Row>(TABLE, toRow(c));
  const [row] = await sbSelect<Row>(TABLE, `source_key=eq.${encodeURIComponent(c.sourceKey)}&limit=1`);
  if (!row) throw new CaseStoreUnavailable("The case could not be recorded.");
  return { case: row.data, created: row.id === c.id };
}

export async function getCase(id: string): Promise<ComplianceCase | null> {
  if (available() === "development") {
    const c = memory.get(id);
    return c ? structuredClone(c) : null;
  }
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await sbSelect<Row>(TABLE, `id=eq.${id}&limit=1`);
  return row?.data ?? null;
}

export type CaseFilter = { status?: CaseStatus[]; type?: CaseType; severity?: Severity; assignee?: string; subjectId?: string; limit?: number };

export async function listCases(f: CaseFilter = {}): Promise<ComplianceCase[]> {
  const limit = Math.min(Math.max(1, f.limit ?? 200), 500);
  if (available() === "development") {
    return [...memory.values()]
      .filter((c) => (!f.status || f.status.includes(c.status)) && (!f.type || c.type === f.type) && (!f.severity || c.severity === f.severity) && (!f.assignee || c.assignee === f.assignee) && (!f.subjectId || c.subjectId === f.subjectId))
      .sort((a, b) => (a.slaDueAt < b.slaDueAt ? -1 : 1))
      .slice(0, limit)
      .map((c) => structuredClone(c));
  }
  // Every filter value is from a validated enum or encoded; nothing is spliced raw.
  const q = [
    "select=data",
    f.status?.length ? `status=in.(${f.status.join(",")})` : "",
    f.type ? `case_type=eq.${f.type}` : "",
    f.severity ? `severity=eq.${f.severity}` : "",
    f.assignee ? `assignee=eq.${encodeURIComponent(f.assignee)}` : "",
    f.subjectId ? `subject_id=eq.${encodeURIComponent(f.subjectId)}` : "",
    "order=sla_due_at.asc",
    `limit=${limit}`,
  ].filter(Boolean);
  const rows = await sbSelect<Pick<Row, "data">>(TABLE, q.join("&"));
  return rows.map((r) => r.data);
}

/** Read-modify-write with optimistic concurrency. `mutate` may throw to abort. */
export async function updateCase(id: string, mutate: (c: ComplianceCase) => ComplianceCase | Promise<ComplianceCase>): Promise<ComplianceCase> {
  if (available() === "development") {
    const prev = locks.get(id) ?? Promise.resolve();
    const run = prev.then(async () => {
      const cur = memory.get(id);
      if (!cur) throw new CaseStoreUnavailable("Case not found.");
      const next = await mutate(structuredClone(cur));
      memory.set(id, structuredClone(next));
      return structuredClone(next);
    });
    locks.set(id, run.catch(() => undefined));
    return run;
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    const cur = await getCase(id);
    if (!cur) throw new CaseStoreUnavailable("Case not found.");
    const next = await mutate(structuredClone(cur));
    const r = toRow(next);
    const written = await sbUpdate<Row>(TABLE, `id=eq.${id}&version=eq.${cur.version}`, { status: r.status, severity: r.severity, assignee: r.assignee, sla_due_at: r.sla_due_at, data: r.data, updated_at: r.updated_at, version: r.version });
    if (written.length === 1) return next;
  }
  throw new CaseStoreUnavailable("The case is being updated by another officer. Reload and try again.");
}

export function resetCaseStore() {
  if (process.env.NODE_ENV === "production") throw new Error("resetCaseStore is test-only");
  memory.clear();
  locks.clear();
}

/**
 * Batch form of insertCaseIfAbsent for the sync: one bulk insert-if-absent and
 * one lookup per chunk instead of two round trips per case. Returns how many
 * were newly created.
 */
export async function insertCasesIfAbsent(cases: readonly ComplianceCase[]): Promise<number> {
  if (!cases.length) return 0;
  if (available() === "development") {
    let n = 0;
    for (const c of cases) if ((await insertCaseIfAbsent(c)).created) n++;
    return n;
  }
  let created = 0;
  for (let i = 0; i < cases.length; i += 50) {
    const chunk = cases.slice(i, i + 50);
    await sbInsertIgnoreDuplicates<Row>(TABLE, chunk.map(toRow));
    const keys = chunk.map((c) => `"${c.sourceKey.replace(/"/g, "")}"`).join(",");
    const rows = await sbSelect<Pick<Row, "id" | "source_key">>(TABLE, `select=id,source_key&source_key=in.(${encodeURIComponent(keys)})`);
    const ours = new Set(chunk.map((c) => c.id));
    created += rows.filter((r) => ours.has(r.id)).length;
  }
  return created;
}
