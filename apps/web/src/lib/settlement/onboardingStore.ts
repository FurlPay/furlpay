import { sbInsertIgnoreDuplicates, sbSelect, sbUpdate, sbUpsert, supabaseBackend } from "@/lib/supabase";
import { emptyState, type DocumentRecord, type OnboardingState } from "./onboarding";

// Persistence for business onboarding.
//
//   production:  Supabase — table `settlement_onboarding` (migration 0038) and
//                the private storage bucket `kyb-documents`. Service role only.
//   development: when Supabase is not configured AND NODE_ENV !== "production",
//                an in-process store, the same model lib/store.ts uses for
//                accounts in local development. It resets on restart.
//
// Production without Supabase fails closed: OnboardingUnavailable → 503. A
// save that cannot be made durable is never reported as saved.

export class OnboardingUnavailable extends Error {}

const TABLE = "settlement_onboarding";
const BUCKET = "kyb-documents";
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export type Backend = "supabase" | "development" | "none";
export function backend(env: Record<string, string | undefined> = process.env): Backend {
  if (supabaseBackend === "supabase") return "supabase";
  return env.NODE_ENV === "production" ? "none" : "development";
}

const g = globalThis as unknown as { __furlOnboarding?: Map<string, OnboardingState>; __furlOnboardingFiles?: Map<string, Uint8Array> };
const memory = (g.__furlOnboarding ??= new Map());
const memoryFiles = (g.__furlOnboardingFiles ??= new Map());

type Row = { owner_id: string; state: OnboardingState; updated_at: string };
const owner = (id: string) => `owner_id=eq.${encodeURIComponent(id)}`;

export async function loadState(userId: string): Promise<OnboardingState> {
  const b = backend();
  if (b === "none") throw new OnboardingUnavailable("Onboarding storage is not configured");
  if (b === "development") return structuredClone(memory.get(userId) ?? emptyState());
  const [row] = await sbSelect<Row>(TABLE, `${owner(userId)}&limit=1`);
  return row?.state ? { ...emptyState(), ...row.state } : emptyState();
}

export async function saveState(userId: string, state: OnboardingState): Promise<OnboardingState> {
  const b = backend();
  if (b === "none") throw new OnboardingUnavailable("Onboarding storage is not configured");
  const next = { ...state, updatedAt: new Date().toISOString() };
  if (b === "development") {
    memory.set(userId, structuredClone(next));
    return next;
  }
  await sbUpsert<Row>(TABLE, { owner_id: userId, state: next, updated_at: next.updatedAt });
  return next;
}

/** A refusal raised inside an update: nothing is written, the caller answers with it. */
export class Refusal extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly extra: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

const locks = new Map<string, Promise<unknown>>();

/**
 * Read-modify-write without lost updates. Two concurrent requests (two document
 * uploads, a save racing a screening) must not overwrite each other.
 *   development: a per-user promise chain serialises updates in this process.
 *   supabase:    optimistic concurrency — the write only lands if the row still
 *                carries the `updatedAt` it was read with; otherwise re-read and
 *                re-apply the mutation (bounded retries, then 503).
 * The mutator may throw Refusal to abort without writing.
 */
export async function updateState(userId: string, mutate: (s: OnboardingState) => OnboardingState | Promise<OnboardingState>): Promise<OnboardingState> {
  const b = backend();
  if (b === "none") throw new OnboardingUnavailable("Onboarding storage is not configured");
  if (b === "development") {
    const prev = locks.get(userId) ?? Promise.resolve();
    const run = prev.then(async () => saveState(userId, await mutate(structuredClone(memory.get(userId) ?? emptyState()))));
    locks.set(userId, run.catch(() => undefined));
    return run;
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    const [row] = await sbSelect<Row>(TABLE, `${owner(userId)}&limit=1`);
    const current = row?.state ? { ...emptyState(), ...row.state } : emptyState();
    const next = { ...(await mutate(structuredClone(current))), updatedAt: new Date().toISOString() };
    if (!row) {
      await sbInsertIgnoreDuplicates<Row>(TABLE, { owner_id: userId, state: next, updated_at: next.updatedAt });
      const [check] = await sbSelect<Row>(TABLE, `${owner(userId)}&limit=1`);
      if (check?.state?.updatedAt === next.updatedAt) return next;
      continue; // another request created the row first — re-read and re-apply
    }
    const written = await sbUpdate<Row>(TABLE, `${owner(userId)}&state->>updatedAt=eq.${encodeURIComponent(row.state.updatedAt)}`, { state: next, updated_at: next.updatedAt });
    if (written.length === 1) return next;
  }
  throw new OnboardingUnavailable("Onboarding is being updated by another request. Try again.");
}

/** Object path: owner-scoped, server-generated id — never a client-chosen name. */
const objectPath = (userId: string, doc: Pick<DocumentRecord, "id" | "kind">) => `${encodeURIComponent(userId)}/${doc.kind}/${doc.id}`;

export async function putDocument(userId: string, doc: DocumentRecord, bytes: Uint8Array): Promise<void> {
  const b = backend();
  if (b === "none") throw new OnboardingUnavailable("Document storage is not configured");
  if (b === "development") {
    memoryFiles.set(objectPath(userId, doc), bytes);
    return;
  }
  const res = await fetch(`${SB_URL}/storage/v1/object/${BUCKET}/${objectPath(userId, doc)}`, {
    method: "POST",
    headers: { apikey: SB_KEY!, Authorization: `Bearer ${SB_KEY}`, "Content-Type": doc.contentType, "x-upsert": "false" },
    body: Buffer.from(bytes),
    cache: "no-store",
  });
  if (!res.ok) throw new OnboardingUnavailable(`Document storage rejected the upload (${res.status})`);
}

export async function removeDocument(userId: string, doc: DocumentRecord): Promise<void> {
  const b = backend();
  if (b === "none") throw new OnboardingUnavailable("Document storage is not configured");
  if (b === "development") {
    memoryFiles.delete(objectPath(userId, doc));
    return;
  }
  const res = await fetch(`${SB_URL}/storage/v1/object/${BUCKET}`, {
    method: "DELETE",
    headers: { apikey: SB_KEY!, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prefixes: [objectPath(userId, doc)] }),
    cache: "no-store",
  });
  if (!res.ok) throw new OnboardingUnavailable(`Document storage could not remove the file (${res.status})`);
}

/** Every onboarding case, newest first — for the compliance review queue only. */
export async function listStates(limit = 200): Promise<{ ownerId: string; state: OnboardingState }[]> {
  const b = backend();
  if (b === "none") throw new OnboardingUnavailable("Onboarding storage is not configured");
  if (b === "development") {
    return [...memory.entries()]
      .map(([ownerId, state]) => ({ ownerId, state: structuredClone(state) }))
      .sort((x, y) => (y.state.updatedAt > x.state.updatedAt ? 1 : -1))
      .slice(0, limit);
  }
  const rows = await sbSelect<Row>(TABLE, `select=owner_id,state,updated_at&order=updated_at.desc&limit=${Math.min(Math.max(1, limit), 500)}`);
  return rows.map((r) => ({ ownerId: r.owner_id, state: { ...emptyState(), ...r.state } }));
}

/**
 * A document's bytes, for an authorised compliance reviewer only (the caller
 * enforces the role). Production returns a short-lived signed URL rather than
 * proxying the file; development returns the bytes from memory.
 */
export async function readDocument(userId: string, doc: DocumentRecord): Promise<{ kind: "bytes"; bytes: Uint8Array } | { kind: "url"; url: string }> {
  const b = backend();
  if (b === "none") throw new OnboardingUnavailable("Document storage is not configured");
  if (b === "development") {
    const bytes = memoryFiles.get(objectPath(userId, doc));
    if (!bytes) throw new OnboardingUnavailable("Document not found in the development store");
    return { kind: "bytes", bytes };
  }
  const res = await fetch(`${SB_URL}/storage/v1/object/sign/${BUCKET}/${objectPath(userId, doc)}`, {
    method: "POST",
    headers: { apikey: SB_KEY!, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: 60 }),
    cache: "no-store",
  });
  if (!res.ok) throw new OnboardingUnavailable(`Document storage could not sign the file (${res.status})`);
  const { signedURL } = (await res.json()) as { signedURL: string };
  return { kind: "url", url: `${SB_URL}/storage/v1${signedURL}` };
}

/** Test seam: clears the development store. */
export function resetDevelopmentStore() {
  memory.clear();
  memoryFiles.clear();
}
