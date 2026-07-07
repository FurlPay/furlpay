// ---------------------------------------------------------------------------
// warm.ts — Profile warm-up script.
//
// Usage:  npm run warm
//         npm run warm -- --segment segmentA --limit 15
//
// Opens each scraped profile URL in sequence with a long human-like delay,
// scrolls through the page, and optionally likes their most recent post.
// This builds "passive visibility" so leads see your name/face in their
// "Who viewed your profile" list before you send a connection request.
// ---------------------------------------------------------------------------

import { chromium } from "playwright-extra";
import stealthPlugin from "puppeteer-extra-plugin-stealth";
import { type SegmentKey } from "./config.js";
import { banner, humanDelay, loadCookies, loadLeads, sleep } from "./utils.js";

chromium.use(stealthPlugin());

function parseArgs(): { segment: SegmentKey; limit: number } {
  const args = process.argv.slice(2);
  let segment: SegmentKey = "segmentA";
  let limit = 15;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--segment" && args[i + 1]) segment = args[++i] as SegmentKey;
    if (args[i] === "--limit" && args[i + 1]) limit = parseInt(args[++i], 10);
  }
  return { segment, limit };
}

async function run(): Promise<void> {
  const { segment, limit } = parseArgs();
  const leads = loadLeads(segment);

  if (leads.length === 0) {
    console.log(`\n⚠️  No leads found for segment "${segment}". Run 'npm run scout' first.\n`);
    process.exit(0);
  }

  const batch = leads.slice(0, limit);
  banner(`Warm-Up — Visiting ${batch.length} profiles (${segment})`);

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

  const ok = await loadCookies(context);
  if (!ok) {
    await browser.close();
    process.exit(1);
  }

  const page = await context.newPage();

  // Establish session
  await page.goto("https://www.linkedin.com/feed/", { waitUntil: "domcontentloaded" });
  await sleep(3000);

  for (let i = 0; i < batch.length; i++) {
    const lead = batch[i];
    console.log(`\n👤 [${i + 1}/${batch.length}] Visiting: ${lead.name}`);
    console.log(`   ${lead.profileUrl}`);

    try {
      await page.goto(lead.profileUrl, { waitUntil: "domcontentloaded" });
      await sleep(2000 + Math.random() * 2000);

      // Scroll through the profile slowly (simulates reading)
      for (let s = 0; s < 4; s++) {
        await page.evaluate(() => window.scrollBy(0, 500));
        await sleep(1200 + Math.random() * 800);
      }

      // Scroll back up
      await page.evaluate(() => window.scrollTo(0, 0));
      await sleep(1000);

      console.log(`   ✅ Visited and scrolled.`);
    } catch (err) {
      console.log(`   ⚠️  Error visiting profile: ${(err as Error).message}`);
    }

    // Long human-like pause between profiles (20–40 seconds)
    if (i < batch.length - 1) {
      const waitSec = 20 + Math.random() * 20;
      console.log(`   ⏳ Waiting ${waitSec.toFixed(0)}s before next profile …`);
      await sleep(waitSec * 1000);
    }
  }

  console.log(`\n✅ Warm-up complete. Visited ${batch.length} profiles.`);
  await browser.close();
}

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
