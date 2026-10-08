import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { audit } from "@/lib/audit";
import { getIdentityProvider } from "@/lib/compliance/providers/factory";
import { BLOCKER_LABEL, EDITABLE_STEPS, STEP_SCHEMAS, STEPS, countryRisk, readiness, stepBlockers, type OnboardingState, type StepId } from "@/lib/settlement/onboarding";
import { loadState, OnboardingUnavailable, Refusal, updateState } from "@/lib/settlement/onboardingStore";
import { facts, identityProviderConfigured, onboardingView as view } from "@/lib/settlement/onboardingView";
import { runScreening } from "@/lib/settlement/screening";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const unavailable = (msg = "Unable to save. Onboarding storage is unavailable; nothing was saved.") => NextResponse.json({ error: msg }, { status: 503, headers });

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  try {
    return NextResponse.json(view(await loadState(auth.account.user.id), auth.account), { headers });
  } catch (e) {
    if (e instanceof OnboardingUnavailable) return unavailable(e.message);
    return unavailable();
  }
}

const putSchema = z
  .object({
    step: z.enum(EDITABLE_STEPS as [string, ...string[]]),
    data: z.unknown(),
    complete: z.boolean(),
  })
  .strict();

/** Steps whose data identifies people or the entity: editing them invalidates screening and reopens review. */
const SCREENED: StepId[] = ["business", "identity", "details"];
const LOCKED_AFTER_ACTIVATION: StepId[] = ["business", "identity", "details"];
const now = () => new Date().toISOString();

/** Submit (or re-submit) the case for compliance review once identity documents are in. */
function submitForReview(state: OnboardingState, by: string, reason: string) {
  const r = state.review ?? { status: "not_submitted" as const, history: [] };
  if (r.status === "pending") return false;
  if (!state.completed.includes("identity")) return false;
  state.review = { ...r, status: "pending", submittedAt: now(), decidedAt: undefined, decidedBy: undefined, reason: undefined, history: [...r.history, { at: now(), by, action: "submitted", reason }] };
  return true;
}

export async function PUT(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const userId = auth.account.user.id;
  const limited = await rateLimitOr429(req, "settlement.onboarding.save", { limit: 60, windowMs: 60_000 }, userId);
  if (limited) return limited;
  const body = await validateBody(req, putSchema);
  if (body instanceof NextResponse) return body;
  const step = body.step as keyof typeof STEP_SCHEMAS;
  const parsed = STEP_SCHEMAS[step].safeParse(body.data);
  if (!parsed.success && body.complete) {
    return NextResponse.json({ error: "Please fix the highlighted fields.", fields: parsed.error.flatten() }, { status: 422, headers });
  }
  if (!parsed.success && (typeof body.data !== "object" || body.data === null || Array.isArray(body.data))) {
    return NextResponse.json({ error: "Invalid draft." }, { status: 400, headers });
  }
  let blockers: string[] = [];
  const events: [Parameters<typeof audit>[0], Record<string, unknown>][] = [];
  try {
    const saved = await updateState(userId, (state) => {
      if (state.completed.length === 0 && !state.business && !state.drafts) events.push(["settlement.onboarding.started", {}]);
      if (!parsed.success) {
        // "Save and continue later" with an unfinished form: kept as a draft only.
        state.drafts = { ...state.drafts, [step]: body.data };
        return state;
      }
      if (state.activation.status === "ACTIVE" && LOCKED_AFTER_ACTIVATION.includes(step)) {
        throw new Refusal("Verified business details are locked after activation. Contact support to change them.", 409);
      }
      // Required steps cannot be bypassed: every earlier step must already be complete.
      const missing = STEPS.slice(0, STEPS.indexOf(step)).filter((x) => x !== "review" && !state.completed.includes(x));
      if (missing.length) throw new Refusal(`Complete ${missing.map((m) => m.replace(/^\w/, (c) => c.toUpperCase())).join(", ")} first.`, 409);
      const before = JSON.stringify((state as Record<string, unknown>)[step] ?? null);
      const changed = before !== JSON.stringify(parsed.data);
      (state as Record<string, unknown>)[step] = parsed.data;
      if (state.drafts) delete state.drafts[step];
      if (SCREENED.includes(step) && changed) {
        if (state.screening) {
          delete state.screening;
          state.completed = state.completed.filter((x) => x !== "compliance");
        }
        // A material change after approval reopens review; approval was for the old facts.
        if (state.review && state.review.status === "approved") {
          state.review = { ...state.review, status: "pending", submittedAt: now(), history: [...state.review.history, { at: now(), by: userId, action: "reopened", reason: `${step} changed after approval` }] };
          events.push(["settlement.onboarding.review_reopened", { step }]);
        }
      }
      if (step === "settlement" && changed) events.push(["settlement.onboarding.settlement_configuration_updated", { rules: parsed.data && (parsed.data as { rules: unknown[] }).rules.length }]);
      if (state.activation.status !== "ACTIVE") state.activation = { status: "NOT_READY" };
      if (body.complete) {
        blockers = stepBlockers(state, step);
        if (!blockers.length) {
          if (!state.completed.includes(step)) {
            state.completed.push(step);
            events.push(["settlement.onboarding.step_completed", { step }]);
          }
          if (SCREENED.includes(step) && (state.review?.status ?? "not_submitted") !== "approved" && submitForReview(state, userId, `${step} completed`)) {
            events.push(["settlement.onboarding.review_requested", { step }]);
          }
        }
      }
      return state;
    });
    for (const [e, f] of events) audit(e, userId, f);
    const v = view(saved, auth.account);
    if (blockers.length) return NextResponse.json({ error: blockers[0], blockers, ...v }, { status: 409, headers });
    return NextResponse.json(v, { headers });
  } catch (e) {
    return failure(e);
  }
}

function failure(e: unknown) {
  if (e instanceof Refusal) return NextResponse.json({ error: e.message, ...e.extra }, { status: e.status, headers });
  if (e instanceof OnboardingUnavailable) return unavailable(e.message);
  return NextResponse.json({ error: "The request could not be completed. Nothing was changed; try again." }, { status: 503, headers });
}

const postSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("screen") }).strict(),
  z.object({ action: z.literal("complete"), step: z.literal("compliance") }).strict(),
  z.object({ action: z.literal("verify") }).strict(),
  z.object({ action: z.literal("activate") }).strict(),
]);

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const limited = await rateLimitOr429(req, "settlement.onboarding.action", { limit: 20, windowMs: 60_000 }, auth.account.user.id);
  if (limited) return limited;
  const body = await validateBody(req, postSchema);
  if (body instanceof NextResponse) return body;
  const userId = auth.account.user.id;
  try {
    if (body.action === "screen") {
      let outcome: Awaited<ReturnType<typeof runScreening>> = null;
      // Serialised with every other write: concurrent or repeated requests see
      // the previous result and reuse it rather than racing to overwrite it.
      const saved = await updateState(userId, async (state) => {
        outcome = await runScreening(state, userId);
        if (!outcome) throw new Refusal("Complete business information, identity and business details before screening.", 409);
        if (outcome.reused) return state;
        // A compliance decision only survives when the screened inputs are unchanged (same request key).
        state.screening = outcome.result;
        if (outcome.result.status !== "clear") state.completed = state.completed.filter((x) => x !== "compliance");
        if (outcome.result.status === "potential_match" && submitForReview(state, userId, "potential sanctions match")) {
          audit("settlement.onboarding.review_requested", userId, { reason: "screening" });
        }
        return state;
      });
      const o = outcome as Awaited<ReturnType<typeof runScreening>>;
      if (o && !o.reused) {
        audit("settlement.onboarding.screening_requested", userId, { names: o.result.names });
        const e = o.result.status === "failed" ? "settlement.onboarding.screening_failed" : o.result.status === "potential_match" ? "settlement.onboarding.screening_blocked" : "settlement.onboarding.screening_completed";
        audit(e, userId, { names: o.result.names, matches: o.result.matches.length, list: o.result.list });
      }
      const v = view(saved, auth.account);
      if (saved.screening?.status === "failed") return NextResponse.json({ error: `Screening unavailable. ${saved.screening.error ?? ""} Try again.`.trim(), ...v }, { status: 503, headers });
      return NextResponse.json({ ...v, reused: Boolean(o?.reused) }, { headers });
    }

    if (body.action === "complete") {
      const saved = await updateState(userId, (state) => {
        if (!STEPS.slice(0, STEPS.indexOf("compliance")).every((x) => state.completed.includes(x))) throw new Refusal("Complete the earlier steps first.", 409);
        const stepBlock = stepBlockers(state, "compliance");
        if (stepBlock.length) throw new Refusal(stepBlock[0], 409, { blockers: stepBlock });
        if (!state.completed.includes("compliance")) state.completed.push("compliance");
        return state;
      });
      audit("settlement.onboarding.step_completed", userId, { step: "compliance" });
      return NextResponse.json(view(saved, auth.account), { headers });
    }

    if (body.action === "verify") {
      if (!identityProviderConfigured()) return NextResponse.json({ error: "Identity verification unavailable — no verification provider is configured on this deployment." }, { status: 503, headers });
      const current = await loadState(userId);
      if (!current.identity) return NextResponse.json({ error: "Add the authorized representative first." }, { status: 409, headers });
      const provider = await getIdentityProvider();
      const rule = countryRisk(current.business?.country)?.rule;
      const session = await provider.startVerification(userId, { requiredDocs: rule?.requiredDocs ?? [], requiredChecks: rule?.requiredChecks ?? [], referenceId: userId, country: current.business?.country });
      await updateState(userId, (state) => ({ ...state, verification: { provider: provider.name, sessionId: session.sessionId, startedAt: now() } }));
      audit("settlement.onboarding.identity_verification_started", userId, { provider: provider.name });
      return NextResponse.json({ sessionUrl: session.sessionUrl, provider: provider.name }, { headers });
    }

    // activate — readiness is re-derived here from stored state and account facts; client state is never trusted.
    audit("settlement.onboarding.activation_requested", userId, {});
    let result: ReturnType<typeof readiness> | null = null;
    const saved = await updateState(userId, (state) => {
      if (state.activation.status === "ACTIVE") return state;
      result = readiness(state, facts(auth.account));
      state.activation = result.ready
        ? { status: "ACTIVE", at: now() }
        : { status: "REQUIRES_ACTION", at: now(), codes: result.blockers, blockers: result.blockers.map((c) => BLOCKER_LABEL[c]) };
      return state;
    });
    const r = result as ReturnType<typeof readiness> | null;
    if (r && !r.ready) {
      audit("settlement.onboarding.activation_blocked", userId, { blockers: r.blockers });
      return NextResponse.json({ error: "Your account is not ready to activate yet.", eligible: false, blockers: r.blockers, ...view(saved, auth.account) }, { status: 409, headers });
    }
    if (r?.ready) audit("settlement.onboarding.activated", userId, {});
    return NextResponse.json({ eligible: true, blockers: [], ...view(saved, auth.account) }, { headers });
  } catch (e) {
    return failure(e);
  }
}
