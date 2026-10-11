import { createHash } from "node:crypto";
import { getScreeningProvider } from "@/lib/compliance/providers/factory";
import { SCREENING_MAX_AGE_MS, screeningIsFresh, type OnboardingState, type ScreeningResult } from "./onboarding";

// Sanctions screening for business onboarding. Server-only.
//
// IDEMPOTENT: the request key is a hash of exactly what is screened (names,
// entity types, dates of birth, country) plus the provider. Re-running with the
// same inputs reuses the stored result — including a compliance officer's
// decision on it — instead of minting a second, possibly conflicting record.
// Concurrency is handled by the caller (updateState serialises writers).
//
// FAIL-CLOSED: a provider error or timeout records status "failed" ("Screening
// unavailable"). It is never recorded as clear.

export type Subject = { name: string; entityType: "person" | "company"; dateOfBirth?: string };

export function screeningSubjects(state: OnboardingState): Subject[] | null {
  const b = state.business;
  const d = state.details;
  const i = state.identity;
  if (!b || !d || !i) return null;
  return [
    { name: b.legalName, entityType: b.type === "individual" ? "person" : "company" },
    ...(b.tradingName ? [{ name: b.tradingName, entityType: "company" as const }] : []),
    ...d.owners.map((o) => ({ name: o.name, entityType: o.type === "individual" ? ("person" as const) : ("company" as const) })),
    { name: i.representative.fullName, entityType: "person" as const, dateOfBirth: i.representative.dateOfBirth },
  ];
}

export function requestKey(subjects: Subject[], country: string | undefined, provider: string): string {
  const canonical = JSON.stringify({ provider, country: country ?? null, subjects: subjects.map((s) => [s.name.trim().toLowerCase(), s.entityType, s.dateOfBirth ?? null]) });
  return createHash("sha256").update(canonical).digest("hex");
}

/** Results reused for the same inputs within this window; after it, screening runs again. */
export const REUSE_MS = SCREENING_MAX_AGE_MS;
export const SCREENING_TIMEOUT_MS = 10_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("Screening timed out")), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e))
    );
  });
}

export type ScreeningOutcome = { result: ScreeningResult; reused: boolean };

/**
 * Screen the onboarding subjects, or reuse the stored result when the inputs
 * are unchanged and the result is recent and conclusive. Never throws for a
 * provider problem: that becomes status "failed".
 */
export async function runScreening(state: OnboardingState, referenceId: string, now = Date.now(), opts: { force?: boolean } = {}): Promise<ScreeningOutcome | null> {
  const subjects = screeningSubjects(state);
  if (!subjects) return null;
  let provider;
  try {
    provider = await getScreeningProvider();
  } catch (e) {
    return { reused: false, result: failed(subjects.length, "unavailable", "", e) };
  }
  const key = requestKey(subjects, state.business?.country, provider.name);
  const prev = state.screening;
  // force: an officer-requested re-screen always reaches the provider.
  if (!opts.force && prev && prev.requestKey === key && prev.status !== "failed" && screeningIsFresh(prev, now)) {
    return { result: prev, reused: true };
  }
  try {
    const matches: ScreeningResult["matches"] = [];
    const deadline = Date.now() + SCREENING_TIMEOUT_MS;
    for (const s of subjects) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("Screening timed out");
      const r = await withTimeout(
        provider.screenSanctions({ name: s.name, entityType: s.entityType, dateOfBirth: s.dateOfBirth, country: state.business?.country, referenceId }),
        remaining
      );
      for (const h of r.hits) matches.push({ name: s.name, score: h.matchScore, source: h.sources.join(", ") });
    }
    // An officer decision covers exactly the candidates it reviewed. A fresh run
    // over the same inputs that returns the same candidates keeps that decision
    // (otherwise every expiry would send a cleared false positive back to the
    // queue); any new or changed candidate goes to review again.
    const decided = prev && prev.requestKey === key && (prev.status === "cleared_by_review" || prev.status === "confirmed_match") && matches.length > 0 && matchSet(prev.matches) === matchSet(matches);
    return {
      reused: false,
      result: {
        screenedAt: new Date(now).toISOString(),
        list: provider.name === "furlpay" ? "OFAC SDN" : provider.name,
        names: subjects.length,
        matches,
        status: decided ? prev.status : matches.length ? "potential_match" : "clear",
        requestKey: key,
        ...(decided && prev.review ? { review: prev.review } : {}),
      },
    };
  } catch (e) {
    return { reused: false, result: failed(subjects.length, provider.name === "furlpay" ? "OFAC SDN" : provider.name, key, e) };
  }
}

const matchSet = (m: ScreeningResult["matches"]) => JSON.stringify(m.map((x) => [x.name, x.score, x.source]).sort());

function failed(names: number, list: string, key: string, e: unknown): ScreeningResult {
  return {
    screenedAt: new Date().toISOString(),
    list,
    names,
    matches: [],
    status: "failed",
    requestKey: key || undefined,
    error: e instanceof Error && /timed out/i.test(e.message) ? "The screening service timed out." : "The screening service is unavailable.",
  };
}
