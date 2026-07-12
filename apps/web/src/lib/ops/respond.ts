import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireRole, type AuthResult } from "@/lib/authz";

// Ops API envelope + admin gate. Every /api/ops/* handler requires the "admin"
// role and returns the consistent { ok, data|error, meta } shape from the spec.

export interface OpsMeta {
  requestId: string;
  timestamp: string;
}

function meta(): OpsMeta {
  return { requestId: `req_${randomUUID()}`, timestamp: new Date().toISOString() };
}

export function opsOk(data: unknown, status = 200): NextResponse {
  return NextResponse.json({ ok: true, data, meta: meta() }, { status, headers: { "cache-control": "no-store" } });
}

export function opsError(code: string, message: string, status = 400): NextResponse {
  return NextResponse.json({ ok: false, error: { code, message }, meta: meta() }, { status, headers: { "cache-control": "no-store" } });
}

/** requireRole("admin") with the ops envelope on failure. */
export async function requireOpsAdmin(req: NextRequest): Promise<AuthResult> {
  const auth = await requireRole(req, "admin");
  return auth;
}
