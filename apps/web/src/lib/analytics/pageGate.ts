import { headers } from "next/headers";
import { NextRequest } from "next/server";
import { requireOpsAdmin } from "@/lib/ops/respond";

export type AdminPageAccess = "admin" | "unauthenticated" | "forbidden";

/**
 * Server-side admin check for /analytics PAGES, run in the layout before any
 * markup is sent. It goes through requireOpsAdmin, the same function every
 * /api/ops/* route uses: session signature and revocation, the admin role,
 * the bootstrap-admin email pin, the guest refusal, and the admin-action
 * audit. A React-only check would hide the page from a non-admin's eyes
 * while still shipping it; this never renders it.
 *
 * The request is rebuilt from the incoming headers (cookie and authorization
 * included) on an internal URL whose PATH is what the audit records. Only the
 * path is meaningful; the host is never used for anything.
 */
export async function adminPageAccess(path: string): Promise<AdminPageAccess> {
  const incoming = await headers();
  const req = new NextRequest(new URL(path, "http://admin-page.invalid"), { headers: new Headers(incoming) });
  const auth = await requireOpsAdmin(req);
  if (auth.ok) return "admin";
  return auth.res.status === 401 ? "unauthenticated" : "forbidden";
}
