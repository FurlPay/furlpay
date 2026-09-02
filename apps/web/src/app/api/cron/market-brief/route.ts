import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { requireCron } from "@/lib/cron/auth";
import { runJob } from "@/lib/cron/runner";
import { raiseAlert } from "@/lib/alerts";
import { buildBrief } from "@/lib/markets/brief/brief";
import { renderBrief } from "@/lib/markets/brief/render";
import {
  previousEntry, recordPicks, scoreBoard, type BoardOutcome,
} from "@/lib/markets/brief/pickLedger";
import { batchQuotes } from "@/lib/markets/providers/yahooBatch";
import { renderTelegramBrief } from "@/lib/markets/brief/renderTelegram";
import { postToDiscordWebhook, isDiscordWebhookUrl, redactWebhookUrl } from "@/lib/discordWebhook";
import { postBriefAsBot, briefBotTarget } from "@/lib/priceCards/briefBot";
import { postToTelegram, looksLikeBotToken } from "@/lib/telegramPost";
import { kvGet, kvSet } from "@/lib/kv";

// ---------------------------------------------------------------------------
// GET /api/cron/market-brief — the daily market brief, posted to Discord and
// Telegram.
//
// Schedule: vercel.json, 21:30 UTC = 17:30 US/Eastern in EDT, an hour and a half
// after the US close. Deliberately not 16:00: the closing auction prints for
// several minutes and a screener queried at the bell reports the pre-auction
// tape as the close.
//
// ONCE A DAY IS A PLATFORM CEILING, NOT A PREFERENCE. This Vercel project's plan
// rejects cron expressions that fire more than once per day at deploy time (see
// lib/cron/runner.ts). A daily close brief happens to be exactly what fits; an
// intraday cadence needs an external scheduler calling this endpoint with
// FURLPAY_CRON_SECRET.
//
// TWO DESTINATIONS, INDEPENDENTLY DEGRADABLE. Discord and Telegram fail for
// unrelated reasons — a deleted webhook, a bot removed from a channel, one
// platform rate-limiting. Either configured destination is attempted, neither
// can prevent the other, and the run only FAILS when every configured
// destination failed. Delivering to one of two is a partial success and is
// recorded as exactly that, because reporting it as failure trains an operator
// to ignore this job's alerts.
//
// FIVE THINGS THIS ROUTE REFUSES TO DO, each of which is how an unattended
// poster embarrasses itself in public:
//
//   1. POST AN EMPTY BRIEF. `postable` is false when every upstream failed. A
//      post titled "Market Brief" with nothing under it reads as a flat market.
//      The run is recorded as failed and an alert is raised instead.
//
//   2. POST TWICE FOR ONE SESSION. Cron does not promise exactly-once delivery,
//      and a manual re-run after a fix is a normal thing to do. The job claims
//      the session date in KV after a confirmed delivery, so a second
//      invocation for the same trading day is a no-op that says so. `?force=1`
//      overrides, which is the deliberate path for "the first post was wrong".
//
//   3. RUN WITHOUT A DESTINATION. With neither configured the job reports
//      unconfigured rather than building a brief nobody receives.
//
//   4. LEAK A CREDENTIAL. A Discord webhook URL and a Telegram bot token are
//      both bearer credentials. Nothing in the response body or the run record
//      carries more than a redacted form.
//
//   5. RE-POST TO A DESTINATION THAT ALREADY RECEIVED IT. The session claim
//      records WHICH destinations succeeded, so a retry after a partial
//      delivery fills the gap instead of double-posting to the one that worked.
//
// `?dry=1` builds and renders for BOTH platforms without sending, and returns
// both payloads. It is still cron-authenticated — the brief is cheap but the
// upstream budget it spends is shared with every visitor to /markets.
// ---------------------------------------------------------------------------

const JOB = "markets.brief";

/** Keyed by session date so one calendar trading day gets one post. Kept for a
 *  week: long enough that a late re-run is still recognised as a duplicate,
 *  short enough that the key set does not grow without bound. */
const postedKey = (sessionDate: string) => `cron:posted:${JOB}:${sessionDate}`;
const POSTED_TTL_SECONDS = 7 * 24 * 3600;

interface SessionClaim {
  at: string;
  /** Destinations that have confirmed delivery for this session. */
  delivered: string[];
}

interface DeliveryOutcome {
  target: string;
  ok: boolean;
  detail: string;
  skipped?: "not_configured" | "already_delivered";
}

export async function GET(req: NextRequest) {
  const auth = requireCron(req);
  if (!auth.ok) return auth.res;

  const dry = req.nextUrl.searchParams.get("dry") === "1";
  const force = req.nextUrl.searchParams.get("force") === "1";

  const webhook = (process.env.DISCORD_MARKET_WEBHOOK_URL ?? "").trim();
  const tgToken = (process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
  const tgChat = (process.env.TELEGRAM_MARKET_CHAT_ID ?? process.env.TELEGRAM_CHANNEL_ID ?? "").trim();

  // Two ways to reach Discord. A webhook is the simplest and needs no bot in
  // the server; posting as the bot needs a token and a channel id but no
  // webhook, and is what a deployment already running the price cards has to
  // hand. The webhook wins when both are set, because it is the older path and
  // switching author mid-history would look like two different publishers.
  const bot = briefBotTarget();
  const discordReady = isDiscordWebhookUrl(webhook) || bot !== null;
  const telegramReady = looksLikeBotToken(tgToken) && tgChat.length > 0;

  if (!dry && !discordReady && !telegramReady) {
    // Not an error state to alert on — an unconfigured deployment is a correct
    // deployment that cannot do this one thing, and it says so.
    return NextResponse.json(
      {
        job: JOB,
        status: "not_configured",
        detail:
          "No destination is configured. Set DISCORD_MARKET_WEBHOOK_URL (Edit Channel → " +
          "Integrations → New Webhook), or DISCORD_BOT_TOKEN plus " +
          "MARKET_BRIEF_CHANNEL_ID to post as the bot, and/or TELEGRAM_BOT_TOKEN plus " +
          "TELEGRAM_MARKET_CHAT_ID. Use ?dry=1 to build the brief without sending.",
        discord: webhook ? "set but not a valid Discord webhook URL" : "unset",
        telegram: tgToken
          ? tgChat
            ? "token set but malformed"
            : "token set, chat id unset"
          : "unset",
      },
      { status: 503 }
    );
  }

  let discordPayload: ReturnType<typeof renderBrief> | null = null;
  let telegramPayload: ReturnType<typeof renderTelegramBrief> | null = null;
  let summary: Record<string, unknown> = {};
  const deliveries: DeliveryOutcome[] = [];

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
      ctx.metric("watchlist", brief.watchlist.length);
      ctx.metric("macro", Object.keys(brief.macro).length);
      ctx.metric("signals", brief.signals.length);
      for (const d of brief.degraded) ctx.note(d);

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

      // ---- Score the LAST board, then record today's ----------------------
      //
      // Order matters: `previousEntry` must run before today's board is
      // written, or the brief would score itself against its own prices and
      // report a very consistent zero.
      let lastBoard: BoardOutcome | null = null;
      try {
        const prev = await previousEntry(brief.sessionDate);
        if (prev) {
          const quotes = await batchQuotes(prev.picks.map((p) => p.symbol)).catch(() => new Map());
          lastBoard = scoreBoard(
            prev,
            (sym) => {
              const q = quotes.get(sym);
              return typeof q?.price === "number" && Number.isFinite(q.price) ? q.price : null;
            },
            new Date(brief.generatedAt)
          );
          ctx.metric("scored_picks", lastBoard.priced);
          if (lastBoard.winners !== null) ctx.metric("scored_winners", lastBoard.winners);
        }
      } catch {
        // A scoreboard that cannot be computed costs the section, not the brief.
        ctx.note("Could not score the previous board; publishing without it.");
      }

      // Written after scoring, and never overwritten: see pickLedger.
      if (brief.bullish.length > 0) {
        const wrote = await recordPicks({
          sessionDate: brief.sessionDate,
          publishedAt: brief.generatedAt,
          picks: brief.bullish.slice(0, 5).map((b) => ({
            symbol: b.symbol,
            referencePrice: b.price,
            score: b.score,
            changePercentThatDay: b.changePercent,
          })),
        }).catch(() => "already-recorded" as const);
        ctx.note(`Pick ledger: ${wrote}.`);
      }

      discordPayload = renderBrief(brief, lastBoard);
      telegramPayload = renderTelegramBrief(brief);
      ctx.metric("telegram_chars", telegramPayload.text.length);
      for (const name of telegramPayload.omitted) {
        ctx.note(`Telegram: "${name}" omitted to fit the 4096-character limit.`);
      }

      if (dry) {
        ctx.note("Dry run — nothing was sent.");
        return;
      }

      // ---- Once per session, per destination ---------------------------
      let claim: SessionClaim | null = null;
      if (!force) {
        claim = await kvGet<SessionClaim>(postedKey(brief.sessionDate)).catch(() => null);
      }
      const alreadyDelivered = new Set(claim?.delivered ?? []);

      // ---- Discord ------------------------------------------------------
      if (!discordReady) {
        deliveries.push({
          target: "discord",
          ok: false,
          skipped: "not_configured",
          detail: "DISCORD_MARKET_WEBHOOK_URL is unset or not a valid Discord webhook URL.",
        });
      } else if (alreadyDelivered.has("discord")) {
        deliveries.push({
          target: "discord",
          ok: true,
          skipped: "already_delivered",
          detail: `Already delivered for session ${brief.sessionDate}.`,
        });
        ctx.metric("duplicate_suppressed", 1);
      } else {
        const res = isDiscordWebhookUrl(webhook)
          ? await postToDiscordWebhook(webhook, discordPayload)
          : await postBriefAsBot(bot!, discordPayload);
        deliveries.push({
          target: "discord",
          ok: res.ok,
          detail: res.ok ? `HTTP ${res.status}` : (res.error ?? "unknown error"),
        });
        if (res.ok) {
          ctx.metric("posted_discord", 1);
          if (res.retried) ctx.metric("rate_limited_retry", 1);
        } else {
          ctx.metric("post_failed_discord", 1);
          await raiseAlert({
            kind: "markets.brief_post_failed",
            severity: "medium",
            title: "Daily market brief did not reach Discord",
            detail: res.error ?? "unknown error",
            dimensions: {
              job: JOB,
              // Redacted either way; the bot path has no URL to leak.
              target: isDiscordWebhookUrl(webhook) ? redactWebhookUrl(webhook) : "discord-bot",
            },
          });
        }
      }

      // ---- Telegram -----------------------------------------------------
      if (!telegramReady) {
        deliveries.push({
          target: "telegram",
          ok: false,
          skipped: "not_configured",
          detail: "TELEGRAM_BOT_TOKEN and/or TELEGRAM_MARKET_CHAT_ID is unset or malformed.",
        });
      } else if (alreadyDelivered.has("telegram")) {
        deliveries.push({
          target: "telegram",
          ok: true,
          skipped: "already_delivered",
          detail: `Already delivered for session ${brief.sessionDate}.`,
        });
        ctx.metric("duplicate_suppressed", 1);
      } else {
        const res = await postToTelegram(tgToken, tgChat, telegramPayload.text, {
          buttons: telegramPayload.buttons,
        });
        deliveries.push({
          target: "telegram",
          ok: res.ok,
          detail: res.ok ? `message ${res.messageId ?? "sent"}` : res.error,
        });
        if (res.ok) {
          ctx.metric("posted_telegram", 1);
          if (res.retried) ctx.metric("rate_limited_retry", 1);
        } else {
          ctx.metric("post_failed_telegram", 1);
          await raiseAlert({
            kind: "markets.brief_post_failed",
            severity: "medium",
            title: "Daily market brief did not reach Telegram",
            detail: res.error,
            dimensions: { job: JOB, target: `telegram:${tgChat}` },
          });
        }
      }

      // ---- Record what actually landed ----------------------------------
      const attempted = deliveries.filter((d) => d.skipped !== "not_configured");
      const succeeded = attempted.filter((d) => d.ok);

      if (succeeded.length > 0) {
        // Claimed AFTER confirmed delivery, and only for the destinations that
        // confirmed. Claiming first would suppress tomorrow's retry of a post
        // that never actually landed; claiming all would skip the one that
        // failed on the next run.
        const delivered = [...new Set([...alreadyDelivered, ...succeeded.map((d) => d.target)])];
        await kvSet(
          postedKey(brief.sessionDate),
          { at: new Date().toISOString(), delivered } satisfies SessionClaim,
          POSTED_TTL_SECONDS
        ).catch(() => {
          ctx.note("Delivered, but the once-per-session claim could not be stored.");
        });
      }

      summary = {
        ...summary,
        posted: succeeded.length > 0,
        delivered: succeeded.map((d) => d.target),
        failed: attempted.filter((d) => !d.ok).map((d) => d.target),
      };

      // Fail the run only when every ATTEMPTED destination failed. One of two
      // is a partial success, noted and alerted on, but not a failed run.
      if (attempted.length > 0 && succeeded.length === 0) {
        throw new Error(
          `every destination failed: ${attempted.map((d) => `${d.target}: ${d.detail}`).join("; ")}`
        );
      }
      if (attempted.length > succeeded.length) {
        ctx.note(
          `Partial delivery: ${succeeded.map((d) => d.target).join(", ") || "none"} succeeded; ` +
            `${attempted.filter((d) => !d.ok).map((d) => d.target).join(", ")} failed.`
        );
      }
    },
    { budgetMs: 45_000 }
  );

  return NextResponse.json({
    job: JOB,
    status: outcome.status,
    dryRun: dry,
    targets: {
      discord: dry
        ? discordReady
          ? isDiscordWebhookUrl(webhook) ? "configured (webhook)" : "configured (bot)"
          : "not configured"
        : isDiscordWebhookUrl(webhook) ? redactWebhookUrl(webhook) : "bot",
      telegram: telegramReady ? `chat ${tgChat}` : "not configured",
    },
    deliveries,
    brief: summary,
    /** Returned on a dry run so the exact bytes that would be sent can be
     *  inspected before they reach a public channel. */
    payload: dry ? { discord: discordPayload, telegram: telegramPayload } : null,
    ...(outcome.status === "skipped_locked" ? { detail: outcome.detail } : { record: outcome.record }),
  });
}
