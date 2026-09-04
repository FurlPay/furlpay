import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { audit } from "./audit";
import { kvGet, kvSet, kvDel } from "./kv";
import { log } from "./log";

// ---------------------------------------------------------------------------
// API keys: the credential layer for the developer platform.
//
// THE RAW SECRET IS NEVER STORED. Creation returns it once; what persists is
// a SHA-256 hash. A dump of the key store therefore yields nothing that can
// authenticate, which is the only property that makes "we cannot show you
// that key again" true rather than a UI convention.
//
// SHA-256 rather than bcrypt/argon2 is deliberate and is the same choice
// Stripe and GitHub make for this class of credential. Those functions exist
// to make GUESSING expensive, which matters when the input is a human-chosen
// password drawn from a small space. An API secret here is 32 bytes of CSPRNG
// output; there is no dictionary and no plausible brute force, so the slow
// hash would buy nothing and cost a KDF on every request. What DOES matter is
// that the comparison is constant-time — see `verifyApiKey`.
//
// Key format:   <prefix>_<env>_<keyId>_<secret>
//   prefix  sk | pk | rk        (secret / publishable / restricted)
//   env     live | test         so a sandbox key can never reach live
//   keyId   22 chars, the lookup handle — NOT secret, safe to log and display
//   secret  43 chars, 32 bytes base64url — the only part that authenticates
//
// Splitting the id from the secret is what allows an O(1) lookup followed by
// one constant-time compare. A single opaque blob would force either a scan
// of every key (which leaks timing) or an index on the secret itself (which
// puts the secret back in the database).
//
// Agent keys are NOT here. An agent authenticates by SIGNING requests with an
// Ed25519 key (RFC 9421 — see agentTrustGate/agentPolicy); it holds no bearer
// secret at all, so a stolen agent credential cannot be replayed the way a
// bearer token can. They are a different primitive and share only a UI page.
// ---------------------------------------------------------------------------

export const API_KEY_PREFIXES = ["sk", "pk", "rk"] as const;
export type ApiKeyPrefix = (typeof API_KEY_PREFIXES)[number];

export const API_KEY_ENVIRONMENTS = ["test", "live"] as const;
export type ApiKeyEnvironment = (typeof API_KEY_ENVIRONMENTS)[number];

/**
 * Permissions that a route can actually enforce today.
 *
 * Every entry here is checked by `requireApiKey` at a real call site. Listing
 * a scope the server does not enforce would be worse than listing nothing: it
 * tells an operator they have restricted a credential when they have not.
 */
export const API_SCOPES = [
  "payments:read",
  "payments:create",
  "transfers:read",
  "transfers:create",
  "wallets:read",
  "transactions:read",
  "cards:read",
  "cards:freeze",
  "agents:read",
  "agents:manage",
  "webhooks:read",
  "webhooks:manage",
  "ledger:read",
] as const;
export type ApiScope = (typeof API_SCOPES)[number];

/** Scopes a browser-visible key may hold. A publishable key is public by
 *  definition, so it must never carry a scope that moves money or reads
 *  anything private. */
export const PUBLISHABLE_SCOPES: readonly ApiScope[] = ["payments:read"];

export interface ApiKeyRecord {
  keyId: string;
  userId: string;
  name: string;
  prefix: ApiKeyPrefix;
  environment: ApiKeyEnvironment;
  /** SHA-256 of the current secret, hex. Never the secret itself. */
  secretHash: string;
  /** Last 4 chars of the secret, for display: sk_live_abc…_••••9f21. */
  last4: string;
  scopes: ApiScope[];
  status: "active" | "revoked";
  createdAt: string;
  createdBy: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  lastUsedRoute: string | null;
  lastUsedIp: string | null;
  /** CIDR ranges or bare addresses. Empty = unrestricted. */
  ipAllowlist: string[];
  /** Origins a publishable key may be used from. Empty = unrestricted. */
  originAllowlist: string[];
  /** Set while a rotation grace period is open: the PREVIOUS secret still
   *  authenticates until `rotationGraceUntil`. */
  previousSecretHash: string | null;
  rotationGraceUntil: string | null;
  rotatedAt: string | null;
}

/** The shape safe to return over the wire. Never a hash, never a secret. */
export interface ApiKeyPublic {
  keyId: string;
  name: string;
  prefix: ApiKeyPrefix;
  environment: ApiKeyEnvironment;
  /** Display form, e.g. "sk_live_kQ3f…9f21". Not a credential. */
  masked: string;
  scopes: ApiScope[];
  status: "active" | "revoked" | "expired";
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  lastUsedRoute: string | null;
  ipAllowlist: string[];
  originAllowlist: string[];
  rotationGraceUntil: string | null;
  rotatedAt: string | null;
}

const recordKey = (keyId: string) => `apikey:rec:${keyId}`;
const indexKey = (userId: string) => `apikey:idx:${userId}`;

// ── generation ─────────────────────────────────────────────────────────────

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/**
 * `length` uniformly random base62 characters.
 *
 * BASE62, NOT BASE64URL. base64url's alphabet includes "_", which is this
 * format's field separator — an id or secret containing one would split into
 * the wrong number of parts and make a perfectly valid key unparseable. It
 * also survives a double-click selection and a shell paste without quoting.
 *
 * Rejection sampling rather than `byte % 62`: 256 is not a multiple of 62, so
 * the modulo would make the first 8 characters of the alphabet very slightly
 * likelier than the rest. The bias is tiny, and there is no reason to accept
 * any bias in a credential when discarding the 8 out-of-range values costs
 * nothing.
 */
function base62(length: number): string {
  const LIMIT = 248; // 4 × 62; bytes at or above this are discarded
  let out = "";
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte >= LIMIT) continue;
      out += BASE62[byte % 62];
      if (out.length === length) break;
    }
  }
  return out;
}

/** 22 base62 chars ≈ 131 bits. Public handle, not a secret. */
function newKeyId(): string {
  return base62(22);
}

/** 43 base62 chars ≈ 256 bits. This is the credential. */
function newSecret(): string {
  return base62(43);
}

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function maskedForm(r: Pick<ApiKeyRecord, "prefix" | "environment" | "keyId" | "last4">): string {
  return `${r.prefix}_${r.environment}_${r.keyId.slice(0, 4)}…${r.last4}`;
}

export function effectiveStatus(r: ApiKeyRecord, now = Date.now()): ApiKeyPublic["status"] {
  if (r.status === "revoked") return "revoked";
  if (r.expiresAt && Date.parse(r.expiresAt) <= now) return "expired";
  return "active";
}

export function redactApiKey(r: ApiKeyRecord): ApiKeyPublic {
  return {
    keyId: r.keyId,
    name: r.name,
    prefix: r.prefix,
    environment: r.environment,
    masked: maskedForm(r),
    scopes: r.scopes,
    status: effectiveStatus(r),
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    lastUsedAt: r.lastUsedAt,
    lastUsedRoute: r.lastUsedRoute,
    ipAllowlist: r.ipAllowlist,
    originAllowlist: r.originAllowlist,
    rotationGraceUntil: r.rotationGraceUntil,
    rotatedAt: r.rotatedAt,
  };
}

// ── creation ───────────────────────────────────────────────────────────────

export interface CreateApiKeyInput {
  userId: string;
  name: string;
  prefix: ApiKeyPrefix;
  environment: ApiKeyEnvironment;
  scopes: ApiScope[];
  expiresAt?: string | null;
  ipAllowlist?: string[];
  originAllowlist?: string[];
}

export interface CreatedApiKey {
  record: ApiKeyRecord;
  /** The ONLY time this value exists. Returned to the creator, never stored. */
  secret: string;
}

export async function createApiKey(input: CreateApiKeyInput): Promise<CreatedApiKey> {
  const scopes = normalizeScopes(input.prefix, input.scopes);
  const keyId = newKeyId();
  const secretPart = newSecret();
  const secret = `${input.prefix}_${input.environment}_${keyId}_${secretPart}`;

  for (const cidr of input.ipAllowlist ?? []) {
    if (!isValidCidr(cidr)) throw new Error(`invalid IP or CIDR: ${cidr}`);
  }

  const record: ApiKeyRecord = {
    keyId,
    userId: input.userId,
    name: input.name,
    prefix: input.prefix,
    environment: input.environment,
    // Hash the SECRET PORTION only. The prefix/env/id are public, so binding
    // them into the hash would add no entropy while making rotation and any
    // future re-encoding needlessly fragile.
    secretHash: hashSecret(secretPart),
    last4: secretPart.slice(-4),
    scopes,
    status: "active",
    createdAt: new Date().toISOString(),
    createdBy: input.userId,
    expiresAt: input.expiresAt ?? null,
    revokedAt: null,
    lastUsedAt: null,
    lastUsedRoute: null,
    lastUsedIp: null,
    ipAllowlist: input.ipAllowlist ?? [],
    originAllowlist: input.originAllowlist ?? [],
    previousSecretHash: null,
    rotationGraceUntil: null,
    rotatedAt: null,
  };

  await kvSet(recordKey(keyId), record);
  const index = (await kvGet<string[]>(indexKey(input.userId))) ?? [];
  if (!index.includes(keyId)) await kvSet(indexKey(input.userId), [...index, keyId]);

  audit("apikey.created", input.userId, {
    keyId,
    name: input.name,
    prefix: input.prefix,
    environment: input.environment,
    scopes,
    expiresAt: record.expiresAt,
  });

  return { record, secret };
}

/** A publishable key is world-readable; it may hold only public scopes. This
 *  is enforced here rather than in the UI so that a hand-rolled API call
 *  cannot mint a browser key that reads transactions. */
function normalizeScopes(prefix: ApiKeyPrefix, requested: ApiScope[]): ApiScope[] {
  const unique = [...new Set(requested)].filter((s): s is ApiScope => API_SCOPES.includes(s));
  if (prefix === "pk") {
    return unique.filter((s) => PUBLISHABLE_SCOPES.includes(s));
  }
  if (prefix === "sk") {
    // A secret key is the full-access credential by definition.
    return [...API_SCOPES];
  }
  return unique;
}

// ── verification ───────────────────────────────────────────────────────────

export type ApiKeyAuth =
  | { ok: true; record: ApiKeyRecord }
  | { ok: false; reason: ApiKeyDenial };

export type ApiKeyDenial =
  | "malformed"
  | "unknown_key"
  | "bad_secret"
  | "revoked"
  | "expired"
  | "wrong_environment"
  | "ip_not_allowed"
  | "origin_not_allowed"
  | "insufficient_scope";

export interface VerifyOptions {
  /** Reject a key issued for a different environment than the route serves. */
  environment?: ApiKeyEnvironment;
  requiredScope?: ApiScope;
  ip?: string | null;
  origin?: string | null;
}

/** Split a presented key without trusting any part of it. */
export function parseApiKey(
  presented: string
): { prefix: ApiKeyPrefix; environment: ApiKeyEnvironment; keyId: string; secret: string } | null {
  const parts = presented.split("_");
  if (parts.length !== 4) return null;
  const [prefix, environment, keyId, secret] = parts;
  if (!API_KEY_PREFIXES.includes(prefix as ApiKeyPrefix)) return null;
  if (!API_KEY_ENVIRONMENTS.includes(environment as ApiKeyEnvironment)) return null;
  if (!keyId || !secret) return null;
  return {
    prefix: prefix as ApiKeyPrefix,
    environment: environment as ApiKeyEnvironment,
    keyId,
    secret,
  };
}

/** Constant-time hex comparison that does not leak via length either. */
function hashesEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ba.length !== bb.length || ba.length === 0) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Authenticate a presented key.
 *
 * ORDER MATTERS. The secret is checked before revocation, expiry, IP and
 * scope, so that every failure for a key the caller cannot prove it holds
 * looks identical from outside. Reporting "revoked" for a key whose secret
 * was never supplied would turn this endpoint into an oracle for which key
 * ids exist.
 */
export async function verifyApiKey(presented: string, opts: VerifyOptions = {}): Promise<ApiKeyAuth> {
  const parsed = parseApiKey(presented);
  if (!parsed) return { ok: false, reason: "malformed" };

  const record = await kvGet<ApiKeyRecord>(recordKey(parsed.keyId));
  if (!record) return { ok: false, reason: "unknown_key" };

  const presentedHash = hashSecret(parsed.secret);
  let secretOk = hashesEqual(presentedHash, record.secretHash);

  // A rotation grace period keeps the PREVIOUS secret working for a bounded
  // window so a deploy can roll without a gap of failed requests. It is
  // checked second and only while the window is open.
  if (!secretOk && record.previousSecretHash && record.rotationGraceUntil) {
    if (Date.parse(record.rotationGraceUntil) > Date.now()) {
      secretOk = hashesEqual(presentedHash, record.previousSecretHash);
    }
  }
  if (!secretOk) return { ok: false, reason: "bad_secret" };

  // The prefix and environment are part of the presented string, so a caller
  // could edit them. They must agree with the stored record or the key is a
  // forgery attempt, not a valid credential.
  if (parsed.prefix !== record.prefix || parsed.environment !== record.environment) {
    return { ok: false, reason: "bad_secret" };
  }

  if (record.status === "revoked") return { ok: false, reason: "revoked" };
  if (record.expiresAt && Date.parse(record.expiresAt) <= Date.now()) {
    return { ok: false, reason: "expired" };
  }
  if (opts.environment && record.environment !== opts.environment) {
    return { ok: false, reason: "wrong_environment" };
  }
  if (record.ipAllowlist.length > 0 && !ipAllowed(opts.ip ?? null, record.ipAllowlist)) {
    return { ok: false, reason: "ip_not_allowed" };
  }
  if (record.originAllowlist.length > 0 && !originAllowed(opts.origin ?? null, record.originAllowlist)) {
    return { ok: false, reason: "origin_not_allowed" };
  }
  if (opts.requiredScope && !record.scopes.includes(opts.requiredScope)) {
    return { ok: false, reason: "insufficient_scope" };
  }

  return { ok: true, record };
}

/** Record usage. Best-effort and never on the critical path: a key that
 *  authenticated must not fail because its telemetry write did. */
export async function touchApiKey(
  keyId: string,
  info: { route: string; ip: string | null }
): Promise<void> {
  try {
    const record = await kvGet<ApiKeyRecord>(recordKey(keyId));
    if (!record) return;
    await kvSet(recordKey(keyId), {
      ...record,
      lastUsedAt: new Date().toISOString(),
      lastUsedRoute: info.route,
      lastUsedIp: info.ip,
    });
  } catch (e) {
    log.error("api key touch failed", { keyId, error: (e as Error).message });
  }
}

// ── lifecycle ──────────────────────────────────────────────────────────────

export async function getApiKey(keyId: string): Promise<ApiKeyRecord | null> {
  return kvGet<ApiKeyRecord>(recordKey(keyId));
}

export async function listApiKeys(userId: string): Promise<ApiKeyRecord[]> {
  const index = (await kvGet<string[]>(indexKey(userId))) ?? [];
  const records = await Promise.all(index.map((id) => getApiKey(id)));
  return records.filter((r): r is ApiKeyRecord => r !== null && r.userId === userId);
}

/** Owner-checked read. Every mutation below funnels through this so that a
 *  guessed key id from another account is a 404, not an edit. */
async function ownedKey(userId: string, keyId: string): Promise<ApiKeyRecord | null> {
  const record = await getApiKey(keyId);
  if (!record || record.userId !== userId) return null;
  return record;
}

export async function revokeApiKey(userId: string, keyId: string): Promise<boolean> {
  const record = await ownedKey(userId, keyId);
  if (!record) return false;
  if (record.status !== "revoked") {
    await kvSet(recordKey(keyId), {
      ...record,
      status: "revoked",
      revokedAt: new Date().toISOString(),
      // Revocation closes any rotation window too: a revoked key must not
      // keep authenticating on its previous secret.
      previousSecretHash: null,
      rotationGraceUntil: null,
    });
    audit("apikey.revoked", userId, { keyId, name: record.name, prefix: record.prefix });
  }
  return true;
}

export interface RotateResult {
  record: ApiKeyRecord;
  secret: string;
}

/**
 * Issue a new secret for an existing key.
 *
 * The previous secret keeps working until the grace deadline, so a rotation
 * is a deploy rather than an outage. A zero grace period is honest about
 * being immediate — it is offered, but it is not the default, because
 * silently killing a production credential is the failure this whole flow
 * exists to avoid.
 */
export async function rotateApiKey(
  userId: string,
  keyId: string,
  graceSeconds: number
): Promise<RotateResult | null> {
  const record = await ownedKey(userId, keyId);
  if (!record) return null;
  if (record.status === "revoked") throw new Error("cannot rotate a revoked key");

  const secretPart = newSecret();
  const secret = `${record.prefix}_${record.environment}_${record.keyId}_${secretPart}`;
  const now = Date.now();

  const updated: ApiKeyRecord = {
    ...record,
    secretHash: hashSecret(secretPart),
    last4: secretPart.slice(-4),
    previousSecretHash: graceSeconds > 0 ? record.secretHash : null,
    rotationGraceUntil: graceSeconds > 0 ? new Date(now + graceSeconds * 1000).toISOString() : null,
    rotatedAt: new Date(now).toISOString(),
  };
  await kvSet(recordKey(keyId), updated);

  audit("apikey.rotated", userId, {
    keyId,
    name: record.name,
    graceSeconds,
    graceUntil: updated.rotationGraceUntil,
  });
  return { record: updated, secret };
}

export interface UpdateApiKeyInput {
  name?: string;
  scopes?: ApiScope[];
  expiresAt?: string | null;
  ipAllowlist?: string[];
  originAllowlist?: string[];
}

export async function updateApiKey(
  userId: string,
  keyId: string,
  patch: UpdateApiKeyInput
): Promise<ApiKeyRecord | null> {
  const record = await ownedKey(userId, keyId);
  if (!record) return null;

  for (const cidr of patch.ipAllowlist ?? []) {
    if (!isValidCidr(cidr)) throw new Error(`invalid IP or CIDR: ${cidr}`);
  }

  const updated: ApiKeyRecord = {
    ...record,
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.scopes !== undefined ? { scopes: normalizeScopes(record.prefix, patch.scopes) } : {}),
    ...(patch.expiresAt !== undefined ? { expiresAt: patch.expiresAt } : {}),
    ...(patch.ipAllowlist !== undefined ? { ipAllowlist: patch.ipAllowlist } : {}),
    ...(patch.originAllowlist !== undefined ? { originAllowlist: patch.originAllowlist } : {}),
  };
  await kvSet(recordKey(keyId), updated);

  audit("apikey.updated", userId, {
    keyId,
    name: updated.name,
    changed: Object.keys(patch),
    scopes: updated.scopes,
  });
  return updated;
}

export async function deleteApiKeyRecord(userId: string, keyId: string): Promise<boolean> {
  const record = await ownedKey(userId, keyId);
  if (!record) return false;
  await kvDel(recordKey(keyId));
  const index = (await kvGet<string[]>(indexKey(userId))) ?? [];
  await kvSet(indexKey(userId), index.filter((id) => id !== keyId));
  audit("apikey.deleted", userId, { keyId, name: record.name });
  return true;
}

// ── IP allowlisting ────────────────────────────────────────────────────────

/**
 * Does `ip` fall inside any entry of `allowlist`?
 *
 * FAILS CLOSED. A configured allowlist with an unparseable or absent client
 * IP denies, because the alternative — treating "we could not tell" as "allowed"
 * — makes the control decorative exactly when it is being probed.
 */
export function ipAllowed(ip: string | null, allowlist: string[]): boolean {
  if (allowlist.length === 0) return true;
  if (!ip) return false;
  const addr = parseIp(ip);
  if (!addr) return false;
  return allowlist.some((entry) => cidrContains(entry, addr));
}

interface ParsedIp {
  bytes: Uint8Array; // 4 for IPv4, 16 for IPv6
}

function parseIp(raw: string): ParsedIp | null {
  const value = raw.trim();
  if (value.includes(":")) return parseIpv6(value);
  return parseIpv4(value);
}

function parseIpv4(value: string): ParsedIp | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const bytes = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    if (!/^\d{1,3}$/.test(parts[i])) return null;
    const n = Number(parts[i]);
    if (n > 255) return null;
    bytes[i] = n;
  }
  return { bytes };
}

function parseIpv6(value: string): ParsedIp | null {
  // An IPv4-mapped tail (::ffff:203.0.113.10) is how a v4 client commonly
  // arrives behind a v6 proxy. Normalise it to the v4 form so that an
  // operator's "203.0.113.10" entry matches the request they actually see.
  const mapped = value.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped) return parseIpv4(mapped[1]);

  const halves = value.split("::");
  if (halves.length > 2) return null;

  const expand = (segment: string): string[] => (segment === "" ? [] : segment.split(":"));
  const head = expand(halves[0] ?? "");
  const tail = halves.length === 2 ? expand(halves[1]) : [];
  if (halves.length === 1 && head.length !== 8) return null;
  const fill = 8 - head.length - tail.length;
  if (fill < 0) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? fill : 0).fill("0"), ...tail];
  if (groups.length !== 8) return null;

  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    if (!/^[0-9a-f]{1,4}$/i.test(groups[i])) return null;
    const n = parseInt(groups[i], 16);
    bytes[i * 2] = n >> 8;
    bytes[i * 2 + 1] = n & 0xff;
  }
  return { bytes };
}

export function isValidCidr(entry: string): boolean {
  const [addr, bits] = entry.trim().split("/");
  const parsed = parseIp(addr ?? "");
  if (!parsed) return false;
  if (bits === undefined) return true;
  if (!/^\d{1,3}$/.test(bits)) return false;
  return Number(bits) <= parsed.bytes.length * 8;
}

function cidrContains(entry: string, addr: ParsedIp): boolean {
  const [rawNet, rawBits] = entry.trim().split("/");
  const net = parseIp(rawNet ?? "");
  if (!net) return false;
  // v4 and v6 never match each other; comparing across families would
  // silently truncate one of them.
  if (net.bytes.length !== addr.bytes.length) return false;

  const bits = rawBits === undefined ? net.bytes.length * 8 : Number(rawBits);
  if (!Number.isInteger(bits) || bits < 0 || bits > net.bytes.length * 8) return false;

  const fullBytes = bits >> 3;
  for (let i = 0; i < fullBytes; i++) {
    if (net.bytes[i] !== addr.bytes[i]) return false;
  }
  const remaining = bits & 7;
  if (remaining === 0) return true;
  const mask = (0xff << (8 - remaining)) & 0xff;
  return (net.bytes[fullBytes] & mask) === (addr.bytes[fullBytes] & mask);
}

// ── origin allowlisting (publishable keys) ─────────────────────────────────

/**
 * Origin matching for browser-visible keys.
 *
 * An Origin header is asserted by the browser, not the developer, so this is
 * a defence against a key being lifted onto another site — not a security
 * boundary against a determined attacker with curl. It is documented that way
 * in the UI rather than being sold as access control.
 */
export function originAllowed(origin: string | null, allowlist: string[]): boolean {
  if (allowlist.length === 0) return true;
  if (!origin) return false;
  let host: string;
  try {
    host = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }
  return allowlist.some((entry) => {
    const pattern = entry.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
    if (pattern.startsWith("*.")) {
      const base = pattern.slice(2);
      // "*.example.com" covers a subdomain but NOT the bare apex, which an
      // operator must list separately if they mean it.
      return host.endsWith(`.${base}`);
    }
    return host === pattern;
  });
}

// ── security posture, derived from real records only ───────────────────────

export interface SecurityFinding {
  severity: "warn" | "info";
  code: string;
  message: string;
  keyId?: string;
}

const NINETY_DAYS_MS = 90 * 24 * 3600 * 1000;

/**
 * Recommendations computed from stored records.
 *
 * Every finding below is a fact about a record, not a generic checklist item.
 * A page that always shows "enable IP restrictions" trains its reader to
 * ignore the panel; one that stays empty until something is true is worth
 * looking at.
 */
export function securityFindings(records: ApiKeyRecord[], now = Date.now()): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const live = records.filter((r) => effectiveStatus(r, now) === "active");

  for (const r of live) {
    if (r.prefix === "sk" && r.environment === "live") {
      const age = now - Date.parse(r.rotatedAt ?? r.createdAt);
      if (age > NINETY_DAYS_MS) {
        findings.push({
          severity: "warn",
          code: "stale_secret",
          keyId: r.keyId,
          message: `"${r.name}" has not been rotated in ${Math.floor(age / (24 * 3600 * 1000))} days.`,
        });
      }
      if (r.ipAllowlist.length === 0) {
        findings.push({
          severity: "info",
          code: "no_ip_allowlist",
          keyId: r.keyId,
          message: `"${r.name}" accepts requests from any IP address.`,
        });
      }
    }
    if (r.expiresAt) {
      const remaining = Date.parse(r.expiresAt) - now;
      if (remaining > 0 && remaining < 7 * 24 * 3600 * 1000) {
        findings.push({
          severity: "warn",
          code: "expiring_soon",
          keyId: r.keyId,
          message: `"${r.name}" expires in under 7 days.`,
        });
      }
    }
    if (r.prefix === "pk" && r.originAllowlist.length === 0) {
      findings.push({
        severity: "info",
        code: "no_origin_allowlist",
        keyId: r.keyId,
        message: `"${r.name}" is usable from any origin.`,
      });
    }
    if (r.lastUsedAt === null && now - Date.parse(r.createdAt) > 30 * 24 * 3600 * 1000) {
      findings.push({
        severity: "info",
        code: "never_used",
        keyId: r.keyId,
        message: `"${r.name}" has never been used since it was created.`,
      });
    }
  }
  return findings;
}
