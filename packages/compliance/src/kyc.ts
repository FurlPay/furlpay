import { KycResult } from "./types";

// ---------------------------------------------------------------------------
// Step 1 — Identity verification (KYC/KYB).
// LIVE: Persona / Sumsub — ID doc + live facial video vs. global databases,
//       PEP & sanctions screening, in <30s.
// MOCK: deterministic verdict so onboarding flows are reproducible.
// ---------------------------------------------------------------------------

export interface KycInput {
  fullName: string;
  dateOfBirth: string; // YYYY-MM-DD
  documentNumber: string;
  selfieProvided?: boolean;
  provider?: "persona" | "sumsub";
}

// Deterministic hash for reproducible demo verdicts.
function h(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) n = (n * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(n);
}

function ageFrom(dob: string): number {
  const d = new Date(dob);
  if (isNaN(d.getTime())) return 0;
  const diff = Date.now() - d.getTime();
  return Math.floor(diff / (365.25 * 24 * 3600 * 1000));
}

export function verifyIdentity(input: KycInput): KycResult {
  const provider = input.provider ?? "persona";
  const seed = h(input.fullName + input.documentNumber);

  const ageOver18 = ageFrom(input.dateOfBirth) >= 18;
  const faceMatch = input.selfieProvided !== false;
  // Deterministic: doc numbers ending in high hash space simulate a bad doc.
  const documentValid = seed % 20 !== 0;
  const pepSanctionsClear = seed % 37 !== 0;

  const reasons: string[] = [];
  if (!ageOver18) reasons.push("Applicant under 18");
  if (!faceMatch) reasons.push("Face match failed / no selfie");
  if (!documentValid) reasons.push("Document could not be validated");
  if (!pepSanctionsClear) reasons.push("PEP / sanctions list hit");

  const allPass = ageOver18 && faceMatch && documentValid && pepSanctionsClear;
  let status: KycResult["status"] = allPass ? "approved" : "rejected";
  if (allPass && seed % 11 === 0) status = "review"; // occasional manual review

  if (reasons.length === 0) reasons.push("All identity checks passed");

  return {
    status,
    provider,
    inquiryId: `inq_${seed.toString(36)}`,
    checks: { documentValid, faceMatch, pepSanctionsClear, ageOver18 },
    reasons,
    completedInMs: 800 + (seed % 20000),
  };
}
