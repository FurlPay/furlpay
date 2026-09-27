import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { requireAnyRole } from "@/lib/authz";
import { noteAccessContext } from "@/lib/ops/accessContextAnomaly";
import { getAccountDurable, findUserByIdentity, findUserByLinkedWallet, type UserAccount } from "@/lib/store";
import {
  getAuthorityRequest,
  redactAuthorityRequest,
  recordAgencyVerification,
  stageDisclosureBundle,
  approveAuthorityDisclosure,
  rejectAuthorityRequest,
  DISCLOSURE_CATEGORIES,
} from "@/lib/compliance/authorityRequest";

export const dynamic = "force-dynamic";

const PatchActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("verify_agency"),
    method: z.enum([
      "agency_switchboard_callback",
      "diplomatic_channel",
      "official_pki_signature",
      "in_person_service",
    ]),
    contactNumberUsed: z.string().trim().min(5).max(100),
    officialReference: z.string().trim().min(2).max(120),
    notes: z.string().trim().max(1000),
  }),
  z.object({
    action: z.literal("stage_bundle"),
    categories: z.array(z.enum(DISCLOSURE_CATEGORIES)).min(1),
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
    justification: z.string().trim().min(10).max(1000),
  }),
  z.object({
    action: z.literal("approve"),
  }),
  z.object({
    action: z.literal("reject"),
    reason: z.string().trim().min(5).max(1000),
  }),
]);

// GET /api/compliance/authority-requests/[id]
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireAnyRole(req, ["compliance_officer", "admin"]);
  if (!auth.ok) return auth.res;

  const { id } = await props.params;
  const request = await getAuthorityRequest(id);
  if (!request) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  // REDACTED. This route returned the raw record, and a staged record carries
  // the fully-populated disclosure package — so the dossier was readable here
  // with no approval and no token. See redactAuthorityRequest.
  return NextResponse.json({ ok: true, request: redactAuthorityRequest(request) });
}

// PATCH /api/compliance/authority-requests/[id]
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireAnyRole(req, ["compliance_officer", "admin"]);
  if (!auth.ok) return auth.res;

  const limited = await rateLimitOr429(req, "compliance.auth_req.patch", {
    limit: 30,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const { id } = await props.params;
  const request = await getAuthorityRequest(id);
  if (!request) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  const body = await validateBody(req, PatchActionSchema);
  if (body instanceof NextResponse) return body;

  // WHERE and WHEN this privileged action happened. Country granularity only —
  // see accessContextAnomaly.ts for why nothing finer is stored. Fire-and-forget:
  // a telemetry write must never fail a statutory workflow step.
  void noteAccessContext({
    actorId: auth.account.user.id,
    country: req.headers.get("x-vercel-ip-country") ?? req.headers.get("cf-ipcountry"),
    action: `authority.${body.action}`,
  });

  const actor = {
    id: auth.account.user.id,
    role: auth.account.user.roles.includes("compliance_officer")
      ? ("compliance_officer" as const)
      : ("admin" as const),
  };

  try {
    if (body.action === "verify_agency") {
      const updated = await recordAgencyVerification(id, actor, {
        method: body.method,
        contactNumberUsed: body.contactNumberUsed,
        officialReference: body.officialReference,
        notes: body.notes,
      });
      return NextResponse.json({ ok: true, request: redactAuthorityRequest(updated) });
    }

    if (body.action === "stage_bundle") {
      // Locate target customer without revealing their presence to unprivileged parties
      let targetAccount: UserAccount | null = null;
      if (request.targetType === "user_id") {
        targetAccount = (await getAccountDurable(request.targetIdentifier)) ?? null;
      } else if (request.targetType === "email") {
        targetAccount = findUserByIdentity({ email: request.targetIdentifier }) ?? null;
      } else if (request.targetType === "phone") {
        targetAccount = findUserByIdentity({ phone: request.targetIdentifier }) ?? null;
      } else if (request.targetType === "wallet_address") {
        targetAccount = findUserByLinkedWallet(request.targetIdentifier) ?? null;
      }



      const updated = await stageDisclosureBundle(
        id,
        actor,
        {
          categories: body.categories,
          startDate: body.startDate,
          endDate: body.endDate,
          justification: body.justification,
        },
        targetAccount
      );
      return NextResponse.json({ ok: true, request: redactAuthorityRequest(updated) });
    }

    if (body.action === "approve") {
      // TWO-PERSON INTEGRITY / DUAL-CONTROL IS ENFORCED INSIDE approveAuthorityDisclosure:
      // An error is thrown if actor.id === request.stagedBy!
      const { request: updated, rawDisclosureToken } = await approveAuthorityDisclosure(id, actor);
      return NextResponse.json({
        ok: true,
        request: redactAuthorityRequest(updated),
        disclosureToken: rawDisclosureToken,
        instructions:
          "Provide this single-use token to the authenticated authority for one-time retrieval. The token expires in 1 hour.",
      });
    }

    if (body.action === "reject") {
      const updated = await rejectAuthorityRequest(id, actor, body.reason);
      return NextResponse.json({ ok: true, request: redactAuthorityRequest(updated) });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "State transition failed.";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }

  return NextResponse.json({ ok: false, error: "Unhandled action" }, { status: 400 });
}
