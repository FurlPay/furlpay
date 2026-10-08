import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { audit } from "@/lib/audit";
import { getAccountDurable } from "@/lib/store";
import { effectiveRoles } from "@/lib/compliance/roleGrants";
import { loadState } from "@/lib/settlement/onboardingStore";
import { countryRisk } from "@/lib/settlement/onboarding";
import { allowedActions, applyAction, CaseRefusal, RESOLUTIONS, SEVERITIES, slaState } from "@/lib/compliance/cases";
import { CaseStoreUnavailable, getCase, updateCase } from "@/lib/compliance/caseStore";
import { nextRescreenAt } from "@/lib/compliance/screeningHistory";

// GET  /api/compliance/cases/:id — case detail, timeline and linked evidence.
// POST /api/compliance/cases/:id — an officer action (state machine in lib/compliance/cases).
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const ID = /^[0-9a-f-]{36}$/i;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(req, "compliance_officer");
  if (!auth.ok) return auth.res;
  const me = auth.account.user.id;
  const limited = await rateLimitOr429(req, "compliance.case.read", { limit: 120, windowMs: 60_000 }, me);
  if (limited) return limited;
  const { id } = await params;
  if (!ID.test(id)) return NextResponse.json({ error: "Case not found" }, { status: 404, headers });
  try {
    const c = await getCase(id);
    if (!c) return NextResponse.json({ error: "Case not found" }, { status: 404, headers });
    // Linked evidence: the onboarding case the alert is about (no documents, no PII beyond names).
    let linked: Record<string, unknown> | null = null;
    if (c.refs.onboardingOwner) {
      try {
        const s = await loadState(c.refs.onboardingOwner);
        const risk = countryRisk(s.business?.country);
        linked = {
          business: s.business ? { legalName: s.business.legalName, country: s.business.country, type: s.business.type } : null,
          review: s.review?.status ?? "not_submitted",
          screening: s.screening ? { status: s.screening.status, list: s.screening.list, screenedAt: s.screening.screenedAt, matches: s.screening.matches } : null,
          screeningHistory: s.screeningHistory ?? [],
          nextRescreenAt: nextRescreenAt(s.screening?.screenedAt, risk?.level),
          riskLevel: risk?.level ?? null,
          documents: s.documents.map((d) => ({ id: d.id, kind: d.kind, review: d.review })),
        };
      } catch {
        linked = { unavailable: "Onboarding record unavailable." };
      }
    }
    if (c.refs.transactionIds?.length) {
      const account = await getAccountDurable(c.subjectId);
      const ids = new Set(c.refs.transactionIds);
      linked = { ...(linked ?? {}), transactions: (account?.transactions ?? []).filter((t) => ids.has(t.id)).map((t) => ({ id: t.id, direction: t.direction, amountUsd: t.amountUsd, status: t.status, timestamp: t.timestamp, chain: t.chain ?? null, token: t.token ?? null })) };
    }
    return NextResponse.json({ case: c, sla: slaState(c), allowed: c.subjectId === me ? [] : allowedActions(c), self: c.subjectId === me, linked }, { headers });
  } catch (e) {
    return NextResponse.json({ error: e instanceof CaseStoreUnavailable ? e.message : "Case unavailable" }, { status: 503, headers });
  }
}

const reason = z.string().trim().min(5, "Give a reason (at least 5 characters)").max(1000);
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("triage"), severity: z.enum(SEVERITIES).optional(), reason: reason.optional() }).strict(),
  z.object({ action: z.literal("assign"), assignee: z.string().trim().min(3).max(128).regex(/^[A-Za-z0-9_.:@-]+$/), reason: reason.optional() }).strict(),
  z.object({ action: z.literal("start"), reason: reason.optional() }).strict(),
  z.object({ action: z.literal("escalate"), reason }).strict(),
  z.object({ action: z.literal("request_decision"), reason: reason.optional() }).strict(),
  z.object({ action: z.literal("resolve"), resolution: z.enum(RESOLUTIONS.filter((r) => r !== "source_resolved") as [string, ...string[]]), reason }).strict(),
  z.object({ action: z.literal("close"), reason }).strict(),
  z.object({ action: z.literal("reopen"), reason }).strict(),
  z.object({ action: z.literal("note"), reason }).strict(),
]);

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(req, "compliance_officer");
  if (!auth.ok) return auth.res;
  const me = auth.account.user.id;
  const limited = await rateLimitOr429(req, "compliance.case.act", { limit: 60, windowMs: 60_000 }, me);
  if (limited) return limited;
  const { id } = await params;
  if (!ID.test(id)) return NextResponse.json({ error: "Case not found" }, { status: 404, headers });
  const body = await validateBody(req, actionSchema);
  if (body instanceof NextResponse) return body;
  try {
    if (body.action === "assign") {
      // The assignee must currently hold the compliance officer role (live grants, not a claim).
      const account = await getAccountDurable(body.assignee);
      const roles = account ? await effectiveRoles(account) : [];
      if (!roles.includes("compliance_officer")) return NextResponse.json({ error: "Cases can only be assigned to compliance officers." }, { status: 422, headers });
    }
    const existing = await getCase(id);
    if (!existing) return NextResponse.json({ error: "Case not found" }, { status: 404, headers });
    if (body.action === "assign" && body.assignee === existing.subjectId) return NextResponse.json({ error: "A case cannot be assigned to its own subject." }, { status: 422, headers });
    // A case about an onboarding decision is resolved BY that decision, so the
    // case can never say resolved while the business is still waiting. The
    // source is re-read INSIDE the version-checked write: if the applicant
    // re-submits between the check and the write, the retry sees it.
    const saved = await updateCase(id, async (c) => {
      if (body.action === "resolve" && c.refs.onboardingOwner && (c.type === "kyb_review" || c.type === "sanctions_match")) {
        const src = await loadState(c.refs.onboardingOwner);
        if (c.type === "kyb_review" && src.review?.status === "pending")
          throw new CaseRefusal("Decide the onboarding review first (approve, reject or request changes) in Onboarding Reviews.", 409);
        if (c.type === "sanctions_match" && src.screening?.requestKey === c.refs.screeningKey && src.screening?.status === "potential_match")
          throw new CaseRefusal("Clear or confirm the screening match first in Onboarding Reviews.", 409);
      }
      return applyAction(c, body as never, me);
    });
    audit("compliance.case_action", me, { caseId: id, action: body.action, status: saved.status, resolution: saved.resolution ?? undefined });
    return NextResponse.json({ case: saved, sla: slaState(saved), allowed: allowedActions(saved) }, { headers });
  } catch (e) {
    if (e instanceof CaseRefusal) return NextResponse.json({ error: e.message }, { status: e.status, headers });
    return NextResponse.json({ error: e instanceof CaseStoreUnavailable ? e.message : "The action could not be recorded. Nothing was changed." }, { status: 503, headers });
  }
}
