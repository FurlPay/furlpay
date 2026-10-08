import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import OnboardingApp from "@/components/settlement/onboarding/OnboardingApp";
import { resolveOnboardingSlug } from "@/lib/settlement/routes";

export const metadata: Metadata = {
  title: "Business Onboarding · FurlPay",
  robots: { index: false, follow: false },
};

// /settlement/onboarding                → resumes at the first incomplete step
// /settlement/onboarding/<canonical>    → that step (blocked steps redirect client-side)
// /settlement/onboarding/<alias>        → 308 to the canonical URL (one address per step)
export default async function OnboardingPage({ params }: { params: Promise<{ step?: string[] }> }) {
  const { step } = await params;
  if (!step || step.length === 0) return <OnboardingApp step={null} />;
  if (step.length > 1) notFound();
  const resolved = resolveOnboardingSlug(step[0]);
  if (!resolved) notFound();
  if (resolved.redirect) permanentRedirect(resolved.redirect);
  return <OnboardingApp step={resolved.step} />;
}
