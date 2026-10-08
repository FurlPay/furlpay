/** URL sections under /settlement. Shared by the server route (validation) and the client shell. */
export const SETTLEMENT_SECTIONS = ["payments", "payouts", "treasury", "virtual-accounts", "compliance", "reconcile", "developers", "reports", "settings"] as const;

/** Top navigation of the Settlement OS. The labels are the canonical tab identities. */
export const APP_TABS = [
  { label: "Overview", href: "/settlement" },
  { label: "Payments", href: "/settlement/payments" },
  { label: "Payouts", href: "/settlement/payouts" },
  { label: "Treasury", href: "/settlement/treasury" },
  { label: "Compliance", href: "/settlement/compliance" },
  { label: "Reconcile", href: "/settlement/reconcile" },
  { label: "Developers", href: "/settlement/developers" },
] as const;
export type AppTab = (typeof APP_TABS)[number]["label"];

/** Sections that live under a top tab without being one (sidebar-only sections). */
const SECTION_TAB: Record<(typeof SETTLEMENT_SECTIONS)[number], AppTab | null> = {
  payments: "Payments",
  payouts: "Payouts",
  treasury: "Treasury",
  "virtual-accounts": "Treasury",
  compliance: "Compliance",
  reconcile: "Reconcile",
  developers: "Developers",
  reports: "Reconcile",
  settings: null,
};

/**
 * The single top tab that is active for a pathname, or null where no top tab
 * applies (onboarding, settings). The one source of truth for the header.
 */
export function navTabFor(pathname: string | null | undefined): AppTab | null {
  const p = (pathname ?? "").replace(/[?#].*$/, "").replace(/\/+$/, "") || "/";
  if (p === "/settlement") return "Overview";
  if (p === "/ops/compliance/reviews" || p.startsWith("/ops/compliance/reviews/")) return "Compliance";
  const m = /^\/settlement\/([^/]+)/.exec(p);
  if (!m || m[1] === "onboarding") return null;
  return Object.hasOwn(SECTION_TAB, m[1]) ? (SECTION_TAB as Record<string, AppTab | null>)[m[1]] : null;
}

/**
 * Onboarding step URLs. The slug is the one canonical URL for a step; the
 * older/shorter aliases permanently redirect to it, so each step has exactly
 * one address.
 */
export const STEP_SLUG = {
  business: "business-information",
  identity: "identity",
  details: "business-details",
  compliance: "compliance",
  treasury: "treasury",
  settlement: "settlement",
  review: "review",
} as const;
export type OnboardingStep = keyof typeof STEP_SLUG;

export const STEP_ALIASES: Record<string, OnboardingStep> = {
  business: "business",
  "verify-identity": "identity",
  details: "details",
  "compliance-risk": "compliance",
  "treasury-setup": "treasury",
  "settlement-configuration": "settlement",
  "review-activate": "review",
};

export const onboardingPath = (step: OnboardingStep) => `/settlement/onboarding/${STEP_SLUG[step]}`;

/** Resolve a URL segment: canonical → the step; alias → the step plus a redirect target; unknown → null. */
export function resolveOnboardingSlug(seg: string): { step: OnboardingStep; redirect: string | null } | null {
  const canonical = (Object.keys(STEP_SLUG) as OnboardingStep[]).find((s) => STEP_SLUG[s] === seg);
  if (canonical) return { step: canonical, redirect: null };
  // Own properties only: "constructor" or "__proto__" must not resolve through the prototype.
  const alias = Object.hasOwn(STEP_ALIASES, seg) ? STEP_ALIASES[seg] : undefined;
  return alias ? { step: alias, redirect: onboardingPath(alias) } : null;
}

/** Second-level pages under each section ("" = the section's only page). Must match SettlementWorkspace SECTIONS. */
export const SECTION_SUBPAGES: Record<(typeof SETTLEMENT_SECTIONS)[number], readonly string[]> = {
  payments: ["transactions", "receive", "links", "invoices", "checkout"],
  payouts: ["send", "batch", "schedules", "approvals", "beneficiaries"],
  treasury: ["balances", "convert", "rules"],
  "virtual-accounts": [""],
  compliance: [""],
  reconcile: [""],
  developers: [""],
  reports: [""],
  settings: [""],
};

/** Short URLs that name an existing page; they redirect rather than duplicate it. */
export const SETTLEMENT_REDIRECTS: Record<string, string> = {
  rules: "/settlement/treasury/rules",
  activity: "/settlement/payments/transactions",
};

export type SettlementPathResult = { kind: "page" } | { kind: "redirect"; to: string } | { kind: "not_found" };

/** Validate /settlement/[[...path]] on the server: every URL is a real page, a redirect, or a 404. */
export function resolveSettlementPath(path: readonly string[]): SettlementPathResult {
  if (path.length === 0) return { kind: "page" };
  if (path.length === 1 && Object.hasOwn(SETTLEMENT_REDIRECTS, path[0])) return { kind: "redirect", to: SETTLEMENT_REDIRECTS[path[0]] };
  if (path.length > 2 || !Object.hasOwn(SECTION_SUBPAGES, path[0])) return { kind: "not_found" };
  const subs = SECTION_SUBPAGES[path[0] as keyof typeof SECTION_SUBPAGES];
  if (path.length === 1) return { kind: "page" };
  return subs.includes(path[1]) && path[1] !== "" ? { kind: "page" } : { kind: "not_found" };
}
