// ---------------------------------------------------------------------------
// Which roles members may give themselves, and which they may not.
//
// ── THIS FILE IS A SECURITY BOUNDARY, NOT A PREFERENCE LIST ────────────────
//
// A role picker is an endpoint that grants Discord permissions on request. The
// values arriving from a select menu are attacker-controlled: Discord signs
// that the INTERACTION came from Discord, it does not promise that the payload
// only contains options the menu actually offered. A handler that trusts the
// submitted value and calls "add this role" is one crafted request away from
// handing out Moderator.
//
// So the only roles that can ever be granted are the ones marked
// `selfAssignable` here, and the handler resolves every submitted value
// through this table before touching the Discord API. STAFF AND EARNED ROLES
// ARE DELIBERATELY ABSENT from that set:
//
//   Moderator, Team, Founder  — authority. Granting these on request defeats
//                               the point of having them.
//   Partner                   — a commercial relationship.
//   Early Supporter, Beta Tester, Contributor — claims about history that a
//                               member cannot make true by clicking a button.
//
// Those still exist in the server and are still assigned by hand. They are
// listed below with `selfAssignable: false` precisely so that this file is the
// complete picture rather than a partial one an editor might extend by
// accident.
//
// ── NAMES, NOT IDS ─────────────────────────────────────────────────────────
//
// Roles are matched to the live server BY NAME at runtime. Hard-coding role ids
// would mean this file silently stops working the moment a role is deleted and
// recreated — which is exactly what happens while a server is being set up.
// ---------------------------------------------------------------------------

export type RoleGroup = "identity" | "notify" | "staff" | "system";

/** The role a member receives by passing the captcha gate. Granted only by the
 *  verification flow, never by the picker. */
export const VERIFIED_ROLE_NAME = "Verified";

export interface RoleSpec {
  /** Stable key used in the select menu's value. Never shown to a member. */
  key: string;
  /** The role name in Discord. This is what resolution matches on. */
  name: string;
  /** Shown in the picker. */
  description: string;
  emoji?: string;
  group: RoleGroup;
  /** Whether a member may grant this to themselves. */
  selfAssignable: boolean;
  /** Colour used when the deploy script has to create the role. */
  color?: number;
}

export const ROLE_CATALOG: RoleSpec[] = [
  // ---- What you do. Self-assignable. ----
  {
    key: "developer",
    name: "Developer",
    description: "Building on the FurlPay APIs and SDKs",
    emoji: "💻",
    group: "identity",
    selfAssignable: true,
    color: 0x5865f2,
  },
  {
    key: "investor",
    name: "Investor",
    description: "Investing, or following the raise",
    emoji: "📈",
    group: "identity",
    selfAssignable: true,
    color: 0xf1c40f,
  },
  {
    key: "finance-expert",
    name: "Finance Expert",
    description: "Payments, treasury, accounting or regulation",
    emoji: "🏦",
    group: "identity",
    selfAssignable: true,
    color: 0x2b8a78,
  },
  {
    key: "trader",
    name: "Trader",
    description: "Markets, execution and the daily brief",
    emoji: "📊",
    group: "identity",
    selfAssignable: true,
    color: 0xc0392b,
  },
  {
    key: "builder",
    name: "Builder",
    description: "Shipping a product of your own",
    emoji: "🛠️",
    group: "identity",
    selfAssignable: true,
    color: 0x9b59b6,
  },
  {
    key: "designer",
    name: "Designer",
    description: "Product, brand and interface design",
    emoji: "🎨",
    group: "identity",
    selfAssignable: true,
    color: 0xe84393,
  },
  {
    key: "merchant",
    name: "Merchant",
    description: "Accepting payments with FurlPay",
    emoji: "🧾",
    group: "identity",
    selfAssignable: true,
    color: 0xe67e22,
  },
  {
    key: "traveler",
    name: "Traveler",
    description: "Booking travel with stablecoins",
    emoji: "✈️",
    group: "identity",
    selfAssignable: true,
    color: 0x1abc9c,
  },
  {
    key: "student",
    name: "Student",
    description: "Learning this space — questions welcome",
    emoji: "🎓",
    group: "identity",
    selfAssignable: true,
    color: 0x3498db,
  },

  // ---- What you want pinged for. Self-assignable. ----
  //
  // Separate group because these are NOTIFICATION subscriptions, and mixing
  // them with identity in one menu makes both harder to scan. A member picks
  // who they are once and changes what they are pinged for often.
  {
    key: "notify-announcements",
    name: "Announcements",
    description: "Major FurlPay news only",
    emoji: "📣",
    group: "notify",
    selfAssignable: true,
    color: 0x00e599,
  },
  {
    key: "notify-product",
    name: "Product Updates",
    description: "Releases, changelog and new features",
    emoji: "🚀",
    group: "notify",
    selfAssignable: true,
    color: 0x00b8d9,
  },
  {
    key: "notify-market",
    name: "Market Brief",
    description: "The daily market brief and price cards",
    emoji: "🔔",
    group: "notify",
    selfAssignable: true,
    color: 0xffab00,
  },
  {
    key: "notify-hackathons",
    name: "Hackathons",
    description: "Hackathons, bounties and events",
    emoji: "🏆",
    group: "notify",
    selfAssignable: true,
    color: 0x6554c0,
  },
  {
    key: "notify-grants",
    name: "Grants",
    description: "Grant rounds and funding calls",
    emoji: "🌱",
    group: "notify",
    selfAssignable: true,
    color: 0x36b37e,
  },

  // ---- Staff and earned. NEVER self-assignable. See the header. ----
  { key: "founder", name: "Founder", description: "FurlPay founder", group: "staff", selfAssignable: false },
  { key: "team", name: "Team", description: "FurlPay team", group: "staff", selfAssignable: false },
  { key: "moderator", name: "Moderator", description: "Server moderator", group: "staff", selfAssignable: false },
  { key: "partner", name: "Partner", description: "Commercial partner", group: "staff", selfAssignable: false },
  {
    key: "early-supporter",
    name: "Early Supporter",
    description: "Here from the start",
    group: "staff",
    selfAssignable: false,
  },
  { key: "beta-tester", name: "Beta Tester", description: "Tests pre-release builds", group: "staff", selfAssignable: false },
  { key: "contributor", name: "Contributor", description: "Merged a contribution", group: "staff", selfAssignable: false },

  // ---- Granted by the system, never by a member. ----
  //
  // Verified is what the captcha gate hands out. It is `selfAssignable: false`
  // for the same reason Moderator is: if the picker could grant it, the gate
  // would be decorative — anyone could click past it.
  {
    key: "verified",
    name: VERIFIED_ROLE_NAME,
    description: "Passed the verification captcha",
    emoji: "✅",
    group: "system",
    selfAssignable: false,
    color: 0x00e599,
  },
];

/** Everything a member may grant themselves, in the given group. */
export function selfAssignable(group: "identity" | "notify"): RoleSpec[] {
  return ROLE_CATALOG.filter((r) => r.selfAssignable && r.group === group);
}

/** Every self-assignable role, any group. */
export function allSelfAssignable(): RoleSpec[] {
  return ROLE_CATALOG.filter((r) => r.selfAssignable);
}

/**
 * Look up a submitted value.
 *
 * Returns null for anything not in the catalog AND for anything in it that is
 * not self-assignable — the two cases a caller must treat identically, because
 * "moderator" is a real key and must still be refused.
 */
export function resolveSelfAssignableKey(key: string): RoleSpec | null {
  const spec = ROLE_CATALOG.find((r) => r.key === key);
  if (!spec || !spec.selfAssignable) return null;
  return spec;
}
