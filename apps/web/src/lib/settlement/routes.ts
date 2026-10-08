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
  return (SECTION_TAB as Record<string, AppTab | null>)[m[1]] ?? null;
}
