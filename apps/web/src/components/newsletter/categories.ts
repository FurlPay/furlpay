import { Package, Wrench, Scale, Lock, Newspaper, type LucideIcon } from "lucide-react";

// One definition of the newsletter categories for every surface that renders
// them (signup card, wallet-style claim page, unsubscribe page). They must
// match `VALID_CATEGORIES` in `@/lib/newsletter` — a client-side id the server
// does not know is rejected by the Zod enum, which used to show up as a bare
// "Validation failed" with no way to tell which list had drifted.

export type CategoryId =
  | "product-updates"
  | "engineering"
  | "policy-changes"
  | "security-bulletins"
  | "weekly-digest";

export interface CategoryDef {
  id: CategoryId;
  Icon: LucideIcon;
  label: string;
  desc: string;
  /** Card-sized wording — the holographic card has ~14 characters to work with. */
  short: string;
}

export const CATEGORIES: readonly CategoryDef[] = [
  {
    id: "product-updates",
    Icon: Package,
    label: "Product Updates",
    desc: "New features, launches",
    short: "PRODUCT",
  },
  {
    id: "engineering",
    Icon: Wrench,
    label: "Engineering",
    desc: "Technical deep-dives, open source",
    short: "ENGINEERING",
  },
  {
    id: "policy-changes",
    Icon: Scale,
    label: "Policy Changes",
    desc: "Terms, privacy, compliance updates",
    short: "POLICY",
  },
  {
    id: "security-bulletins",
    Icon: Lock,
    label: "Security Bulletins",
    desc: "Security advisories, patches",
    short: "SECURITY",
  },
  {
    id: "weekly-digest",
    Icon: Newspaper,
    label: "Weekly Digest",
    desc: "Curated newsletter, market insights",
    short: "DIGEST",
  },
] as const;

export const DEFAULT_CATEGORIES: CategoryId[] = ["product-updates", "weekly-digest"];

/** Deliberately permissive — the server does the authoritative check. This
 *  only exists to avoid a round-trip on an obviously incomplete address. */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
