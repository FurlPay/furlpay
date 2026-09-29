// Environment loading + validation.
//
// Two rules drive this file. First: the bot must start with only the free-tier
// keys, so every optional provider degrades to "not configured" instead of
// throwing. Second: a secret must never reach a log line, so `redact()` is the
// only sanctioned way to print anything that came out of here.

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, "..", "..");

/** Minimal .env reader — avoids a dependency for ~20 lines of parsing. */
function loadDotEnv(): void {
  const path = resolve(ROOT, ".env");
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadDotEnv();

const str = (k: string): string | null => {
  const v = process.env[k];
  return v && v.trim() ? v.trim() : null;
};
const num = (k: string, d: number): number => {
  const v = str(k);
  if (v === null) return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const bool = (k: string, d: boolean): boolean => {
  const v = str(k);
  return v === null ? d : /^(1|true|yes|on)$/i.test(v);
};

export interface Env {
  nodeEnv: string;
  logLevel: string;

  discordToken: string | null;
  discordClientId: string | null;
  discordGuildId: string | null;

  alchemyKey: string | null;
  heliusKey: string | null;
  coingeckoKey: string | null;
  etherscanKey: string | null;
  defillamaKey: string | null;
  birdeyeKey: string | null;
  moralisKey: string | null;
  cryptopanicKey: string | null;

  databaseUrl: string;
  redisUrl: string | null;

  /** Monthly Alchemy compute-unit ceiling the scheduler throttles against. */
  alchemyMonthlyCu: number;
  /** Monthly CoinGecko call ceiling (Demo plan is 10,000). */
  coingeckoMonthlyCalls: number;

  whaleScanEnabled: boolean;
  publicRpcFallback: boolean;
  /** Seconds between price collector runs. */
  priceIntervalSec: number;
  tvlIntervalSec: number;

  /** USDC Intelligence configuration */
  usdcDiscordChannel: string;
  usdcDiscordCategory: string;
  usdcWhaleMinUsd: number;
  usdcAlertMinUsd: number;
  usdcBackfillHours: number;
  usdcPassThroughMinUsd: number;
  furlpayTrackedWallets: string | null;
  usdcTickSec: number;
}

export const env: Env = {
  nodeEnv: str("NODE_ENV") ?? "development",
  logLevel: str("LOG_LEVEL") ?? "info",

  discordToken: str("DISCORD_BOT_TOKEN"),
  discordClientId: str("DISCORD_CLIENT_ID"),
  discordGuildId: str("DISCORD_GUILD_ID"),

  alchemyKey: str("ALCHEMY_API_KEY"),
  heliusKey: str("HELIUS_API_KEY"),
  coingeckoKey: str("COINGECKO_API_KEY"),
  etherscanKey: str("ETHERSCAN_API_KEY"),
  defillamaKey: str("DEFILLAMA_API_KEY"),
  birdeyeKey: str("BIRDEYE_API_KEY"),
  moralisKey: str("MORALIS_API_KEY"),
  cryptopanicKey: str("CRYPTOPANIC_API_KEY"),

  databaseUrl: str("DATABASE_URL") ?? resolve(ROOT, "data", "chaintracker.db"),
  redisUrl: str("REDIS_URL"),

  alchemyMonthlyCu: num("ALCHEMY_MONTHLY_CU", 30_000_000),
  coingeckoMonthlyCalls: num("COINGECKO_MONTHLY_CALLS", 10_000),

  whaleScanEnabled: bool("WHALE_SCAN_ENABLED", true),
  publicRpcFallback: bool("PUBLIC_RPC_FALLBACK", true),
  priceIntervalSec: num("PRICE_INTERVAL_SEC", 60),
  tvlIntervalSec: num("TVL_INTERVAL_SEC", 900),

  // USDC intelligence. Documented here rather than only in .env.example, because
  // .env.example is covered by the repository's `.env*` ignore rule and so is not
  // tracked — this file is the version of these notes that actually ships.
  //
  // NONE of these is required. With no provider key at all the scanner falls back
  // to the public RPC endpoints in src/usdc/registry.ts, which is how it was
  // developed and measured; keys raise rate limits rather than unlocking anything.
  // The one real exception is Solana: its coverage needs the Helius parsed-
  // transaction API, and the public Solana RPC has no equivalent, so without
  // HELIUS_API_KEY Solana is not read at all and `usdc doctor` says so.
  usdcDiscordChannel: str("USDC_DISCORD_CHANNEL") ?? "usdc-intelligence",
  usdcDiscordCategory: str("USDC_DISCORD_CATEGORY") ?? "CHAINTRACKER",
  /** Floor for counting a transfer as "large" in the daily statistics. */
  usdcWhaleMinUsd: num("USDC_WHALE_MIN_USD", 100_000),
  /**
   * Floor for posting a realtime alert. Keep it well above the whale floor: Base
   * alone produces thousands of USDC transfers an hour, and measured after one
   * backfill there were 804 transfers above $1M waiting against a cap of 6 posted
   * per tick. FurlPay wallet movements ignore this floor entirely.
   */
  usdcAlertMinUsd: num("USDC_ALERT_MIN_USD", 1_000_000),
  /**
   * How far a cold start reaches back. Capped at 24h in code and further limited
   * by the 2,000-block-per-tick ceiling — on Base that is closer to an hour than a
   * day — and free-tier endpoints refuse archive reads past the recent window
   * anyway, so asking for more history than is retrievable only produces failures.
   */
  usdcBackfillHours: num("USDC_BACKFILL_HOURS", 24),
  /**
   * Floor above which a transfer is checked for being relayed money.
   *
   * A transfer whose sender received the same amount moments earlier is passing it
   * along, and counting both legs inflates every volume figure. The check is one
   * indexed lookup at 0.15ms, so the floor exists purely to bound a full backfill:
   * 722,091 rows would cost ~108s, while the 68,334 rows above $10k cost ~10s and
   * carry 97.51% of the dollar volume (both measured on the live table).
   *
   * MUST stay below USDC_ALERT_MIN_USD, or a transfer could be posted without ever
   * having been checked. `assertUsdcThresholds()` enforces that.
   */
  usdcPassThroughMinUsd: num("USDC_PASS_THROUGH_MIN_USD", 10_000),
  /**
   * Your own wallets, so their movements alert at any size and are labelled.
   * JSON array, or comma-separated chain:address:label:wallet_type.
   *
   * Leave unset rather than filling it with placeholders. This feature previously
   * shipped three invented "FurlPay treasury" addresses as seed data, one of which
   * (0x1111111254fb6c44bac0bed2854e76f90643097d) is the real 1inch v4 router — so
   * every USDC swap routed through 1inch posted a FurlPay wallet alert naming a
   * treasury that does not exist. There are no seed wallets now; this is the only
   * way a wallet is tracked.
   */
  furlpayTrackedWallets: str("FURLPAY_TRACKED_WALLETS"),
  usdcTickSec: num("USDC_TICK_SEC", 30),
};

/**
 * The pass-through floor must sit below the alert floor.
 *
 * Otherwise a transfer could clear the alert bar without ever having been checked
 * for being relayed money, and the channel would post a hop-chain leg as an
 * independent whale movement — the exact defect the check exists to prevent.
 * Enforced rather than documented, because the two values are tuned independently.
 */
export function assertUsdcThresholds(): void {
  if (env.usdcPassThroughMinUsd > env.usdcAlertMinUsd) {
    throw new Error(
      `USDC_PASS_THROUGH_MIN_USD (${env.usdcPassThroughMinUsd}) must be <= ` +
        `USDC_ALERT_MIN_USD (${env.usdcAlertMinUsd}), or alerts can be posted for ` +
        `transfers that were never checked for being relayed money.`,
    );
  }
}

/** Mask a secret for display: first 4 and last 2 characters only. */
export function redact(secret: string | null | undefined): string {
  if (!secret) return "(not set)";
  if (secret.length <= 8) return "****";
  return `${secret.slice(0, 4)}…${secret.slice(-2)}`;
}

/**
 * Anything the bot literally cannot run without. Providers are deliberately
 * absent — a missing provider key downgrades a feature, it does not stop boot.
 */
export function assertBootable(): void {
  const missing: string[] = [];
  if (!env.discordToken) missing.push("DISCORD_BOT_TOKEN");
  if (!env.discordClientId) missing.push("DISCORD_CLIENT_ID");
  if (missing.length) {
    throw new Error(
      `Cannot start: missing ${missing.join(", ")}. Copy .env.example to .env and fill them in.`,
    );
  }
}
