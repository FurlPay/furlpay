import type { Metadata } from "next";
import ComplianceShell from "@/components/compliance/ComplianceShell";
import { ComplianceOverview } from "@/components/compliance/ComplianceViews";

// Access is enforced by /api/compliance/overview (requireRole compliance_officer);
// the page renders nothing case-specific until the server answers.
export const metadata: Metadata = { title: "Compliance & Risk · FurlPay", robots: { index: false, follow: false } };

export default function CompliancePage() {
  return (
    <ComplianceShell>
      <ComplianceOverview />
    </ComplianceShell>
  );
}
