import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { requireCron } from "@/lib/cron/auth";
import { runJob } from "@/lib/cron/runner";
import { botToken, configuredChannels } from "@/lib/priceCards/config";
import { getPriceCardData, type CardSymbol } from "@/lib/priceCards/data";
import { buildPriceCardMessage } from "@/lib/priceCards/embed";
import { checkChannel, upsertCardMessage } from "@/lib/priceCards/discordBot";

// ---------------------------------------------------------------------------
// GET /api/cron/price-cards — the daily BTC / ETH / SOL / gold price cards.
//
// Each asset posts into its own Discord channel and the message is EDITED on
// each run rather than reposted, so a channel holds one live card instead of a
// growing list of stale ones.
//
// ONCE A DAY IS A PLATFORM CEILING. This Vercel plan rejects cron expressions
// firing more than daily at deploy time — the same constraint the market-brief
// job documents. A more frequent cadence needs an external scheduler calling
// this endpoint with the cron secret; the code itself is happy to run at any
// interval, since it edits rather than appends.
//
// EVERY CARD FAILS INDEPENDENTLY. One asset with no market data, or one channel
// the bot cannot see, must not stop the other three. Each is caught, recorded
// and reported in the response.
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const auth = requireCron(req);
  if (!auth.ok) return auth.res;

  // ?dry=1 renders and reports without touching Discord, so configuration can
  // be checked without posting into a live channel.
  const dry = req.nextUrl.searchParams.get("dry") === "1";

  // `runJob` bodies return void -- it owns locking and status -- so the report
  // is collected here and returned alongside the outcome.
  let report: Record<string, unknown> = { skipped: true, reason: "job did not run" };

  const outcome = await runJob("price-cards", async () => {
    const token = botToken();
    if (!token) {
      // Not an error worth alerting on: the job is simply not configured.
      report = { skipped: true, reason: "DISCORD_BOT_TOKEN is not set" };
      return;
    }

    const { ready, skipped } = configuredChannels();
    if (ready.length === 0) {
      report = { skipped: true, reason: "no price-card channels configured", detail: skipped };
      return;
    }

    const symbols = ready.map((c) => c.symbol) as CardSymbol[];
    const data = await getPriceCardData(symbols);

    const results: Record<string, unknown>[] = [];
    const origin = new URL(req.url).origin;

    for (const chan of ready) {
      const d = data.get(chan.symbol);
      if (!d) {
        // No price means no card. Posting one anyway would show $0.00.
        results.push({ symbol: chan.symbol, ok: false, error: "no market data" });
        continue;
      }

      // Confirm access before uploading a megabyte of PNG to a channel the bot
      // cannot post in, and so the operator gets a specific permission error.
      const access = await checkChannel(token, chan.channelId);
      if (!access.ok) {
        results.push({ symbol: chan.symbol, ok: false, error: access.error, envVar: chan.envVar });
        continue;
      }

      let png: Uint8Array;
      try {
        const res = await fetch(`${origin}/api/og/price-card/${chan.symbol}`, {
          signal: AbortSignal.timeout(25_000),
          cache: "no-store",
        });
        if (!res.ok) {
          results.push({ symbol: chan.symbol, ok: false, error: `card render returned ${res.status}` });
          continue;
        }
        png = new Uint8Array(await res.arrayBuffer());
      } catch {
        results.push({ symbol: chan.symbol, ok: false, error: "card render failed" });
        continue;
      }

      const filename = `${chan.symbol.toLowerCase()}-price.png`;
      const message = buildPriceCardMessage(d, filename);

      if (dry) {
        results.push({
          symbol: chan.symbol, ok: true, dryRun: true,
          channel: access.name ?? chan.channelId,
          pngBytes: png.byteLength, price: d.price, change24h: d.changePct24h,
        });
        continue;
      }

      const posted = await upsertCardMessage({
        token,
        channelId: chan.channelId,
        cardKey: chan.symbol,
        payload: message,
        png,
        filename,
      });

      results.push({
        symbol: chan.symbol,
        channel: access.name ?? chan.channelId,
        ok: posted.ok,
        messageId: posted.messageId,
        error: posted.error,
        price: d.price,
        change24h: d.changePct24h,
      });
    }

    report = {
      posted: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      notConfigured: skipped,
      results,
    };
  });

  return NextResponse.json({ job: "price-cards", status: outcome.status, dryRun: dry, ...report });
}
