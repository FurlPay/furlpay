import type { Metadata } from "next";
import { notFound } from "next/navigation";
import OnboardingApp from "@/components/settlement/onboarding/OnboardingApp";
import { STEPS, type StepId } from "@/lib/settlement/onboarding";

export const metadata: Metadata = {
  title: "Business Onboarding · FurlPay",
  robots: { index: false, follow: false },
};

// /settlement/onboarding           → resumes at the first incomplete step
// /settlement/onboarding/<step>    → that step (blocked steps redirect client-side)
export default async function OnboardingPage({ params }: { params: Promise<{ step?: string[] }> }) {
  const { step } = await params;
  if (step && (step.length > 1 || !STEPS.includes(step[0] as StepId))) notFound();
  return <OnboardingApp step={(step?.[0] as StepId | undefined) ?? null} />;
}
