import type { DeploymentEnvironment } from "@/lib/settlement/environment";
import type { BlockerCode, Check, Facts, OnboardingState, StepId, StepStatus } from "@/lib/settlement/onboarding";
import type { RiskLevel } from "@/lib/compliance/providers/types";
import type { CountryRule } from "@/lib/compliance/ruleEngine";

/** What GET/PUT/POST /api/settlement/onboarding return. Every field is server-computed. */
export type OnboardingView = {
  state: OnboardingState;
  steps: Record<StepId, StepStatus>;
  progress: { done: number; total: number; pct: number };
  resume: StepId;
  readiness: { ready: boolean; checks: Check[]; blockers: BlockerCode[] };
  facts: Facts;
  storage: "supabase" | "development" | "none";
  risk: { level: RiskLevel; fatf: "black" | "grey" | "clear"; rule: CountryRule } | null;
  account: { name: string };
  environment: DeploymentEnvironment;
};
