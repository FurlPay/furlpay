import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/authz";
import { envReport } from "@/lib/env";

// Admin-only deployment readiness report: which registered env vars are set
// (presence booleans only — values never leave the server) and which
// production-required ones are missing. Backed by the registry in lib/env.ts.

export async function GET(req: NextRequest) {
  const auth = await requireRole(req, "admin");
  if (!auth.ok) return auth.res;
  return NextResponse.json(envReport());
}
