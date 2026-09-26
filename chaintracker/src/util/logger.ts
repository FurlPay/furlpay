// Structured logger. Writes one JSON object per line in production so the
// output can be shipped somewhere, and a coloured single line in development.

import { env, redact } from "../config/env.js";

type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN = ORDER[(env.logLevel as Level) in ORDER ? (env.logLevel as Level) : "info"];

const COLOR: Record<Level, string> = {
  debug: "\x1b[90m",
  info: "\x1b[36m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
};

/**
 * Every configured secret, longest first, so a longer key is masked before a
 * shorter one that happens to be its prefix.
 */
function secrets(): string[] {
  return [
    env.discordToken,
    env.alchemyKey,
    env.heliusKey,
    env.coingeckoKey,
    env.etherscanKey,
    env.defillamaKey,
    env.birdeyeKey,
    env.moralisKey,
    env.cryptopanicKey,
  ]
    .filter((s): s is string => typeof s === "string" && s.length >= 8)
    .sort((a, b) => b.length - a.length);
}
let SECRETS: string[] | null = null;

/** Replace any configured secret that leaked into a message with its mask. */
export function scrub(text: string): string {
  SECRETS ??= secrets();
  let out = text;
  for (const s of SECRETS) {
    if (out.includes(s)) out = out.split(s).join(redact(s));
  }
  return out;
}

function emit(level: Level, msg: string, fields?: Record<string, unknown>): void {
  if (ORDER[level] < MIN) return;
  const time = new Date().toISOString();
  if (env.nodeEnv === "production") {
    let line: string;
    try {
      line = JSON.stringify({ time, level, msg, ...fields });
    } catch {
      line = JSON.stringify({ time, level, msg });
    }
    process.stdout.write(scrub(line) + "\n");
    return;
  }
  const extra = fields && Object.keys(fields).length ? " " + fmtFields(fields) : "";
  const line = `${COLOR[level]}${time.slice(11, 23)} ${level.toUpperCase().padEnd(5)}\x1b[0m ${msg}${extra}`;
  process.stdout.write(scrub(line) + "\n");
}

function fmtFields(f: Record<string, unknown>): string {
  return Object.entries(f)
    .map(([k, v]) => {
      const s =
        v instanceof Error
          ? v.message
          : typeof v === "object"
            ? safeJson(v)
            : String(v);
      return `\x1b[90m${k}=\x1b[0m${s}`;
    })
    .join(" ");
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return "[unserialisable]";
  }
}

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(scope: string): Logger;
}

export function makeLogger(scope = ""): Logger {
  const p = scope ? `[${scope}] ` : "";
  return {
    debug: (m, f) => emit("debug", p + m, f),
    info: (m, f) => emit("info", p + m, f),
    warn: (m, f) => emit("warn", p + m, f),
    error: (m, f) => emit("error", p + m, f),
    child: (s) => makeLogger(scope ? `${scope}:${s}` : s),
  };
}

export const log = makeLogger();
