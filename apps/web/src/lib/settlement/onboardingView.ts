import type { UserAccount } from "@/lib/store";
import { countryRisk, progress, readiness, resumeStep, stepStatuses, type Facts, type OnboardingState } from "./onboarding";
import { backend } from "./onboardingStore";
import { deploymentEnvironment } from "./environment";

// Server-only: the facts readiness is computed from, and the payload the
// onboarding UI renders. Shared by the applicant route and the review route so
// both see exactly the same gates.

export function identityProviderConfigured(env: Record<string, string | undefined> = process.env): boolean {
  const name = env.COMPLIANCE_IDENTITY_PROVIDER || "persona";
  return name === "sumsub" ? Boolean(env.SUMSUB_APP_TOKEN && env.SUMSUB_SECRET_KEY) : Boolean(env.PERSONA_API_KEY);
}

export function facts(account: Pick<UserAccount, "user">): Facts {
  return { kycStatus: account.user.kycStatus, documentStorage: backend() !== "none", identityProvider: identityProviderConfigured() };
}

export function onboardingView(state: OnboardingState, account: Pick<UserAccount, "user">) {
  const f = facts(account);
  return {
    state,
    steps: stepStatuses(state),
    progress: progress(state),
    resume: resumeStep(state),
    readiness: readiness(state, f),
    facts: f,
    storage: backend(),
    risk: countryRisk(state.business?.country),
    account: { name: account.user.name },
    environment: deploymentEnvironment(),
  };
}
