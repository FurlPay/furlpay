import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { requireCron } from "@/lib/cron/auth";
import { runJob } from "@/lib/cron/runner";
import { raiseAlert } from "@/lib/alerts";
import { buildBrief } from "@/lib/markets/brief/brief";
import { renderBrief } from "@/lib/markets/brief/render";
import { postToDiscordWebhook, isDiscordWebhookUrl, redactWebhookUrl } from "@/lib/discordWebhook";

// ---------------------------------------------------------------------------
// GET /api/cron/market-brief — the daily market brief, posted to Discord.
//
// Schedule: vercel.json, 21:30 UTC = 17:30 US/Eastern in EDT, an hour and a half
// after the US close. Deliberately not 16:00: the closing auction prints for
// several minutes and a screener queried at the bell reports the pre-auction
// tape as the close.
//
// ONCE A DAY IS A PLATFORM CEILING, NOT A PREFERENCE. This Vercel project is on
// the Hobby plan, where a cron expression firing more than once per day is
// rejected at deploy time (see lib/cron/runner.ts). A daily close brief happens
// to be exactly what fits; an intraday cadence needs Pro, or an external
// scheduler calling this endpoint with FURLPAY_CRON_SECRET.
//
// FOUR THINGS THIS ROUTE REFUSES TO DO, each of which is how an unattended
// poster embarrasses itself in a public channel:
//
//   1. POST AN EMPTY BRIEF. `postable` is false when every upstream failed. A
//      post titled "Market Brief" with nothing under it reads as a flat market.
//      The run is recorded as failed and an alert is raised instead.
//
//   2. POST TWICE FOR ONE SESSION. Vercel Cron does not promise exactly-once
//      delivery, and a manual re-run after a fix is a normal thing to do. The
//      job claims the session date in KV before posting, so a second invocation
//      for the same trading day is a no-op that says so. `?force=1` overrides,
//      which is the deliberate path for "the first post was wrong".
//
//   3. RUN WITHOUT A DESTINATION. With no webhook configured the job reports
//      unconfigured rather than building a brief nobody receives.
//
//   4. LEAK THE WEBHOOK. The URL is a bearer credential. Nothing in the
//      response body or the run record carries more than a redacted form.
//
// `?dry=1` builds and renders WITHOUT posting, and returns the payload. It is
// still cron-authenticated — the brief is cheap but the upstream budget it
// spends is shared with every visitor to /markets.
// ---------------------------------------------------------------------------

import { kvGet, kvSet } from "@/lib/kv";

const JOB = "markets.brief";
/** Keyed by session date so one calendar trading day gets one post. Kept for
 *  a week: long enough that a late re-run is still recognised as a duplicate,
 *  short enough that the key set does not grow without bound. */
const postedKey = (sessionDate: string) => `cron:posted:${JOB}:${sessionDate}`;
const POSTED_TTL_SECONDS = 7 * 24 * 3600;

export async function GET(req: NextRequest) {
  const auth = requireCron(req);
  if (!auth.ok) return auth.res;

  const dry = req.nextUrl.searchParams.get("dry") === "1";
  const force = req.nextUrl.searchParams.get("force") === "1";
  const webhook = (process.env.DISCORD_MARKET_WEBHOOK_URL ?? "").trim();

  if (!dry && !webhook) {
    // Not an error state to alert on — an unconfigured deployment is a correct
    // deployment that cannot do this one thing, and it says so.
    return NextResponse.json(
      {
        job: JOB,
        status: "not_configured",
        detail:
          "DISCORD_MARKET_WEBHOOK_URL is not set. Create a webhook on the target Discord " +
          "channel (Edit Channel → Integrations → New Webhook) and set the URL in the " +
          "deployment's environment. Use ?dry=1 to build the brief without posting.",
      },
      { status: 503 }
    );
  }

  if (!dry && !isDiscordWebhookUrl(webhook)) {
    return NextResponse.json(
      {
        job: JOB,
        status: "misconfigured",
        detail:
          "DISCORD_MARKET_WEBHOOK_URL is set but is not an https Discord webhook URL " +
          "(expected https://discord.com/api/webhooks/<id>/<token>).",
      },
      { status: 503 }
    );
  }

  let payload: ReturnType<typeof renderBrief> | null = null;
  let summary: Record<string, unknown> = {};

  const outcome = await runJob(
    JOB,
    async (ctx) => {
      const brief = await buildBrief();

      ctx.metric("indices", brief.indices.length);
      ctx.metric("crypto", brief.crypto.length);
      ctx.metric("gainers", brief.gainers.length);
      ctx.metric("losers", brief.losers.length);
      ctx.metric("bullish", brief.bullish.length);
      ctx.metric("candidates_considered", brief.ranking.considered);
      for (const d of brief.degraded) ctx.note(d);

      ctx.metric("watchlist", brief.watchlist.length);
      ctx.metric("macro", Object.keys(brief.macro).length);
      ctx.metric("signals", brief.signals.length);

      summary = {
        sessionDate: brief.sessionDate,
        marketState: brief.marketState,
        // The narrative and the findings behind it. Every signal carries the
        // measurement that produced it, so an operator reviewing a run can
        // check each sentence without re-fetching anything.
        narrative: brief.narrative,
        signals: brief.signals,
        indices: brief.indices.map(({ series, ...r }) => ({ ...r, seriesPoints: series.length })),
        crypto: brief.crypto.map(({ series, ...r }) => ({ ...r, seriesPoints: series.length })),
        watchlist: brief.watchlist.map(({ series: _s, ...r }) => r),
        macro: brief.macro,
        gainers: brief.gainers,
        losers: brief.losers,
        bullish: brief.bullish.map((r) => ({
          symbol: r.symbol,
          name: r.name,
          price: r.price,
          changePercent: r.changePercent,
          score: r.score,
          available: r.available,
          reasons: r.reasons,
        })),
        breadth: brief.breadth,
        ranking: brief.ranking,
        degraded: brief.degraded,
      };

      if (!brief.postable) {
        ctx.metric("upstreams_all_failed", 1);
        await raiseAlert({
          kind: "markets.brief_unavailable",
          severity: "high",
          title: "Daily market brief could not be built",
          detail:
            "Every upstream failed, so there is nothing to post. " +
            (brief.degraded.join("; ") || "No detail reported."),
          dimensions: { job: JOB },
        });
        // Thrown so the runner records the run as failed rather than as a
        // successful pass that happened to post nothing.
        throw new Error("no_data: every market-data upstream failed");
      }

      payload = renderBrief(brief);

      if (dry) {
        ctx.note("Dry run — nothing was posted.");
        return;
      }

      // ---- Once per session -------------------------------------------
      if (!force) {
        const already = await kvGet<{ at: string }>(postedKey(brief.sessionDate)).catch(() => null);
        if (already) {
          ctx.metric("duplicate_suppressed", 1);
          ctx.note(`Already posted for session ${brief.sessionDate} at ${already.at}.`);
          summary = { ...summary, posted: false, reason: "already_posted_for_session" };
          return;
        }
      }

      const res = await postToDiscordWebhook(webhook, payload);
      if (!res.ok) {
        ctx.metric("post_failed", 1);
        await raiseAlert({
          kind: "markets.brief_post_failed",
          severity: "medium",
          title: "Daily market brief did not reach Discord",
          detail: res.error,
          dimensions: { job: JOB, target: redactWebhookUrl(webhook) },
        });
        throw new Error(res.error);
      }

      ctx.metric("posted", 1);
      if (res.retried) ctx.metric("rate_limited_retry", 1);
      // Claimed AFTER a confirmed 2xx. Claiming first would suppress tomorrow's
      // retry of a post that never actually landed.
      await kvSet(
        postedKey(brief.sessionDate),
        { at: new Date().toISOString(), status: res.status },
        POSTED_TTL_SECONDS
      ).catch(() => {
        // A lost claim costs at most one duplicate post, which is far better
        // than failing a run that already delivered.
        ctx.note("Post delivered, but the once-per-session claim could not be stored.");
      });
      summary = { ...summary, posted: true };
    },
    { budgetMs: 45_000 }
  );

  return NextResponse.json({
    job: JOB,
    status: outcome.status,
    dryRun: dry,
    target: dry ? null : redactWebhookUrl(webhook),
    brief: summary,
    /** Returned on a dry run so the exact bytes that would be posted can be
     *  inspected before they reach a public channel. */
    payload: dry ? payload : null,
    ...(outcome.status === "skipped_locked" ? { detail: outcome.detail } : { record: outcome.record }),
  });
}
