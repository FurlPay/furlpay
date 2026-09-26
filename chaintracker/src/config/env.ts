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
};

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
