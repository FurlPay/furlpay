// ---------------------------------------------------------------------------
// scout.ts — The main LinkedIn lead scraper.
//
// Usage:  npm run scout
//         npm run scout -- --segment segmentA
//         npm run scout -- --url "https://linkedin.com/search/..."
//
// Reads cookies.json, opens a stealth Chromium browser, navigates to a
// LinkedIn People search URL, extracts visible profile cards, paginates
// up to MAX_SEARCH_PAGES, and saves deduplicated leads to data/<segment>.json.
// ---------------------------------------------------------------------------

import { chromium } from "playwright-extra";
import stealthPlugin from "puppeteer-extra-plugin-stealth";
import {
  SEARCH_QUERIES,
  MAX_LEADS_PER_RUN,
  MAX_SEARCH_PAGES,
  PAGE_SETTLE_MS,
  type SegmentKey,
} from "./config.js";
import {
  banner,
  humanDelay,
  loadCookies,
  saveLeads,
  sleep,
  type Lead,
} from "./utils.js";

// Apply stealth patches (fingerprint masking, webdriver flag removal, etc.)
chromium.use(stealthPlugin());

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseArgs(): { segment: SegmentKey; url: string; label: string } {
  const args = process.argv.slice(2);
  let segment: SegmentKey = "segmentA";
  let customUrl: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--segment" && args[i + 1]) {
      segment = args[++i] as SegmentKey;
    }
    if (args[i] === "--url" && args[i + 1]) {
      customUrl = args[++i];
    }
  }

  const cfg = SEARCH_QUERIES[segment] ?? SEARCH_QUERIES.segmentA;
  return {
    segment,
    url: customUrl ?? cfg.url,
    label: cfg.label,
  };
}

// ---------------------------------------------------------------------------
// Scraper core
// ---------------------------------------------------------------------------

async function scrapeSearchPage(page: import("playwright").Page, segment: string): Promise<Lead[]> {
  // Wait for search results to render
  await sleep(PAGE_SETTLE_MS);

  // Scroll down slowly to trigger lazy-loaded cards
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.scrollBy(0, 600));
    await sleep(800 + Math.random() * 400);
  }

  // Extract profile cards from the search results page
  const leads = await page.evaluate((seg: string) => {
    const results: Array<{
      name: string;
      headline: string;
      profileUrl: string;
      connectionDegree: string;
      scrapedAt: string;
      segment: string;
    }> = [];

    // LinkedIn People Search result cards
    const cards = document.querySelectorAll(".reusable-search__result-container");

    cards.forEach((card) => {
      const nameEl =
        card.querySelector(".entity-result__title-text a span[aria-hidden='true']") ??
        card.querySelector(".entity-result__title-text a span") ??
        card.querySelector(".app-aware-link span");

      const headlineEl =
        card.querySelector(".entity-result__primary-subtitle") ??
        card.querySelector(".entity-result__summary");

      const linkEl = card.querySelector<HTMLAnchorElement>(
        ".entity-result__title-text a.app-aware-link"
      );

      const degreeEl = card.querySelector(".entity-result__badge-text span");

      const name = nameEl?.textContent?.trim() ?? "";
      const headline = headlineEl?.textContent?.trim() ?? "";
      const profileUrl = linkEl?.href?.split("?")?.[0] ?? "";
      const connectionDegree = degreeEl?.textContent?.trim() ?? "";

      if (name && profileUrl) {
        results.push({
          name,
          headline,
          profileUrl,
          connectionDegree,
          scrapedAt: new Date().toISOString(),
          segment: seg,
        });
      }
    });

    return results;
  }, segment);

  return leads;
}

async function run(): Promise<void> {
  const { segment, url, label } = parseArgs();
  banner(`LinkedIn Scout — ${label}`);
  console.log(`🔍 Search URL: ${url}`);
  console.log(`📁 Segment:    ${segment}\n`);

  // Launch a visible Chromium (headless: false is safer against detection)
  const browser = await chromium.launch({
    headless: false,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--window-size=1280,900",
    ],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    locale: "en-US",
    timezoneId: "America/New_York",
  });

  // Load session cookies
  const ok = await loadCookies(context);
  if (!ok) {
    await browser.close();
    process.exit(1);
  }

  const page = await context.newPage();

  // First visit LinkedIn homepage to establish the session
  console.log("🌐 Establishing LinkedIn session …");
  await page.goto("https://www.linkedin.com/feed/", { waitUntil: "domcontentloaded" });
  await sleep(3000);

  // Check if we are logged in
  const isLoggedIn = await page.evaluate(
    () => !!document.querySelector(".feed-identity-module") || !!document.querySelector(".global-nav")
  );

  if (!isLoggedIn) {
    console.error("❌ Not logged in — cookies may be expired. Re-export cookies.json and try again.");
    await browser.close();
    process.exit(1);
  }
  console.log("✅ Logged in successfully.\n");

  // Navigate to search
  let allLeads: Lead[] = [];

  for (let pageNum = 1; pageNum <= MAX_SEARCH_PAGES; pageNum++) {
    if (allLeads.length >= MAX_LEADS_PER_RUN) break;

    const pageUrl = pageNum === 1 ? url : `${url}&page=${pageNum}`;
    console.log(`📄 Page ${pageNum}/${MAX_SEARCH_PAGES} — navigating …`);
    await page.goto(pageUrl, { waitUntil: "domcontentloaded" });

    const leads = await scrapeSearchPage(page, segment);
    console.log(`   → Found ${leads.length} profiles on this page.`);
    allLeads.push(...leads);

    if (leads.length === 0) {
      console.log("   ⚠️  No results on this page — stopping pagination.");
      break;
    }

    if (pageNum < MAX_SEARCH_PAGES) {
      await humanDelay();
    }
  }

  // Trim to limit
  if (allLeads.length > MAX_LEADS_PER_RUN) {
    allLeads = allLeads.slice(0, MAX_LEADS_PER_RUN);
  }

  // Save
  if (allLeads.length > 0) {
    saveLeads(segment, allLeads);
  } else {
    console.log("\n⚠️  No leads scraped. LinkedIn may have changed its HTML structure.");
    console.log("   Try inspecting the search page manually and updating the selectors in scout.ts.");
  }

  console.log(`\n✅ Done. Scraped ${allLeads.length} leads for segment "${segment}".`);
  await browser.close();
}

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
