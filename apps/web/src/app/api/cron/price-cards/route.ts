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

  const outcome = await runJob("price-cards", async (ctx) => {
    const token = botToken();
    if (!token) {
      // Not configured is not a code failure, but it IS the job doing nothing,
      // and the run record is the only place anyone would see that.
      report = { skipped: true, reason: "DISCORD_BOT_TOKEN is not set" };
      ctx.note("DISCORD_BOT_TOKEN is not set; no card was posted.");
      ctx.metric("skipped", 1);
      return;
    }

    const { ready, skipped } = configuredChannels();
    if (ready.length === 0) {
      report = { skipped: true, reason: "no price-card channels configured", detail: skipped };
      ctx.note(
        "No price-card channel is configured; no card was posted. " +
          skipped.map((s) => s.symbol + ": " + s.reason).join("; ")
      );
      ctx.metric("skipped", 1);
      return;
    }
    ctx.metric("channels_ready", ready.length);

    // Deduplicated: an asset with its own channel AND a shared feed appears in
    // `ready` twice, and it is the same card drawn from the same numbers. One
    // fetch, rendered once per home.
    const symbols = [...new Set(ready.map((c) => c.symbol))] as CardSymbol[];
    const data = await getPriceCardData(symbols);

    const results: Record<string, unknown>[] = [];
    const origin = new URL(req.url).origin;

    // PACED PER CHANNEL, so the retry is a safety net rather than the plan.
    //
    // Discord meters attachment writes per CHANNEL, and every card carries a
    // PNG. The shared feed takes one write per asset — seven in a row — while a
    // dedicated channel takes exactly one, so the pressure is entirely on the
    // shared one and spacing every write equally would just make the job slower
    // for no benefit. Measured on production 2026-09-07: eleven writes
    // unpaced, two came back 429 even after the bounded retry, and the run
    // recorded "ETH: Rate limited" and "XAUUSD: Rate limited".
    //
    // 1.1s between consecutive writes to the SAME channel keeps the shared feed
    // under the limit and costs nothing on a channel with one card. That run
    // took 18.6s of a 45s budget, so the seven-card feed can afford the ~8s
    // this adds; `ctx.expired()` is still the authority if it cannot.
    // CHECKED ONCE PER CHANNEL, not once per card. The shared feed holds seven
    // cards, and asking Discord seven times in one run whether the bot can post
    // in the same channel cannot return seven different answers — but it does
    // spend seven requests against that channel's rate limit, on top of the
    // seven writes. That is what kept exhausting the budget: the last card in
    // the feed came back 429 across three separate production runs while every
    // card in a single-card channel succeeded.
    const accessCache = new Map<string, Awaited<ReturnType<typeof checkChannel>>>();
    const accessTo = async (channelId: string) => {
      const hit = accessCache.get(channelId);
      if (hit) return hit;
      const fresh = await checkChannel(token, channelId);
      accessCache.set(channelId, fresh);
      return fresh;
    };

    const SAME_CHANNEL_GAP_MS = 1_100;
    const lastWriteAt = new Map<string, number>();
    const paceChannel = async (channelId: string) => {
      const previous = lastWriteAt.get(channelId);
      if (previous !== undefined) {
        const wait = SAME_CHANNEL_GAP_MS - (Date.now() - previous);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      }
      lastWriteAt.set(channelId, Date.now());
    };

    for (const chan of ready) {
      // A job killed mid-batch records nothing, so stop cleanly and report the
      // cards that did get written rather than losing the whole run.
      if (ctx.expired()) {
        ctx.note("Budget expired before every card was written.");
        break;
      }
      const d = data.get(chan.symbol);
      if (!d) {
        // No price means no card. Posting one anyway would show $0.00.
        results.push({
          symbol: chan.symbol, channelId: chan.channelId, envVar: chan.envVar,
          ok: false, error: "no market data",
        });
        continue;
      }

      // Confirm access before uploading a megabyte of PNG to a channel the bot
      // cannot post in, and so the operator gets a specific permission error.
      const access = await accessTo(chan.channelId);
      if (!access.ok) {
        results.push({
          symbol: chan.symbol, channelId: chan.channelId, envVar: chan.envVar,
          ok: false, error: access.error,
        });
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

      await paceChannel(chan.channelId);
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
        // "edited" is the healthy daily state. "posted" should appear once per
        // channel ever, and "adopted" means the remembered id was lost and the
        // existing card was recovered from Discord instead of duplicated.
        action: posted.action,
        error: posted.error,
        price: d.price,
        change24h: d.changePct24h,
      });
    }

    const posted = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);

    // WHAT THIS JOB DID, in the run record and not only in the response body.
    // The response is read by whoever invoked the endpoint; the record is the
    // only thing an operator can consult tomorrow. Without these counters a job
    // that posted nothing recorded exactly what a job that posted seven cards
    // recorded -- `ok: true`, no metrics, no notes -- which is how these cards
    // stood five days stale with a green execution history above them.
    ctx.metric("posted", posted.length);
    ctx.metric("failed", failed.length);
    for (const r of results) {
      if (typeof r.action === "string") ctx.metric("action_" + r.action, 1);
    }
    // "edited" is the healthy daily state, so a run that edits nothing is worth
    // a note even when nothing threw.
    if (posted.length === 0) ctx.note("No card was posted or edited.");
    for (const r of failed) ctx.note(String(r.symbol) + ": " + String(r.error ?? "failed"));

    report = {
      posted: posted.length,
      failed: failed.length,
      notConfigured: skipped,
      results,
    };
  });

  return NextResponse.json({ job: "price-cards", status: outcome.status, dryRun: dry, ...report });
}
