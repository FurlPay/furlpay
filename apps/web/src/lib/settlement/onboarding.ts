import { z } from "zod";
import { COUNTRIES } from "@/lib/countries";
import { getCountryRule } from "@/lib/compliance/ruleEngine";
import { getCountryFATFStatus, getCountryRiskLevel } from "@/lib/compliance/fatfLists";
import { ASSETS, NETWORKS } from "./model";

// ---------------------------------------------------------------------------
// Business onboarding for the settlement workspace.
//
// The client edits one step at a time; the SERVER owns everything that decides
// whether money can move: which steps are complete, the screening result, the
// document review state, identity status and activation. Nothing on this
// module's output is a placeholder — a check that has not run is "pending", a
// capability that is not configured is "unavailable", and readiness lists the
// exact blockers.
// ---------------------------------------------------------------------------

export const STEPS = ["business", "identity", "details", "compliance", "treasury", "settlement", "review"] as const;
export type StepId = (typeof STEPS)[number];
export const STEP_META: Record<StepId, { title: string; hint: string }> = {
  business: { title: "Business Information", hint: "Tell us about your business" },
  identity: { title: "Verify Identity", hint: "KYC / KYB verification" },
  details: { title: "Business Details", hint: "Ownership and control" },
  compliance: { title: "Compliance & Risk", hint: "Screening and policies" },
  treasury: { title: "Set Up Treasury", hint: "Wallets, virtual accounts" },
  settlement: { title: "Configure Settlement", hint: "Rules and preferences" },
  review: { title: "Review & Activate", hint: "Final verification" },
};
export type StepStatus = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "BLOCKED" | "REQUIRES_ACTION";

/** Countries a business may onboard from: the app's country list minus FATF auto-blocked jurisdictions. */
export const ONBOARDING_COUNTRIES = COUNTRIES.filter((c) => !getCountryRule(c.iso).autoBlock).map((c) => ({ iso: c.iso, name: c.name, dial: c.dial }));
const COUNTRY_CODES = new Set(ONBOARDING_COUNTRIES.map((c) => c.iso));
export const countryName = (iso?: string) => ONBOARDING_COUNTRIES.find((c) => c.iso === iso)?.name ?? iso ?? "";

export const BUSINESS_TYPES = [
  { id: "company", label: "Company", hint: "Corporation, LLC, Ltd" },
  { id: "individual", label: "Individual", hint: "Sole trader, freelancer" },
  { id: "marketplace", label: "Marketplace", hint: "Platform, multi-party" },
  { id: "nonprofit", label: "Non-Profit", hint: "Charity, foundation" },
] as const;
export const INDUSTRIES = [
  "Technology & Software",
  "E-commerce & Retail",
  "Marketplaces & Platforms",
  "Financial Services",
  "Professional Services",
  "Travel & Hospitality",
  "Media & Entertainment",
  "Gaming",
  "Logistics & Supply Chain",
  "Manufacturing",
  "Healthcare",
  "Education",
  "Non-Profit & NGO",
  "Other",
] as const;
export const EMPLOYEE_BANDS = ["1 - 10", "11 - 50", "51 - 200", "201 - 1,000", "1,000+"] as const;
export const REVENUE_BANDS = ["Under $100K", "$100K - $1M", "$1M - $10M", "$10M - $50M", "$50M+"] as const;
export const ID_TYPES = [
  { id: "PASSPORT", label: "Passport" },
  { id: "NATIONAL_ID", label: "National ID Card" },
  { id: "DRIVERS_LICENSE", label: "Driver's License" },
] as const;

/** Documents collected for KYB / KYC. `required` gates the identity step. */
export const DOCUMENTS = {
  incorporation: { label: "Certificate of Incorporation", required: true, group: "business" },
  articles: { label: "Articles of Association", required: true, group: "business" },
  address: { label: "Proof of Business Address", required: true, group: "business" },
  license: { label: "Business License", required: false, group: "business" },
  id_front: { label: "Government ID (front)", required: true, group: "identity" },
  id_back: { label: "Government ID (back)", required: false, group: "identity" },
} as const;
export type DocumentKind = keyof typeof DOCUMENTS;
export const DOCUMENT_KINDS = Object.keys(DOCUMENTS) as DocumentKind[];
export const DOCUMENT_TYPES = ["application/pdf", "image/png", "image/jpeg"] as const;
export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

const text = (max: number) => z.string().trim().min(1, "Required").max(max);
const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal("").transform(() => undefined));
const country = z.string().refine((c) => COUNTRY_CODES.has(c), "Choose a supported country");
const website = z
  .string()
  .trim()
  .max(200)
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === "https:" || u.protocol === "http:";
    } catch {
      return false;
    }
  }, "Enter a full URL, e.g. https://example.com");
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date")
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v && d.getTime() <= Date.now();
  }, "Choose a valid date in the past");

export const businessSchema = z
  .object({
    type: z.enum(["company", "individual", "marketplace", "nonprofit"]),
    legalName: text(160),
    tradingName: optionalText(160),
    country,
    registrationNumber: text(60),
    industry: z.enum(INDUSTRIES),
    website: website.optional().or(z.literal("").transform(() => undefined)),
    address: z
      .object({
        line1: text(160),
        line2: optionalText(160),
        city: text(80),
        region: text(80),
        postalCode: text(20),
      })
      .strict(),
  })
  .strict();

export const identitySchema = z
  .object({
    verification: z.enum(["kyb", "kyc"]),
    representative: z
      .object({
        fullName: text(160),
        dateOfBirth: isoDate.refine((v) => Date.now() - Date.parse(`${v}T00:00:00Z`) >= 18 * 365.25 * 86_400_000, "The representative must be at least 18"),
        email: z.string().trim().email("Enter a valid email").max(200),
        phoneCountry: country,
        phone: z.string().trim().regex(/^[0-9 ()-]{6,20}$/, "Enter a valid phone number"),
        idType: z.enum(["PASSPORT", "NATIONAL_ID", "DRIVERS_LICENSE"]),
        /** Only the last four characters are kept; the full number goes to the verification provider. */
        idNumberLast4: z.string().trim().regex(/^[A-Za-z0-9]{4}$/, "Enter the ID number"),
      })
      .strict(),
  })
  .strict();

export const ownerSchema = z
  .object({
    id: z.string().uuid(),
    name: text(160),
    type: z.enum(["individual", "corporate"]),
    percent: z.number().min(0).max(100),
    role: text(80),
  })
  .strict();

export const detailsSchema = z
  .object({
    incorporationDate: isoDate,
    description: text(500),
    employees: z.enum(EMPLOYEE_BANDS),
    revenue: z.enum(REVENUE_BANDS),
    owners: z
      .array(ownerSchema)
      .min(1, "Add at least one owner")
      .max(20)
      .refine((o) => o.reduce((s, x) => s + x.percent, 0) <= 100.0001, "Ownership cannot exceed 100%")
      .refine((o) => new Set(o.map((x) => x.name.toLowerCase())).size === o.length, "Each owner can be listed once"),
  })
  .strict();

export const treasurySchema = z
  .object({
    networks: z.array(z.enum(NETWORKS)).min(1, "Enable at least one network").max(NETWORKS.length),
    assets: z.array(z.enum(ASSETS)).min(1, "Enable at least one asset").max(ASSETS.length),
    destination: z.enum(["treasury", "virtual_account", "split"]),
  })
  .strict();

export const splitRuleSchema = z
  .object({
    id: z.string().uuid(),
    percent: z.number().int().min(0).max(100),
    destination: z.enum(["treasury", "vendor", "reserve", "custom"]),
    label: text(60),
    assets: z.union([z.literal("all"), z.array(z.enum(ASSETS)).min(1)]),
  })
  .strict();

export const settlementSchema = z
  .object({
    model: z.enum(["treasury", "virtual_account", "split"]),
    rules: z.array(splitRuleSchema).min(1).max(10),
    routing: z
      .array(z.object({ network: z.enum(NETWORKS), enabled: z.boolean(), primary: z.boolean() }).strict())
      .min(1)
      .max(NETWORKS.length),
    preferences: z.object({ autoConversion: z.boolean(), networkOptimization: z.boolean(), complianceChecks: z.literal(true) }).strict(),
    notifications: z.object({ paymentReceived: z.boolean(), payoutSent: z.boolean(), approvalRequired: z.boolean(), dailySummary: z.boolean() }).strict(),
    advanced: z.object({ manualReviewAboveUsd: z.number().int().min(0).max(10_000_000), minimumSettlementUsd: z.number().int().min(0).max(1_000_000) }).strict(),
  })
  .strict()
  .superRefine((s, ctx) => {
    const total = s.rules.reduce((t, r) => t + r.percent, 0);
    if (total !== 100) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rules"], message: `Your settlement rules must total 100% (currently ${total}%).` });
    const enabled = s.routing.filter((r) => r.enabled);
    if (enabled.length === 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["routing"], message: "Enable at least one network." });
    if (s.routing.filter((r) => r.primary).length !== 1 || !s.routing.find((r) => r.primary)?.enabled)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["routing"], message: "Choose exactly one enabled primary network." });
    if (s.model !== "split" && s.rules.length !== 1)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rules"], message: "Only Custom Split uses more than one destination." });
  });

export const STEP_SCHEMAS = {
  business: businessSchema,
  identity: identitySchema,
  details: detailsSchema,
  treasury: treasurySchema,
  settlement: settlementSchema,
} as const;
export type EditableStep = keyof typeof STEP_SCHEMAS;
export const EDITABLE_STEPS = Object.keys(STEP_SCHEMAS) as EditableStep[];

export type DocumentRecord = {
  id: string;
  kind: DocumentKind;
  name: string;
  size: number;
  contentType: (typeof DOCUMENT_TYPES)[number];
  uploadedAt: string;
  /** Set by human review only. Upload alone never approves a document. */
  review: "received" | "approved" | "rejected";
  reviewedBy?: string;
  reviewedAt?: string;
  reviewReason?: string;
};

/**
 *   clear              no candidate above the provider's review threshold
 *   potential_match    candidates found; awaiting FurlPay compliance review
 *   cleared_by_review  a compliance officer reviewed the candidates as false positives
 *   confirmed_match    a compliance officer confirmed a match — onboarding is blocked
 *   failed             the provider errored or timed out; nothing is known
 */
export type ScreeningStatus = "clear" | "potential_match" | "cleared_by_review" | "confirmed_match" | "failed";
export type ScreeningResult = {
  screenedAt: string;
  list: string;
  names: number;
  matches: { name: string; score: number; source: string }[];
  status: ScreeningStatus;
  /** sha256 of the screened subjects + provider: identical inputs reuse the record. */
  requestKey?: string;
  error?: string;
  review?: { by: string; at: string; reason: string };
};

export type ReviewStatus = "not_submitted" | "pending" | "approved" | "rejected" | "changes_requested";
export type ReviewEvent = { at: string; by: string; action: string; reason?: string; target?: string };
export type ComplianceReview = { status: ReviewStatus; submittedAt?: string; decidedAt?: string; decidedBy?: string; reason?: string; history: ReviewEvent[] };

export type OnboardingState = {
  version: 1;
  business?: z.infer<typeof businessSchema>;
  identity?: z.infer<typeof identitySchema>;
  details?: z.infer<typeof detailsSchema>;
  treasury?: z.infer<typeof treasurySchema>;
  settlement?: z.infer<typeof settlementSchema>;
  /** Unfinished form input saved with "Save and continue later". Untrusted: shown back
   *  to the user only, never read by readiness, screening or activation. */
  drafts?: Partial<Record<EditableStep, unknown>>;
  /** Steps the user explicitly finished and the server validated. */
  completed: StepId[];
  documents: DocumentRecord[];
  screening?: ScreeningResult;
  /** Human compliance review of the case. Written only by a compliance officer (never the applicant). */
  review?: ComplianceReview;
  verification?: { provider: string; sessionId: string; startedAt: string };
  activation: { status: "NOT_READY" | "READY" | "ACTIVATING" | "ACTIVE" | "FAILED" | "REQUIRES_ACTION"; at?: string; blockers?: string[]; codes?: BlockerCode[] };
  updatedAt: string;
};

export const emptyState = (): OnboardingState => ({ version: 1, completed: [], documents: [], activation: { status: "NOT_READY" }, updatedAt: new Date().toISOString() });

/** Owners at or above this share are beneficial owners and must be declared. */
export const UBO_THRESHOLD = 25;

export type Facts = {
  /** Personal KYC status from the account (the server's record, not a client claim). */
  kycStatus: "verified" | "pending" | "unverified";
  /** Whether document storage is configured on this deployment. */
  documentStorage: boolean;
  /** Whether an identity verification provider is configured. */
  identityProvider: boolean;
};

const has = (s: OnboardingState, kind: DocumentKind) => s.documents.some((d) => d.kind === kind && d.review !== "rejected");
const approved = (s: OnboardingState, kind: DocumentKind) => s.documents.some((d) => d.kind === kind && d.review === "approved");

/** Server-side prerequisites for marking a step complete, beyond its schema. */
export function stepBlockers(s: OnboardingState, step: StepId): string[] {
  switch (step) {
    case "identity": {
      const missing = DOCUMENT_KINDS.filter((k) => DOCUMENTS[k].required && (s.identity?.verification === "kyc" ? DOCUMENTS[k].group === "identity" : true) && !has(s, k));
      return missing.map((k) => `Upload the ${DOCUMENTS[k].label}.`);
    }
    case "details": {
      const total = (s.details?.owners ?? []).reduce((t, o) => t + o.percent, 0);
      return total < UBO_THRESHOLD ? ["Declare the owners who together hold at least 25% of the business."] : [];
    }
    case "compliance": {
      if (!s.screening) return ["Run sanctions screening."];
      switch (s.screening.status) {
        case "clear":
        case "cleared_by_review":
          return [];
        case "failed":
          return ["Screening unavailable. Run screening again."];
        case "confirmed_match":
          return ["Sanctions screening confirmed a match. This business cannot be onboarded."];
        default:
          return ["Sanctions screening returned a potential match that is awaiting FurlPay compliance review."];
      }
    }
    case "review":
      return [];
    default:
      return [];
  }
}

const ORDER = (step: StepId) => STEPS.indexOf(step);

export function stepStatuses(s: OnboardingState): Record<StepId, StepStatus> {
  const out = {} as Record<StepId, StepStatus>;
  for (const step of STEPS) {
    const prior = STEPS.slice(0, ORDER(step)).filter((p) => p !== "review");
    const priorDone = prior.every((p) => s.completed.includes(p));
    if (step === "review") {
      out[step] = s.activation.status === "ACTIVE" ? "COMPLETED" : priorDone ? (s.activation.status === "REQUIRES_ACTION" ? "REQUIRES_ACTION" : "IN_PROGRESS") : "BLOCKED";
      continue;
    }
    if (s.completed.includes(step)) out[step] = stepBlockers(s, step).length ? "REQUIRES_ACTION" : "COMPLETED";
    else if (!priorDone) out[step] = "BLOCKED";
    else if (step === "compliance" ? Boolean(s.screening) : Boolean((s as Record<string, unknown>)[step])) out[step] = "IN_PROGRESS";
    else out[step] = "NOT_STARTED";
  }
  return out;
}

export function progress(s: OnboardingState) {
  const done = STEPS.filter((st) => (st === "review" ? s.activation.status === "ACTIVE" : s.completed.includes(st))).length;
  return { done, total: STEPS.length, pct: Math.round((done / STEPS.length) * 100) };
}

/** The first step the user has not completed — where "resume" lands. */
export function resumeStep(s: OnboardingState): StepId {
  return STEPS.find((st) => st !== "review" && !s.completed.includes(st)) ?? "review";
}

export type BlockerCode =
  | "business_information_incomplete"
  | "business_details_incomplete"
  | "identity_verification_pending"
  | "identity_provider_not_configured"
  | "documents_missing"
  | "documents_pending_review"
  | "documents_rejected"
  | "document_storage_unavailable"
  | "screening_not_run"
  | "screening_unavailable"
  | "screening_pending_review"
  | "screening_blocked"
  | "compliance_review_pending"
  | "compliance_review_changes_requested"
  | "compliance_review_rejected"
  | "treasury_not_configured"
  | "settlement_not_configured"
  | "settlement_rules_invalid";

export type Check = { id: string; label: string; met: boolean; detail: string; status: "complete" | "pending" | "blocked" | "not_configured"; codes: BlockerCode[] };

/**
 * Activation readiness, computed on the server from stored state + account
 * facts. Every gate is re-derived here; nothing is inferred from "completed"
 * flags alone (settlement rules are re-validated against the schema).
 */
export function readiness(s: OnboardingState, f: Facts): { ready: boolean; checks: Check[]; blockers: BlockerCode[] } {
  const required = DOCUMENT_KINDS.filter((k) => DOCUMENTS[k].required);
  const docs = required.map((k) => s.documents.find((d) => d.kind === k));
  const docCodes: BlockerCode[] = !f.documentStorage
    ? ["document_storage_unavailable"]
    : docs.some((d) => !d)
      ? ["documents_missing"]
      : docs.some((d) => d!.review === "rejected")
        ? ["documents_rejected"]
        : docs.some((d) => d!.review !== "approved")
          ? ["documents_pending_review"]
          : [];

  const sc = s.screening?.status;
  const screeningCodes: BlockerCode[] = !s.screening
    ? ["screening_not_run"]
    : sc === "failed"
      ? ["screening_unavailable"]
      : sc === "potential_match"
        ? ["screening_pending_review"]
        : sc === "confirmed_match"
          ? ["screening_blocked"]
          : [];

  const rv = s.review?.status ?? "not_submitted";
  const reviewCodes: BlockerCode[] = rv === "approved" ? [] : rv === "rejected" ? ["compliance_review_rejected"] : rv === "changes_requested" ? ["compliance_review_changes_requested"] : ["compliance_review_pending"];

  const identityCodes: BlockerCode[] = f.kycStatus === "verified" ? [] : f.identityProvider ? ["identity_verification_pending"] : ["identity_verification_pending", "identity_provider_not_configured"];

  const settlementValid = s.settlement ? settlementSchema.safeParse(s.settlement).success : false;
  const settlementCodes: BlockerCode[] = !s.settlement || !s.completed.includes("settlement") ? ["settlement_not_configured"] : settlementValid ? [] : ["settlement_rules_invalid"];

  const businessCodes: BlockerCode[] = [
    ...(s.completed.includes("business") && s.business ? [] : (["business_information_incomplete"] as BlockerCode[])),
    ...(s.completed.includes("details") && s.details ? [] : (["business_details_incomplete"] as BlockerCode[])),
  ];

  const st = (codes: BlockerCode[], blockedIf: BlockerCode[] = [], notConfiguredIf: BlockerCode[] = []): Check["status"] =>
    codes.length === 0 ? "complete" : codes.some((c) => blockedIf.includes(c)) ? "blocked" : codes.some((c) => notConfiguredIf.includes(c)) ? "not_configured" : "pending";

  const checks: Check[] = [
    {
      id: "business",
      label: "Business verified",
      met: businessCodes.length === 0 && rv === "approved",
      detail: businessCodes.length ? "Business information or details are incomplete." : rv === "approved" ? "Business profile approved by FurlPay compliance." : "Awaiting compliance review of the business profile.",
      status: businessCodes.length ? "pending" : rv === "approved" ? "complete" : rv === "rejected" ? "blocked" : "pending",
      codes: businessCodes,
    },
    {
      id: "identity",
      label: "Identity verified",
      met: identityCodes.length === 0,
      detail: identityCodes.length === 0 ? "Account holder identity is verified." : f.identityProvider ? `Identity verification is ${f.kycStatus}.` : "Identity verification unavailable — no verification provider is configured on this deployment.",
      status: st(identityCodes, [], ["identity_provider_not_configured"]),
      codes: identityCodes,
    },
    {
      id: "screening",
      label: "Sanctions screening clear",
      met: screeningCodes.length === 0,
      detail: !s.screening
        ? "Sanctions screening has not run."
        : sc === "failed"
          ? "Screening unavailable — the screening service did not respond."
          : sc === "potential_match"
            ? "Potential match awaiting compliance review."
            : sc === "confirmed_match"
              ? "Match confirmed by compliance. Onboarding is blocked."
              : sc === "cleared_by_review"
                ? "Potential matches cleared by compliance review."
                : `${s.screening.list}: no matches across ${s.screening.names} names.`,
      status: st(screeningCodes, ["screening_blocked"]),
      codes: screeningCodes,
    },
    {
      id: "documents",
      label: "Documents approved",
      met: docCodes.length === 0,
      detail: !f.documentStorage ? "Document storage is not configured on this deployment." : `${docs.filter((d) => d?.review === "approved").length} of ${required.length} required documents approved.`,
      status: st(docCodes, ["documents_rejected"], ["document_storage_unavailable"]),
      codes: docCodes,
    },
    {
      id: "review",
      label: "Compliance review approved",
      met: reviewCodes.length === 0,
      detail: rv === "approved" ? `Approved ${s.review?.decidedAt ? new Date(s.review.decidedAt).toUTCString() : ""}.` : rv === "rejected" ? `Rejected: ${s.review?.reason ?? ""}` : rv === "changes_requested" ? `Changes requested: ${s.review?.reason ?? ""}` : "Awaiting compliance review.",
      status: st(reviewCodes, ["compliance_review_rejected"]),
      codes: reviewCodes,
    },
    {
      id: "treasury",
      label: "Treasury configured",
      met: s.completed.includes("treasury") && Boolean(s.treasury),
      detail: s.treasury ? `${s.treasury.networks.length} networks · ${s.treasury.assets.length} assets.` : "Not configured.",
      status: s.completed.includes("treasury") && s.treasury ? "complete" : "pending",
      codes: s.completed.includes("treasury") && s.treasury ? [] : ["treasury_not_configured"],
    },
    {
      id: "settlement",
      label: "Settlement rules set",
      met: settlementCodes.length === 0,
      detail: settlementCodes.includes("settlement_rules_invalid") ? "Stored settlement rules are invalid (they must total 100%)." : s.settlement ? `${s.settlement.rules.length} rule${s.settlement.rules.length === 1 ? "" : "s"} totalling 100% · configured, not executing.` : "Not configured.",
      status: st(settlementCodes, ["settlement_rules_invalid"]),
      codes: settlementCodes,
    },
  ];
  const blockers = [...new Set(checks.flatMap((c) => c.codes))];
  return { ready: blockers.length === 0 && checks.every((c) => c.met), checks, blockers };
}

export const BLOCKER_LABEL: Record<BlockerCode, string> = {
  business_information_incomplete: "Business information incomplete",
  business_details_incomplete: "Business details incomplete",
  identity_verification_pending: "Identity verification pending",
  identity_provider_not_configured: "Verification provider not configured",
  documents_missing: "Required documents missing",
  documents_pending_review: "Documents pending approval",
  documents_rejected: "A document was rejected",
  document_storage_unavailable: "Document storage unavailable",
  screening_not_run: "Sanctions screening not run",
  screening_unavailable: "Screening unavailable",
  screening_pending_review: "Screening awaiting compliance review",
  screening_blocked: "Sanctions match confirmed",
  compliance_review_pending: "Awaiting compliance review",
  compliance_review_changes_requested: "Compliance requested changes",
  compliance_review_rejected: "Compliance review rejected",
  treasury_not_configured: "Treasury not configured",
  settlement_not_configured: "Settlement not configured",
  settlement_rules_invalid: "Settlement rules invalid",
};

/** Country-level risk from the FATF lists — the only risk signal the platform computes. */
export function countryRisk(iso?: string) {
  if (!iso) return null;
  return { level: getCountryRiskLevel(iso), fatf: getCountryFATFStatus(iso), rule: getCountryRule(iso) };
}
