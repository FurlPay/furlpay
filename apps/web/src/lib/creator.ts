// Creator Program derivation — turns a raw application into the tier, referral
// code, Travel Shop link and dashboard view the /ambassadors/dashboard page
// renders. Mock-safe: earnings, clicks and payouts are seeded deterministically
// from the creator's email, so the same creator always sees stable numbers
// across reloads without a database. Wire the real on-chain endpoints
// (/api/ledger, /api/chain, /api/payments) in place of buildCreatorView's
// generated figures once live attribution data exists.

export interface CreatorApplication {
  name: string;
  email: string;
  platform: string;
  handle: string;
  audience: string;
  niche?: string;
  wallet?: string;
  // Profile fields — set at apply-time or edited later from the dashboard.
  bio?: string;
  avatarUrl?: string; // data: URL (mock store) or hosted URL
  country?: string;
  website?: string;
  handleVerified?: boolean; // confirmed via Instagram business_discovery sync
  at?: string;
  updatedAt?: string;
}

// Editable profile fields a creator can change from their dashboard.
export const EDITABLE_PROFILE_FIELDS = ["name", "bio", "avatarUrl", "country", "website", "wallet"] as const;
export type EditableProfileField = (typeof EDITABLE_PROFILE_FIELDS)[number];

export interface Tier {
  name: "Explorer" | "Voyager" | "Pioneer";
  commission: number; // percent
  cashback: number; // percent to followers
}

export interface CreatorLink {
  label: string;
  url: string;
  clicks: number;
  bookings: number;
  usdc: number;
}

export interface CreatorPayout {
  date: string; // ISO date
  amountUsdc: number;
  chain: string;
  txHash: string;
  explorerUrl: string;
  status: "Paid" | "Processing";
}

export interface FollowerProfile {
  name: string;
  email: string;
  avatarUrl?: string;
  handle?: string;
}

export interface CreatorView {
  name: string;
  email: string;
  handle?: string;
  platform?: string;
  wallet?: string;
  bio?: string;
  avatarUrl?: string;
  country?: string;
  website?: string;
  handleVerified: boolean;
  kycVerified: boolean;
  tier: Tier;
  referralCode: string;
  travelShopUrl: string;
  nextPayoutDate: string; // ISO date of the coming Monday
  earnings: {
    pendingUsdc: number; // accruing this week
    clearedUsdc: number; // ready for next Monday
    paidOutUsdc: number; // lifetime settled
    lifetimeUsdc: number;
  };
  month: { clicks: number; bookings: number; conversion: number };
  followerCashbackUsdc: number;
  voyager: { bookings: number; bookingsTarget: number; followers: number; followersTarget: number; unlocked: boolean };
  links: CreatorLink[];
  payouts: CreatorPayout[];
  followers: FollowerProfile[];
  following: FollowerProfile[];
  followingEmails: string[]; // real follow-graph only (lowercased) — drives follow buttons
  isFollowing?: boolean;
}


const TIERS: Record<Tier["name"], Tier> = {
  Explorer: { name: "Explorer", commission: 6, cashback: 2 },
  Voyager: { name: "Voyager", commission: 8, cashback: 2 },
  Pioneer: { name: "Pioneer", commission: 10, cashback: 2 },
};

// Lower bound of an audience band. Bands read "1,000 – 10,000" etc.; the tier
// is decided by the *lower* number, so we parse the first numeric group.
// "Under 1,000" has no meaningful floor → 0. Handles "10k"/"100k" shorthand.
function bandFloor(audience: string): number {
  const a = (audience || "").toLowerCase().trim();
  if (a.startsWith("under") || a === "") return 0;
  const m = a.match(/([\d,.]+)\s*(k)?/);
  if (!m) return 0;
  let n = parseFloat(m[1].replace(/,/g, ""));
  if (m[2] === "k") n *= 1_000;
  return Math.round(n);
}

// Audience band → the tier a creator auto-qualifies for on signup. Everyone
// starts earning as at least Explorer; higher follower brackets upgrade
// immediately (mirrors the auto-upgrade rule on the /ambassadors page).
//   < 1,000 → Explorer · 1,000–9,999 → Voyager · ≥ 10,000 → Pioneer
export function tierFor(audience: string): Tier {
  const floor = bandFloor(audience);
  if (floor >= 10_000) return TIERS.Pioneer;
  if (floor >= 1_000) return TIERS.Voyager;
  return TIERS.Explorer;
}

// Approximate follower floor implied by the selected audience band — used to
// draw the "progress to next tier" bar. Explorer bands get a nominal 250.
function followerFloor(audience: string): number {
  return bandFloor(audience) || 250;
}

// ── Deterministic pseudo-randomness, seeded from the email ───────────────────

function hashString(s: string): number {
  let h = 2166136261 >>> 0; // FNV-1a
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexFrom(rng: () => number, len: number): string {
  let out = "";
  const chars = "0123456789abcdef";
  for (let i = 0; i < len; i++) out += chars[Math.floor(rng() * 16)];
  return out;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// Referral code, e.g. "FURL-7A2C9" — stable per creator.
export function referralCode(name: string, email: string): string {
  const rng = mulberry32(hashString(email.toLowerCase() + "|" + name.toLowerCase()));
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous 0/O/1/I
  let code = "";
  for (let i = 0; i < 5; i++) code += chars[Math.floor(rng() * chars.length)];
  return `FURL-${code}`;
}

export function travelShopUrl(code: string): string {
  return `https://furlpay.com/travel?ref=${encodeURIComponent(code)}`;
}

// Next calendar Monday (payouts settle weekly on Mondays). Pass a reference
// date for testability; defaults to now.
export function nextMonday(from = new Date()): Date {
  const d = new Date(from);
  const day = d.getDay(); // 0 Sun … 6 Sat
  const delta = (8 - day) % 7 || 7; // days until the coming Monday (never today)
  d.setDate(d.getDate() + delta);
  d.setHours(9, 0, 0, 0);
  return d;
}

const MOCK_PROFILES: FollowerProfile[] = [
  { name: "Sarah Chen", email: "sarah.chen@travel.io", handle: "sarah_explorer" },
  { name: "Marcus Vance", email: "marcus@vanceventures.co", handle: "marcus_wanders" },
  { name: "Elena Rostova", email: "elena.ro@globe.com", handle: "elena_travels" },
  { name: "Kenji Sato", email: "sato.kenji@tokyo.net", handle: "kenji_ryokans" },
  { name: "Chloe Dupont", email: "chloe@parisguide.fr", handle: "chloe_dupont" },
];

export function isFollowing(follower: string, following: string): boolean {
  const f = ((globalThis as any).__follows || {}) as Record<string, string[]>;
  const list = f[follower.toLowerCase()] || [];
  return list.includes(following.toLowerCase());
}

export function getFollowers(email: string): FollowerProfile[] {
  const cleanEmail = email.toLowerCase();
  const f = ((globalThis as any).__follows || {}) as Record<string, string[]>;
  const list: FollowerProfile[] = [];
  
  for (const [follower, followings] of Object.entries(f)) {
    if (followings.includes(cleanEmail)) {
      const stored = ((globalThis as any).__ambassadors || []).find(
        (a: any) => a.email.toLowerCase() === follower.toLowerCase()
      );
      if (stored) {
        list.push({
          name: stored.name,
          email: stored.email,
          avatarUrl: stored.avatarUrl,
          handle: stored.handle,
        });
      } else {
        const local = follower.split("@")[0] || "Creator";
        const name = local.replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
        list.push({ name, email: follower });
      }
    }
  }
  return list;
}

export function getFollowing(email: string): FollowerProfile[] {
  const cleanEmail = email.toLowerCase();
  const f = ((globalThis as any).__follows || {}) as Record<string, string[]>;
  const followings = f[cleanEmail] || [];
  const list: FollowerProfile[] = [];

  for (const following of followings) {
    const stored = ((globalThis as any).__ambassadors || []).find(
      (a: any) => a.email.toLowerCase() === following.toLowerCase()
    );
    if (stored) {
      list.push({
        name: stored.name,
        email: stored.email,
        avatarUrl: stored.avatarUrl,
        handle: stored.handle,
      });
    } else {
      const local = following.split("@")[0] || "Creator";
      const name = local.replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
      list.push({ name, email: following });
    }
  }
  return list;
}

// Build the full dashboard view. All financial figures are deterministic
// functions of the email seed and the creator's tier.
export function buildCreatorView(app: CreatorApplication, viewerEmail?: string): CreatorView {
  const tier = tierFor(app.audience);
  const seed = hashString(app.email.toLowerCase());
  const rng = mulberry32(seed);

  // Tier multiplier: higher tiers move more volume.
  const mult = tier.name === "Pioneer" ? 3.4 : tier.name === "Voyager" ? 1.8 : 1;

  const clicks = Math.floor((120 + rng() * 900) * mult);
  const bookings = Math.max(1, Math.floor(clicks * (0.03 + rng() * 0.05)));
  const conversion = round2((bookings / clicks) * 100);

  const avgBookingUsd = 180 + rng() * 420;
  const commissionRate = tier.commission / 100;

  const paidOutUsdc = round2(bookings * avgBookingUsd * commissionRate * (2 + rng() * 6));
  const clearedUsdc = round2(avgBookingUsd * commissionRate * (2 + rng() * 5));
  const pendingUsdc = round2(avgBookingUsd * commissionRate * (0.5 + rng() * 3));
  const lifetimeUsdc = round2(paidOutUsdc + clearedUsdc + pendingUsdc);

  const followerCashbackUsdc = round2(bookings * avgBookingUsd * 0.02 * (0.3 + rng() * 0.7));

  // Per-channel deep links.
  const linkTargets: [string, string][] = [
    ["Hotels & stays", "/travel/stays"],
    ["Flights", "/travel/flights"],
    ["Destinations", "/travel/destinations"],
    ["Your Travel Shop", "/travel"],
  ];
  const code = referralCode(app.name, app.email);
  const links: CreatorLink[] = linkTargets.map(([label, path]) => {
    const lc = Math.max(3, Math.floor(clicks * (0.1 + rng() * 0.35)));
    const lb = Math.max(0, Math.floor(lc * (0.02 + rng() * 0.06)));
    return {
      label,
      url: `https://furlpay.com${path}?ref=${encodeURIComponent(code)}`,
      clicks: lc,
      bookings: lb,
      usdc: round2(lb * avgBookingUsd * commissionRate),
    };
  });

  // Past weekly payouts (most recent first), each with an on-chain receipt.
  const chain = "Arbitrum";
  const payouts: CreatorPayout[] = [];
  const start = nextMonday();
  const count = 3 + Math.floor(rng() * 4);
  for (let i = 1; i <= count; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() - 7 * i);
    const amt = round2(avgBookingUsd * commissionRate * (1.5 + rng() * 5));
    const txHash = "0x" + hexFrom(rng, 64);
    payouts.push({
      date: d.toISOString(),
      amountUsdc: amt,
      chain,
      txHash,
      explorerUrl: `https://arbiscan.io/tx/${txHash}`,
      status: i === 1 && rng() > 0.7 ? "Processing" : "Paid",
    });
  }

  // Fetch real followers and following relationships
  const realFollowers = getFollowers(app.email);
  const realFollowing = getFollowing(app.email);

  // Generate deterministic mock followers/following so the screen is never empty
  const mockFollowers: FollowerProfile[] = [];
  const mockFollowing: FollowerProfile[] = [];
  
  const followerSeed = hashString(app.email.toLowerCase() + "|followers");
  const followerRng = mulberry32(followerSeed);
  const followerCount = 2 + Math.floor(followerRng() * 3);
  const shuffledProfiles = [...MOCK_PROFILES].sort(() => followerRng() - 0.5);
  for (let i = 0; i < followerCount; i++) {
    const profile = shuffledProfiles[i];
    if (profile && !realFollowers.some(rf => rf.email === profile.email)) {
      mockFollowers.push(profile);
    }
  }

  const followingSeed = hashString(app.email.toLowerCase() + "|following");
  const followingRng = mulberry32(followingSeed);
  const followingCount = 1 + Math.floor(followingRng() * 3);
  const shuffledFollowing = [...MOCK_PROFILES].sort(() => followingRng() - 0.5);
  for (let i = 0; i < followingCount; i++) {
    const profile = shuffledFollowing[i];
    if (profile && !realFollowing.some(rf => rf.email === profile.email)) {
      mockFollowing.push(profile);
    }
  }

  const allFollowers = [...realFollowers, ...mockFollowers];
  const allFollowing = [...realFollowing, ...mockFollowing];
  
  const isCurrentlyFollowing = viewerEmail ? isFollowing(viewerEmail, app.email) : false;
  const followersCount = allFollowers.length;

  return {
    name: app.name,
    email: app.email,
    handle: app.handle,
    platform: app.platform,
    wallet: app.wallet || undefined,
    bio: app.bio || undefined,
    avatarUrl: app.avatarUrl || undefined,
    country: app.country || undefined,
    website: app.website || undefined,
    handleVerified: !!app.handleVerified,
    kycVerified: false,
    tier,
    referralCode: code,
    travelShopUrl: travelShopUrl(code),
    nextPayoutDate: start.toISOString(),
    earnings: { pendingUsdc, clearedUsdc, paidOutUsdc, lifetimeUsdc },
    month: { clicks, bookings, conversion },
    followerCashbackUsdc,
    voyager: {
      bookings,
      bookingsTarget: 25,
      followers: followersCount,
      followersTarget: 1_000,
      unlocked: tier.name !== "Explorer",
    },
    links,
    payouts,
    followers: allFollowers,
    following: allFollowing,
    followingEmails: realFollowing.map((f) => f.email.toLowerCase()),
    isFollowing: isCurrentlyFollowing,
  };
}


// Derive a minimal application from just an email, for when the emailed
// dashboard link is opened after the in-memory applicant store has cycled
// (serverless cold start). Name is inferred from the local-part.
export function applicationFromEmail(email: string): CreatorApplication {
  const local = email.split("@")[0] || "Creator";
  const name = local
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
  return { name: name || "Creator", email, platform: "", handle: "", audience: "Under 1,000" };
}
