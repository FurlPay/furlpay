import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ComplianceShell from "@/components/compliance/ComplianceShell";
import { ComplianceModule } from "@/components/compliance/ComplianceViews";
import { isComplianceModule } from "@/lib/compliance/modules";

export const metadata: Metadata = { title: "Compliance · FurlPay", robots: { index: false, follow: false } };

export default async function ComplianceModulePage({ params }: { params: Promise<{ module: string }> }) {
  const { module: id } = await params;
  if (!isComplianceModule(id)) notFound();
  return (
    <ComplianceShell>
      <ComplianceModule id={id} />
    </ComplianceShell>
  );
}
