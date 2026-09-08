import { createHash } from "node:crypto";
import { financialEnvironment, type FinancialEnvironment } from "@/lib/flags";

// ---------------------------------------------------------------------------
// CLIENT feature flags — what a shipped mobile build is allowed to show.
//
// WHY THIS IS NOT lib/flags.ts. That file gates MONEY CAPABILITIES: may this
// deployment route a real brokerage order, may it broadcast a settlement. Its
// four gates are about credentials and contracts, and its answers must never
// leave the server in a form a client could act on unilaterally.
//
// This file answers a different question: "should this build render the NFT
// tab?". The distinction matters because the two have opposite failure modes.
// A money flag that reports `on` by mistake moves money that should not have
// moved. A client flag that reports `on` by mistake shows a screen. So client
// flags may be served to an untrusted client, and money flags may not — and
// keeping them in separate registries is what stops someone adding
// ONRAMP_LIVE to a payload the phone can read.
//
// A CLIENT FLAG IS NEVER AN AUTHORISATION. Every screen a flag reveals still
// hits an API route that does its own authz, its own Zod validation and its own
// money-flag check. Flipping a flag client-side (which any user with a rooted
// device can do) therefore buys nothing but a screen that 403s. Nothing in this
// registry may be the only thing standing between a user and an operation.
//
// ROLLOUT IS DETERMINISTIC, NOT RANDOM. A percentage rollout implemented with
// Math.random() flips a user in and out of the feature on every app launch,
// which produces support tickets nobody can reproduce. The bucket here is a
// stable hash of (flag key + subject id), so a user stays on one side of the
// line until the percentage itself moves.
// ---------------------------------------------------------------------------

export const CLIENT_FLAGS = [
  "wallet_connect",
  "nft_gallery",
  "tx_simulation",
  "custom_tokens",
  "asset_discovery",
  "cloud_backup",
  "p2p_marketplace",
  "onramp_ui",
  "offramp_ui",
  "staking_ui",
  "balance_hiding",
  "referrals",
  "stories",
  "promo_banners",
  "surveys",
  "app_rating",
  "prediction_markets",
  "qr_from_gallery",
  "wallet_provisioning",
] as const;

export type ClientFlag = (typeof CLIENT_FLAGS)[number];

interface ClientFlagSpec {
  /** What turning this on reveals. Read by the ops console. */
  description: string;
  /**
   * Value when nothing else applies. This is also what a mobile build falls
   * back to when it cannot reach the server at all, so it must be the safe
   * answer rather than the desirable one.
   */
  defaultValue: boolean;
  /** Environments where the flag may ever be on. */
  environments: FinancialEnvironment[];
  /**
   * Percentage of users who get it when enabled, 0-100.
   *
   * Applied only when the flag is otherwise on. 100 means "everyone", which is
   * the value a fully launched feature settles at; it is not the default,
   * because a feature's first day should never be its widest.
   */
  rollout: number;
  /**
   * Env var that force-disables the flag regardless of everything else.
   *
   * Every flag has one. A feature that cannot be switched off in ten seconds
   * without a redeploy is a feature that will be left broken in front of users
   * while someone runs a build.
   */
  killSwitch: string;
  /**
   * Server env the client capability genuinely needs. Recorded so the ops
   * console can say "off because unconfigured" rather than "off because someone
   * forgot" — different bugs, different fixes.
   */
  requiresServerEnv?: string[];
}

export const CLIENT_FLAG_SPECS: Record<ClientFlag, ClientFlagSpec> = {
  wallet_connect: {
    description: "Connect the in-app wallet to external dApps over WalletConnect v2.",
    defaultValue: false,
    environments: ["development", "staging", "production"],
    rollout: 100,
    killSwitch: "FURLPAY_KILL_WALLET_CONNECT",
    // Without a relay project id the client cannot open a socket at all, so the
    // flag would reveal a screen whose only outcome is a connection error.
    requiresServerEnv: ["FURLPAY_WALLETCONNECT_PROJECT_ID"],
  },
  nft_gallery: {
    description: "Show the NFT gallery and NFT transfer flow.",
    defaultValue: false,
    environments: ["development", "staging", "production"],
    rollout: 100,
    killSwitch: "FURLPAY_KILL_NFT_GALLERY",
  },
  tx_simulation: {
    description: "Run pre-signature transaction simulation and risk scanning.",
    // Defaults ON: this one only ever ADDS a warning before signing. Shipping
    // it off by default would mean the safest path is the one nobody gets.
    defaultValue: true,
    environments: ["development", "staging", "production"],
    rollout: 100,
    killSwitch: "FURLPAY_KILL_TX_SIMULATION",
  },
  custom_tokens: {
    description: "Let users add and remove arbitrary ERC-20 / SPL tokens.",
    defaultValue: false,
    environments: ["development", "staging", "production"],
    rollout: 100,
    killSwitch: "FURLPAY_KILL_CUSTOM_TOKENS",
  },
  asset_discovery: {
    description: "Automatically scan supported chains for existing balances.",
    defaultValue: false,
    environments: ["development", "staging", "production"],
    rollout: 100,
    killSwitch: "FURLPAY_KILL_ASSET_DISCOVERY",
  },
  cloud_backup: {
    description: "Client-side-encrypted wallet backup and restore.",
    defaultValue: false,
    environments: ["development", "staging", "production"],
    rollout: 100,
    killSwitch: "FURLPAY_KILL_CLOUD_BACKUP",
  },
  p2p_marketplace: {
    description: "Browse P2P ads and take orders from the mobile app.",
    defaultValue: false,
    environments: ["development", "staging", "production"],
    rollout: 100,
    killSwitch: "FURLPAY_KILL_P2P",
  },
  onramp_ui: {
    description: "Show the fiat on-ramp purchase flow.",
    defaultValue: false,
    environments: ["development", "staging", "production"],
    rollout: 100,
    killSwitch: "FURLPAY_KILL_ONRAMP_UI",
  },
  offramp_ui: {
    description: "Show the crypto-to-fiat withdrawal flow.",
    defaultValue: false,
    environments: ["development", "staging", "production"],
    rollout: 100,
    killSwitch: "FURLPAY_KILL_OFFRAMP_UI",
  },
  staking_ui: {
    description: "Show on-chain staking positions and delegation flows.",
    defaultValue: false,
    environments: ["development", "staging", "production"],
    rollout: 100,
    killSwitch: "FURLPAY_KILL_STAKING_UI",
  },
  balance_hiding: {
    description: "Offer the privacy toggle that masks balances across the app.",
    defaultValue: true,
    environments: ["development", "staging", "production"],
    rollout: 100,
    killSwitch: "FURLPAY_KILL_BALANCE_HIDING",
  },
  referrals: {
    description: "Referral codes, links and the referral dashboard.",
    defaultValue: false,
    environments: ["development", "staging", "production"],
    rollout: 100,
    killSwitch: "FURLPAY_KILL_REFERRALS",
  },
  stories: {
    description: "In-app educational stories on the home screen.",
    defaultValue: false,
    environments: ["development", "staging", "production"],
    rollout: 100,
    killSwitch: "FURLPAY_KILL_STORIES",
  },
  promo_banners: {
    description: "Remotely configured promotional banners.",
    defaultValue: false,
    environments: ["development", "staging", "production"],
    rollout: 100,
    killSwitch: "FURLPAY_KILL_PROMO_BANNERS",
  },
  surveys: {
    description: "In-app surveys.",
    defaultValue: false,
    environments: ["development", "staging", "production"],
    rollout: 100,
    killSwitch: "FURLPAY_KILL_SURVEYS",
  },
  app_rating: {
    description: "Native store-rating prompt after positive engagement.",
    defaultValue: false,
    environments: ["staging", "production"],
    rollout: 100,
    killSwitch: "FURLPAY_KILL_APP_RATING",
  },
  prediction_markets: {
    description: "Prediction-market discovery and positions.",
    defaultValue: false,
    // Deliberately not production: the legality of offering prediction markets
    // varies by jurisdiction and no geo-gating decision has been taken. Shipping
    // it to production behind a percentage would be taking that decision by
    // accident.
    environments: ["development", "staging"],
    rollout: 100,
    killSwitch: "FURLPAY_KILL_PREDICTION_MARKETS",
  },
  qr_from_gallery: {
    description: "Decode a payment QR from a photo in the gallery.",
    defaultValue: false,
    environments: ["development", "staging", "production"],
    rollout: 100,
    killSwitch: "FURLPAY_KILL_QR_FROM_GALLERY",
  },
  wallet_provisioning: {
    description: "Push-provision a FurlPay card into Google Wallet / Apple Wallet.",
    defaultValue: false,
    environments: ["development", "staging", "production"],
    rollout: 100,
    killSwitch: "FURLPAY_KILL_WALLET_PROVISIONING",
    // The provisioning handshake is issuer-signed. Without an issuer there is
    // nothing to hand the wallet, so the button would always dead-end.
    requiresServerEnv: ["FURLPAY_CARD_ISSUER", "FURLPAY_CARD_ISSUER_API_KEY"],
  },
};

/** Why a client flag resolved the way it did. Surfaced to the ops console. */
export type ClientFlagReason =
  | "default"
  | "env_override"
  | "environment_excluded"
  | "killed"
  | "rollout_excluded"
  | "missing_server_env";

export interface ResolvedClientFlag {
  flag: ClientFlag;
  enabled: boolean;
  reason: ClientFlagReason;
}

/**
 * Stable 0-99 bucket for (flag, subject).
 *
 * Hashed per flag rather than per subject so that two 10% rollouts do not land
 * on the same 10% of users — otherwise the same unlucky cohort receives every
 * experimental feature, and their crash rate is read as the feature's.
 */
export function rolloutBucket(flag: string, subject: string): number {
  const digest = createHash("sha256").update(`${flag}:${subject}`).digest();
  return digest.readUInt32BE(0) % 100;
}

function envOverride(flag: ClientFlag): boolean | null {
  const raw = process.env[`FURLPAY_FLAG_${flag.toUpperCase()}`];
  if (raw === undefined) return null;
  const v = raw.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "on") return true;
  if (v === "0" || v === "false" || v === "off") return false;
  return null;
}

function isKilled(spec: ClientFlagSpec): boolean {
  const v = (process.env[spec.killSwitch] ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "on";
}

/**
 * Resolve one flag for one subject.
 *
 * `subject` is the stable id the rollout hashes — the user id when signed in,
 * otherwise the install id the client generates. It is never the IP: an IP
 * changes on every train journey, which would reshuffle the cohort.
 */
export function resolveClientFlag(flag: ClientFlag, subject: string): ResolvedClientFlag {
  const spec = CLIENT_FLAG_SPECS[flag];
  const off = (reason: ClientFlagReason): ResolvedClientFlag => ({ flag, enabled: false, reason });

  // Kill switch outranks everything, including an explicit env override. That
  // ordering is the point of having one: the person pulling the stop lever at
  // 3am must not have to find out who set which override.
  if (isKilled(spec)) return off("killed");

  if (!spec.environments.includes(financialEnvironment())) return off("environment_excluded");

  for (const name of spec.requiresServerEnv ?? []) {
    if (!(process.env[name] ?? "").trim()) return off("missing_server_env");
  }

  const override = envOverride(flag);
  const base = override ?? spec.defaultValue;
  if (!base) return { flag, enabled: false, reason: override === null ? "default" : "env_override" };

  if (spec.rollout < 100 && rolloutBucket(flag, subject) >= spec.rollout) {
    return off("rollout_excluded");
  }

  return { flag, enabled: true, reason: override === null ? "default" : "env_override" };
}

/** Resolve the whole registry for one subject. */
export function resolveAllClientFlags(subject: string): Record<ClientFlag, boolean> {
  const out = {} as Record<ClientFlag, boolean>;
  for (const flag of CLIENT_FLAGS) out[flag] = resolveClientFlag(flag, subject).enabled;
  return out;
}
