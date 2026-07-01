import crypto from "crypto";

// Verify Persona's `Persona-Signature` header. Persona sends a hex-encoded
// HMAC-SHA256 over the RAW request body. During secret rotation the header
// contains multiple space-separated `t=<ts>,v1=<sig>` sets — we accept a match
// against any of them, using a constant-time comparison. A bare-hex header
// (no `t=`/`v1=`) is also supported for compatibility.
export function verifyPersonaSignature(
  rawBody: string,
  header: string | null,
  secret: string
): boolean {
  if (!header || !secret) return false;

  const digestBody = hmac(secret, rawBody);

  for (const segment of header.trim().split(/\s+/)) {
    const fields = parseFields(segment);
    const provided = fields.v1 ?? (segment.includes("=") ? undefined : segment);
    if (!provided) continue;

    const accepted = [digestBody];
    // Some Persona configurations sign `${t}.${body}`; accept it when a
    // timestamp is present in the segment.
    if (fields.t) accepted.push(hmac(secret, `${fields.t}.${rawBody}`));

    if (accepted.some((expected) => timingSafeEqualHex(provided, expected))) return true;
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
