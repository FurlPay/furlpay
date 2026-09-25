import crypto from "crypto";

// Verify Persona's `Persona-Signature` header. Persona sends a hex-encoded
// HMAC-SHA256 over `${t}.${rawBody}`. During secret rotation the header contains
// multiple SPACE-separated `t=<ts>,v1=<sig>` sets — we accept a match against any
// of them, using a constant-time comparison. A bare-hex header (no `t=`/`v1=`) is
// also supported for compatibility.
//
// REPLAY WINDOW. Persona's documentation specifies no tolerance: as far as the
// provider is concerned, a valid signature is valid forever. That makes a
// captured delivery replayable indefinitely, so the window below is ours rather
// than theirs.
//
// It is enforced ONLY against the `${t}.${body}` form, and that restriction is
// the whole point. In that form the timestamp is inside the HMAC, so it is
// authenticated and cannot be moved forward by an attacker. In the bare-body
// form `t` is not covered by the signature — an attacker replaying such a
// delivery could rewrite `t` freely, so checking it there would be security
// theatre that also risks rejecting legitimate traffic. Bare-body deliveries stay
// protected by the route's idempotency guard instead.
export const PERSONA_TIMESTAMP_TOLERANCE_SECONDS = 300; // 5 min, the industry norm

export function verifyPersonaSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  nowMs: number = Date.now()
): boolean {
  if (!header || !secret) return false;

  const digestBody = hmac(secret, rawBody);

  for (const segment of header.trim().split(/\s+/)) {
    const fields = parseFields(segment);
    const provided = fields.v1 ?? (segment.includes("=") ? undefined : segment);
    if (!provided) continue;

    // The bare-body form: `t` is unauthenticated, so no window is applied.
    if (timingSafeEqualHex(provided, digestBody)) return true;

    if (!fields.t) continue;

    // The documented form. Match the signature FIRST, then apply the window —
    // that order means the window is only ever applied to a timestamp we have
    // just proven the sender authenticated.
    if (!timingSafeEqualHex(provided, hmac(secret, `${fields.t}.${rawBody}`))) continue;

    const t = Number(fields.t);
    if (!Number.isFinite(t)) continue; // an unparseable timestamp is not a pass
    const ageSeconds = Math.abs(nowMs / 1000 - t);
    if (ageSeconds > PERSONA_TIMESTAMP_TOLERANCE_SECONDS) return false;

    return true;
  }
  return false;
}

// Advanced Inquiry Search (June 2026 API) — filters inquiries server-side
// instead of paginating the slower list endpoint.
export async function searchInquiries(query: string): Promise<unknown[]> {
  const res = await fetch("https://withpersona.com/api/v1/inquiries/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.PERSONA_API_KEY ?? ""}`,
      "Content-Type": "application/json",
      "Persona-Version": "2026-06-09",
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`Persona inquiry search failed: ${res.status}`);
  const data = await res.json();
  return data.data ?? [];
}

// KYB — Business Associated Persons report (updated June 22, 2026). Returns the
// list of ultimate beneficial owners (UBOs) so callers can screen each owner
// against TRM Labs / sanctions databases.
export interface KybOwner {
  name: string;
  percentage: number;
  role: string;
  verification_status: string;
}

export async function getBusinessAssociatedPersons(reportId: string): Promise<KybOwner[]> {
  const res = await fetch(`https://withpersona.com/api/v1/reports/${reportId}`, {
    headers: {
      Authorization: `Bearer ${process.env.PERSONA_API_KEY ?? ""}`,
      "Persona-Version": "2026-06-09",
    },
  });
  if (!res.ok) throw new Error(`Persona report fetch failed: ${res.status}`);
  const data = await res.json();
  return data?.data?.attributes?.ownership_information?.owners ?? [];
}

// Screen each UBO against an external risk provider (TRM Labs / sanctions).
// `screen` returns true when the owner is flagged; the caller wires in the real
// provider so this stays dependency-free.
export async function screenOwners(
  owners: KybOwner[],
  screen: (name: string) => Promise<boolean>
): Promise<Array<KybOwner & { flagged: boolean }>> {
  return Promise.all(owners.map(async (o) => ({ ...o, flagged: await screen(o.name) })));
}

function hmac(secret: string, message: string): string {
  return crypto.createHmac("sha256", secret).update(message).digest("hex");
}

function parseFields(segment: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const kv of segment.split(",")) {
    const i = kv.indexOf("=");
    if (i > 0) out[kv.slice(0, i)] = kv.slice(i + 1);
  }
  return out;
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}
