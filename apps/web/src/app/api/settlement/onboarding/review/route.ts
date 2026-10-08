import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { audit } from "@/lib/audit";
import { getAccountDurable } from "@/lib/store";
import { DOCUMENT_KINDS, DOCUMENTS, readiness, type OnboardingState } from "@/lib/settlement/onboarding";
import { listStates, loadState, OnboardingUnavailable, Refusal, updateState } from "@/lib/settlement/onboardingStore";
import { facts, onboardingView } from "@/lib/settlement/onboardingView";

// Compliance review of business onboarding cases. compliance_officer only —
// requireRole checks the LIVE role grant (effectiveRoles), not the session
// claim. A reviewer can never decide their own case. Every decision records
// who, when, what and why, and is audited with the reviewer as the actor.

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const OWNER = /^[A-Za-z0-9_.:@-]{3,128}$/;

function summary(ownerId: string, s: OnboardingState) {
  return {
    ownerId,
    business: s.business ? { legalName: s.business.legalName, country: s.business.country, type: s.business.type } : null,
    review: s.review?.status ?? "not_submitted",
    submittedAt: s.review?.submittedAt ?? null,
    screening: s.screening?.status ?? "not_run",
    documents: { total: s.documents.length, approved: s.documents.filter((d) => d.review === "approved").length, rejected: s.documents.filter((d) => d.review === "rejected").length },
    activation: s.activation.status,
    updatedAt: s.updatedAt,
  };
}

export async function GET(req: NextRequest) {
  const auth = await requireRole(req, "compliance_officer");
  if (!auth.ok) return auth.res;
  const limited = await rateLimitOr429(req, "settlement.review.read", { limit: 120, windowMs: 60_000 }, auth.account.user.id);
  if (limited) return limited;
  const owner = req.nextUrl.searchParams.get("owner");
  try {
    if (owner) {
      if (!OWNER.test(owner)) return NextResponse.json({ error: "Invalid case id" }, { status: 400, headers });
      const [state, applicant] = await Promise.all([loadState(owner), getAccountDurable(owner)]);
      if (!applicant) return NextResponse.json({ error: "Case not found" }, { status: 404, headers });
      return NextResponse.json({ ownerId: owner, self: owner === auth.account.user.id, applicant: { name: applicant.user.name, kycStatus: applicant.user.kycStatus }, ...onboardingView(state, applicant) }, { headers });
    }
    const all = await listStates();
    const scope = req.nextUrl.searchParams.get("scope") === "all" ? "all" : "open";
    const cases = all
      .filter(({ state }) => scope === "all" || state.review?.status === "pending" || state.screening?.status === "potential_match")
      .map(({ ownerId, state }) => ({ ...summary(ownerId, state), self: ownerId === auth.account.user.id }));
    return NextResponse.json({ cases, scope }, { headers });
  } catch (e) {
    return NextResponse.json({ error: e instanceof OnboardingUnavailable ? e.message : "Review queue unavailable" }, { status: 503, headers });
  }
}

const reason = z.string().trim().min(5, "Give a reason (at least 5 characters)").max(1000);
const owner = z.string().regex(OWNER);
const postSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve_document"), owner, documentId: z.string().uuid(), reason: reason.optional() }).strict(),
  z.object({ action: z.literal("reject_document"), owner, documentId: z.string().uuid(), reason }).strict(),
  z.object({ action: z.literal("clear_screening"), owner, reason }).strict(),
  z.object({ action: z.literal("confirm_match"), owner, reason }).strict(),
  z.object({ action: z.literal("approve_case"), owner, reason: reason.optional() }).strict(),
  z.object({ action: z.literal("reject_case"), owner, reason }).strict(),
  z.object({ action: z.literal("request_changes"), owner, reason }).strict(),
]);

export async function POST(req: NextRequest) {
  const auth = await requireRole(req, "compliance_officer");
  if (!auth.ok) return auth.res;
  const reviewer = auth.account.user.id;
  const limited = await rateLimitOr429(req, "settlement.review.decide", { limit: 60, windowMs: 60_000 }, reviewer);
  if (limited) return limited;
  const body = await validateBody(req, postSchema);
  if (body instanceof NextResponse) return body;
  if (body.owner === reviewer) return NextResponse.json({ error: "You cannot review your own onboarding case." }, { status: 403, headers });
  const applicant = await getAccountDurable(body.owner);
  if (!applicant) return NextResponse.json({ error: "Case not found" }, { status: 404, headers });
  const at = new Date().toISOString();
  let event: Parameters<typeof audit>[0] = "settlement.onboarding.review_document_decided";
  try {
    const saved = await updateState(body.owner, (s) => {
      if (s.activation.status === "ACTIVE") throw new Refusal("This account is already active.", 409);
      const r = s.review ?? { status: "not_submitted" as const, history: [] };
      const log = (action: string, target?: string) => (s.review = { ...(s.review ?? r), history: [...(s.review ?? r).history, { at, by: reviewer, action, reason: "reason" in body ? body.reason : undefined, target }] });
      switch (body.action) {
        case "approve_document":
        case "reject_document": {
          const doc = s.documents.find((d) => d.id === body.documentId);
          if (!doc) throw new Refusal("Document not found.", 404);
          doc.review = body.action === "approve_document" ? "approved" : "rejected";
          doc.reviewedBy = reviewer;
          doc.reviewedAt = at;
          doc.reviewReason = body.reason;
          log(body.action, doc.kind);
          event = "settlement.onboarding.review_document_decided";
          return s;
        }
        case "clear_screening":
        case "confirm_match": {
          if (s.screening?.status !== "potential_match") throw new Refusal("There is no potential match awaiting review.", 409);
          s.screening = { ...s.screening, status: body.action === "clear_screening" ? "cleared_by_review" : "confirmed_match", review: { by: reviewer, at, reason: body.reason } };
          log(body.action);
          if (body.action === "confirm_match") s.review = { ...s.review!, status: "rejected", decidedAt: at, decidedBy: reviewer, reason: body.reason };
          event = "settlement.onboarding.review_screening_decided";
          return s;
        }
        case "approve_case": {
          // Approval requires the evidence to be in order — the reviewer cannot approve past a gap.
          const missing = DOCUMENT_KINDS.filter((k) => DOCUMENTS[k].required && !s.documents.some((d) => d.kind === k && d.review === "approved"));
          if (missing.length) throw new Refusal(`Approve the required documents first: ${missing.map((k) => DOCUMENTS[k].label).join(", ")}.`, 409);
          if (!s.screening || !["clear", "cleared_by_review"].includes(s.screening.status)) throw new Refusal("Sanctions screening must be clear (or cleared by review) before approval.", 409);
          if (!s.completed.includes("business") || !s.completed.includes("details")) throw new Refusal("The business profile is incomplete.", 409);
          s.review = { ...r, ...s.review, status: "approved", decidedAt: at, decidedBy: reviewer, reason: body.reason };
          log("approve_case");
          event = "settlement.onboarding.review_approved";
          return s;
        }
        case "reject_case":
          s.review = { ...r, ...s.review, status: "rejected", decidedAt: at, decidedBy: reviewer, reason: body.reason };
          log("reject_case");
          event = "settlement.onboarding.review_rejected";
          return s;
        case "request_changes":
          s.review = { ...r, ...s.review, status: "changes_requested", decidedAt: at, decidedBy: reviewer, reason: body.reason };
          // The applicant must re-confirm identity documents, which re-submits the case.
          s.completed = s.completed.filter((x) => x !== "identity");
          log("request_changes");
          event = "settlement.onboarding.review_changes_requested";
          return s;
      }
    });
    audit(event, reviewer, { owner: body.owner, action: body.action, documentId: "documentId" in body ? body.documentId : undefined });
    return NextResponse.json({ ownerId: body.owner, applicant: { name: applicant.user.name, kycStatus: applicant.user.kycStatus }, ...onboardingView(saved, applicant), readinessForApplicant: readiness(saved, facts(applicant)) }, { headers });
  } catch (e) {
    if (e instanceof Refusal) return NextResponse.json({ error: e.message }, { status: e.status, headers });
    return NextResponse.json({ error: e instanceof OnboardingUnavailable ? e.message : "The decision could not be recorded. Nothing was changed." }, { status: 503, headers });
  }
}
