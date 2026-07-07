// ---------------------------------------------------------------------------
// utils.ts — Shared helpers for the LinkedIn Scout tool.
// Random delays, cookie loading, data persistence, and logging.
// ---------------------------------------------------------------------------

import fs from "fs";
import path from "path";
import { BrowserContext } from "playwright";
import { COOKIES_PATH, DATA_DIR, MIN_DELAY_MS, MAX_DELAY_MS } from "./config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Lead {
  name: string;
  headline: string;
  profileUrl: string;
  connectionDegree: string;
  scrapedAt: string;
  segment: string;
}

// ---------------------------------------------------------------------------
// Delay — random human-like pause between actions.
// ---------------------------------------------------------------------------

export function humanDelay(): Promise<void> {
  const ms = MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
  console.log(`  ⏳ Waiting ${(ms / 1000).toFixed(1)}s …`);
  return new Promise((r) => setTimeout(r, ms));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Cookie loader — reads the exported JSON cookie file and injects into
// the Playwright browser context so we skip the login screen entirely.
// ---------------------------------------------------------------------------

export async function loadCookies(context: BrowserContext): Promise<boolean> {
  if (!fs.existsSync(COOKIES_PATH)) {
    console.error(
      "\n❌ cookies.json not found!\n\n" +
        "To create it:\n" +
        "  1. Log into LinkedIn in Chrome.\n" +
        "  2. Install the 'Cookie-Editor' extension.\n" +
        "  3. Navigate to linkedin.com → click the extension → Export (JSON).\n" +
        `  4. Save the file to:\n     ${COOKIES_PATH}\n`
    );
    return false;
  }

  try {
    const raw = fs.readFileSync(COOKIES_PATH, "utf-8");
    const cookies = JSON.parse(raw);

    // Cookie-Editor exports a slightly different shape than Playwright expects.
    // Normalize: ensure each cookie has a `sameSite` field and valid domain.
    const normalized = cookies.map((c: Record<string, unknown>) => ({
      name: c.name as string,
      value: c.value as string,
      domain: (c.domain as string) || ".linkedin.com",
      path: (c.path as string) || "/",
      httpOnly: c.httpOnly ?? false,
      secure: c.secure ?? true,
      sameSite: (c.sameSite as string)?.charAt(0)?.toUpperCase() +
        ((c.sameSite as string) || "none").slice(1).toLowerCase() || "None",
      // Playwright wants seconds; Cookie-Editor may export ms or omit entirely.
      ...(c.expirationDate
        ? { expires: Number(c.expirationDate) > 1e12 ? Number(c.expirationDate) / 1000 : Number(c.expirationDate) }
        : {}),
    }));

    await context.addCookies(normalized);
    console.log(`✅ Loaded ${normalized.length} cookies from cookies.json`);
    return true;
  } catch (err) {
    console.error("❌ Failed to parse cookies.json:", err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Data persistence — append leads to a segment-specific JSON file.
// ---------------------------------------------------------------------------

export function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function loadLeads(segment: string): Lead[] {
  const file = path.join(DATA_DIR, `${segment}.json`);
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, "utf-8")) as Lead[];
}

export function saveLeads(segment: string, leads: Lead[]): void {
  ensureDataDir();
  const file = path.join(DATA_DIR, `${segment}.json`);

  // Deduplicate by profileUrl.
  const existing = loadLeads(segment);
  const seen = new Set(existing.map((l) => l.profileUrl));
  const fresh = leads.filter((l) => !seen.has(l.profileUrl));

  const merged = [...existing, ...fresh];
  fs.writeFileSync(file, JSON.stringify(merged, null, 2));
  console.log(
    `💾 Saved ${fresh.length} new leads (${merged.length} total) → ${file}`
  );
}

// ---------------------------------------------------------------------------
// Pretty log helpers
// ---------------------------------------------------------------------------

export function banner(text: string): void {
  const line = "─".repeat(text.length + 4);
  console.log(`\n┌${line}┐`);
  console.log(`│  ${text}  │`);
  console.log(`└${line}┘\n`);
}
