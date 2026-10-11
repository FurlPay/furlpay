/** Compliance workspace sections. Shared by the server route (404 for anything else) and the sidebar. */
export const COMPLIANCE_MODULES = [
  { id: "kyc", label: "KYC Individuals" },
  { id: "kyb", label: "KYB Businesses" },
  { id: "aml", label: "AML & Sanctions" },
  { id: "fraud", label: "Fraud Prevention" },
  { id: "monitoring", label: "Transaction Monitoring" },
  { id: "travel", label: "Travel Rule & Wallets" },
  { id: "india", label: "Aadhaar & India eKYC" },
  { id: "policies", label: "Policies & Rules" },
  { id: "reports", label: "Reports" },
  { id: "settings", label: "Providers & Settings" },
] as const;
export type ComplianceModuleId = (typeof COMPLIANCE_MODULES)[number]["id"];

export function isComplianceModule(id: string): id is ComplianceModuleId {
  return COMPLIANCE_MODULES.some((m) => m.id === id);
}
