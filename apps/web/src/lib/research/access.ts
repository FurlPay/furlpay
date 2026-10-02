// ---------------------------------------------------------------------------
// Verified access to gated research PDFs.
//
//   request  → verification token (emailed)   → grant (short-lived)  → signed URL
//   POST download-requests   POST download-verifications   GET downloads/[grantId]
//
// Properties, and how each is enforced:
//
//   - MAILBOX OWNERSHIP, not identity. Following the emailed link proves the
//     reader controls the address; it says nothing about employment or company.
//   - SINGLE USE. Tokens are stored by sha256 hash only, and consumption is an
//     atomic set-if-absent on a "consumed" marker, so two concurrent clicks on
//     one link cannot both mint a grant.
//   - SHORT-LIVED. Token 30 minutes; grant 10 minutes; signed URL 60 seconds.
//   - BOUND TO ONE REPORT VERSION. A grant names the slug and the objectKey it
//     was issued for and nothing else; there is no path from a grant to any
//     other object in the bucket.
//   - NO PERSONAL DATA IN THE STORE. Records hold an email HASH (for abuse
//     limits), never the address; the lead store (lib/leads) keeps the address
//     under its own retention and consent rules.
//   - NOTHING SECRET IN LOGS. Tokens and grant ids are never logged; log lines
//     carry the slug and a short hash prefix at most.
// ---------------------------------------------------------------------------

import { createHash, randomBytes } from "node:crypto";
import { kvGet, kvSet, kvSetNx } from "@/lib/kv";

export const TOKEN_TTL_SECONDS = 30 * 60;
export const GRANT_TTL_SECONDS = 10 * 60;

const tokenKey = (hash: string) => `research:verify:${hash}`;
const consumedKey = (hash: string) => `research:verify-used:${hash}`;
const grantKey = (id: string) => `research:grant:${id}`;

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
/** 32 random bytes, base64url: unguessable, URL-safe, no padding. */
const randomId = () => randomBytes(32).toString("base64url");
const ID_SHAPE = /^[A-Za-z0-9_-]{43}$/;

interface PendingVerification {
  slug: string;
  objectKey: string;
  emailHash: string;
  createdAt: string;
}

export interface Grant {
  slug: string;
  objectKey: string;
  expiresAt: string;
}

/** Store a pending verification; returns the raw token for the email ONLY. */
export async function issueVerificationToken(input: { slug: string; objectKey: string; email: string }): Promise<string> {
  const token = randomId();
  const record: PendingVerification = {
    slug: input.slug,
    objectKey: input.objectKey,
    emailHash: sha256(input.email.trim().toLowerCase()),
    createdAt: new Date().toISOString(),
  };
  await kvSet(tokenKey(sha256(token)), record, TOKEN_TTL_SECONDS);
  return token;
}

export type ConsumeResult =
  | { ok: true; grantId: string; grant: Grant }
  | { ok: false; reason: "invalid" | "used" };

/**
 * Consume a token exactly once and mint a grant.
 *
 * "invalid" covers malformed, unknown and expired tokens alike — the caller
 * must not be able to tell a guessed token from an expired real one.
 */
export async function consumeVerificationToken(token: string): Promise<ConsumeResult> {
  if (typeof token !== "string" || !ID_SHAPE.test(token)) return { ok: false, reason: "invalid" };
  const hash = sha256(token);
  const pending = await kvGet<PendingVerification>(tokenKey(hash));
  if (!pending) return { ok: false, reason: "invalid" };
  // The atomic step. Whoever sets the marker first wins; every later attempt —
  // a replay, a second tab, a forwarded email — is refused.
  const first = await kvSetNx(consumedKey(hash), new Date().toISOString(), TOKEN_TTL_SECONDS);
  if (!first) return { ok: false, reason: "used" };

  const grantId = randomId();
  const grant: Grant = {
    slug: pending.slug,
    objectKey: pending.objectKey,
    expiresAt: new Date(Date.now() + GRANT_TTL_SECONDS * 1000).toISOString(),
  };
  await kvSet(grantKey(grantId), grant, GRANT_TTL_SECONDS);
  return { ok: true, grantId, grant };
}

/** A live grant, or null for anything malformed, unknown or expired. */
export async function readGrant(grantId: string): Promise<Grant | null> {
  if (typeof grantId !== "string" || !ID_SHAPE.test(grantId)) return null;
  const grant = await kvGet<Grant>(grantKey(grantId));
  if (!grant || Date.parse(grant.expiresAt) <= Date.now()) return null;
  return grant;
}
