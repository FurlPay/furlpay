import type { Metadata } from "next";
import ComplianceShell from "@/components/compliance/ComplianceShell";
import { CaseQueue } from "@/components/compliance/ComplianceOps";

// Access is enforced by /api/compliance/cases (requireRole compliance_officer).
export const metadata: Metadata = { title: "Case Management · FurlPay", robots: { index: false, follow: false } };

export default function CasesPage() {
  return (
    <ComplianceShell>
      <CaseQueue />
    </ComplianceShell>
  );
}
