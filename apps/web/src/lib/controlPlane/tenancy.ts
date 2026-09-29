import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/apiKeyAuth";
import { sbSelect } from "@/lib/supabase";
import type { ApiScope } from "@/lib/apiKeys";
import { controlPlaneDurable } from "./store";

// ---------------------------------------------------------------------------
// Resolving the tenant, once, in one place.
//
// THE FAILURE THIS EXISTS TO PREVENT. Every control-plane route needs to know
// which organization is asking. If each route derives that itself — from a body
// field, a path parameter, a header — then the tenant becomes something a
// CALLER can influence, and the most common cross-tenant read in the world is a
// route that trusted an `organizationId` in a request.
//
// So: the organization is derived from the AUTHENTICATED CREDENTIAL and from
// nothing else. `cp_organizations.owner_user_id` is unique, so an API key's
// owner resolves to exactly one organization and a route never has to choose.
// There is deliberately no parameter here through which a caller can name a
// different tenant.
//
// WHAT A ROUTE GETS BACK is an organization id it did not choose. Combined with
// the store's tenant-scoped filters, a resource belonging to another tenant is
// not "denied" so much as NOT FOUND — which is also the right thing to say, for
// the reason spelled out in `notFound()` below.
// ---------------------------------------------------------------------------

export interface TenantContext {
  readonly organizationId: string;
  readonly environment: "sandbox" | "live";
  readonly userId: string;
  readonly keyId: string;
}

export type TenantResolution =
  | { readonly ok: true; readonly tenant: TenantContext }
  | { readonly ok: false; readonly res: NextResponse };

interface OrgRow {
  id: string;
  owner_user_id: string;
  environment: "sandbox" | "live";
  status: "ACTIVE" | "SUSPENDED" | "REVOKED";
}

/**
 * Authenticate, then resolve the caller's organization.
 *
 * Returns a ready 4xx on every failure so a route cannot forget to handle one:
 * the `ok: false` branch carries the response rather than a reason the caller
 * would have to translate.
 */
export async function requireTenant(
  req: NextRequest,
  scope: ApiScope
): Promise<TenantResolution> {
  const auth = await requireApiKey(req, { scope });
  if (!auth.ok) return { ok: false, res: auth.res };

  if (!controlPlaneDurable()) {
    return {
      ok: false,
      res: problem(503, "control_plane_unavailable", {
        message:
          "The control plane has no durable backend. Authorization decisions are refused rather " +
          "than made against a store that cannot be revoked or audited afterwards.",
      }),
    };
  }

  let rows: OrgRow[];
  try {
    rows = await sbSelect<OrgRow>(
      "cp_organizations",
      `owner_user_id=eq.${encodeURIComponent(auth.record.userId)}&limit=1`
    );
  } catch {
    return {
      ok: false,
      res: problem(503, "control_plane_unavailable", {
        message: "Organization lookup failed.",
      }),
    };
  }

  const org = rows[0];
  if (!org) {
    return {
      ok: false,
      res: problem(403, "no_organization", {
        message: "This credential is not associated with a control-plane organization.",
      }),
    };
  }
  if (org.status !== "ACTIVE") {
    return {
      ok: false,
      res: problem(403, "organization_inactive", {
        message: `This organization is ${org.status.toLowerCase()}.`,
      }),
    };
  }

  // A live key must not operate a sandbox organization, or vice versa. The two
  // have different verification requirements (resolveAuthority's
  // requireVerifiedPrincipal), so crossing them would silently apply the wrong
  // posture to real money.
  const keyEnv = auth.record.environment === "live" ? "live" : "sandbox";
  if (keyEnv !== org.environment) {
    return {
      ok: false,
      res: problem(403, "environment_mismatch", {
        message: `This key is for the ${keyEnv} environment; the organization is ${org.environment}.`,
      }),
    };
  }

  return {
    ok: true,
    tenant: {
      organizationId: org.id,
      environment: org.environment,
      userId: auth.record.userId,
      keyId: auth.record.keyId,
    },
  };
}

// ── Responses ──────────────────────────────────────────────────────────────

/**
 * A structured error body.
 *
 * One shape everywhere, so a client can branch on `error` rather than parsing
 * prose, and so a route cannot accidentally return an exception message. The
 * `detail` is always something we wrote, never something thrown.
 */
export function problem(
  status: number,
  error: string,
  extra: Record<string, unknown> = {}
): NextResponse {
  return NextResponse.json(
    { error, ...extra },
    { status, headers: { "cache-control": "no-store" } }
  );
}

/**
 * The response for a resource that does not belong to this tenant.
 *
 * DELIBERATELY IDENTICAL to the response for a resource that does not exist.
 * Returning 403 for "exists but not yours" and 404 for "no such thing" turns
 * every id into an existence oracle: an attacker enumerates ids and learns which
 * ones are real in another tenant, which is half of a BOLA attack completed for
 * free. The store's tenant-scoped filters mean we genuinely cannot tell the two
 * apart here, and that is the point rather than a limitation.
 */
export function notFound(resource: string): NextResponse {
  return problem(404, "not_found", {
    message: `No ${resource} with that id.`,
  });
}

/** Success, never cached: these responses describe authority and money. */
export function ok(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}
