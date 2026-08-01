import type { TravelDocument } from "./documents";

export * from "./documents";

// ---------------------------------------------------------------------------
// Travel-document storage.
//
// Keyed by user id, never a flat list. Two routes in this repo shipped as a
// single process-global array shared by every caller, which meant any
// authenticated user could read every other user's rows. For passport data
// that failure mode is not a bug report, it is a notifiable incident — so the
// SHAPE prevents it rather than a filter in each caller.
//
// In-memory today, matching the rest of the demo store. The durable version
// belongs in Postgres behind migration 0016 with row-level security on
// user_id; the interface below is deliberately narrow so that swap touches
// only this file.
// ---------------------------------------------------------------------------

/** Storage row — a TravelDocument plus the provider session that created it. */
export interface StoredDocument extends TravelDocument {
  /** Correlates a provider callback back to this row. */
  sessionId: string;
}

const g = globalThis as unknown as { __travelDocs?: Map<string, StoredDocument[]> };
const byUser = g.__travelDocs ?? (g.__travelDocs = new Map<string, StoredDocument[]>());

function bucket(userId: string): StoredDocument[] {
  const existing = byUser.get(userId);
  if (existing) return existing;
  const fresh: StoredDocument[] = [];
  byUser.set(userId, fresh);
  return fresh;
}

export function listDocuments(userId: string): StoredDocument[] {
  return [...bucket(userId)].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/**
 * One document by id, scoped to its owner.
 *
 * Returns undefined when the document does not exist OR belongs to someone
 * else — the caller cannot distinguish the two, so a 404 does not confirm that
 * an id is real. Enumerating other users' document ids is exactly the probe
 * this shape refuses to answer.
 */
export function getDocument(userId: string, id: string): StoredDocument | undefined {
  return bucket(userId).find((d) => d.id === id);
}

export function putDocument(doc: StoredDocument): void {
  const rows = bucket(doc.userId);
  const i = rows.findIndex((d) => d.id === doc.id);
  if (i >= 0) rows[i] = doc;
  else rows.push(doc);
}

/** Patch a document in place. Whitelisted fields only — callers pass user
 *  input, and spreading it would be mass assignment onto a verified record. */
export function updateDocument(
  userId: string,
  id: string,
  patch: { label?: string; isPrimary?: boolean }
): StoredDocument | undefined {
  const doc = getDocument(userId, id);
  if (!doc) return undefined;

  if (patch.label !== undefined) doc.label = patch.label;
  if (patch.isPrimary === true) {
    // Primary is exclusive: promoting one demotes the rest, or the UI ends up
    // with two "primary" travel documents and no way to choose between them.
    for (const other of bucket(userId)) other.isPrimary = other.id === id;
  }
  return doc;
}

/** Hard delete. A soft delete would leave document metadata in memory after a
 *  user asked for it to be gone, which is not what "remove" means to them and
 *  not what GDPR erasure means to a regulator. */
export function deleteDocument(userId: string, id: string): boolean {
  const rows = bucket(userId);
  const i = rows.findIndex((d) => d.id === id);
  if (i < 0) return false;
  const [removed] = rows.splice(i, 1);
  // Promote another document so the wallet is never left with no primary.
  if (removed.isPrimary && rows.length) rows[0].isPrimary = true;
  return true;
}

/** Resolve a pending row from a provider callback. Scans all users because a
 *  webhook knows the session, not the account. */
export function findBySession(sessionId: string): StoredDocument | undefined {
  for (const rows of byUser.values()) {
    const hit = rows.find((d) => d.sessionId === sessionId);
    if (hit) return hit;
  }
  return undefined;
}
