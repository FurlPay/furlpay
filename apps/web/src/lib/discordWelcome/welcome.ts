// ---------------------------------------------------------------------------
// The sweep: decide who is new, greet each one exactly once, and record it.
//
// ── EXACTLY ONCE IS THE WHOLE PROBLEM ──────────────────────────────────────
//
// A gateway bot gets one `guildMemberAdd` per join and the socket does the
// de-duplication. A sweep sees the same member on every run for as long as they
// remain in the server, so "have I already greeted this person" has to be a
// fact we store rather than a fact we receive.
//
// The record is a per-member key written with SET-IF-ABSENT, which is what
// makes it safe rather than merely likely: two sweeps racing on the same member
// both attempt the claim and exactly one wins. A read-then-write would let both
// read "not greeted" and both post.
//
// ── THE FIRST RUN IS THE DANGEROUS ONE ─────────────────────────────────────
//
// On the very first sweep there are no records, so every existing member of the
// server looks new. Greeting all of them at once is the single worst thing this
// feature could do, and it is the default behaviour of the obvious
// implementation. So the first run SEEDS: it claims everyone it can see and
// greets nobody, and normal operation begins from the run after that.
//
// ── A FAILED POST MUST NOT COUNT AS A WELCOME ──────────────────────────────
//
// The claim is taken before posting, so a crash mid-post cannot double-greet.
// But if the post then fails for an ordinary reason — a 500 from Discord, a
// timeout — the claim is RELEASED so the next sweep retries. Keeping it would
// mean one transient error silently costs that member their welcome forever.
// ---------------------------------------------------------------------------

import { kvDel, kvGet, kvSet, kvSetNx } from "@/lib/kv";
import { log } from "@/lib/log";
import { botToken, welcomeConfig, type WelcomeConfig } from "./config";
import { detectJoins, type JoinEvent } from "./detect";
import { buildWelcomeDm, buildWelcomeMessage } from "./embed";
import { displayName } from "./identity";
import { getChannel, postMessage, sendDirectMessage } from "./rest";

/** How long a "this member has been welcomed" record survives. Long enough
 *  that a member is not re-greeted on any realistic schedule. */
const CLAIM_TTL_SECONDS = 60 * 60 * 24 * 90;

/** Marks that the guild has been seeded, so later runs are not "first runs". */
const INIT_TTL_SECONDS = 60 * 60 * 24 * 365;

/** Stop before the runner's own budget so the report still gets written. */
const SAFETY_MARGIN_MS = 5_000;

const initKey = (guildId: string) => `discord:welcome:init:${guildId}`;
const claimKey = (guildId: string, userId: string) => `discord:welcome:done:${guildId}:${userId}`;

export interface WelcomeOutcome {
  userId: string;
  name: string;
  ok: boolean;
  channelMessageId?: string;
  dmSent?: boolean;
  dmError?: string;
  error?: string;
}

export interface SweepReport {
  skipped?: boolean;
  reason?: string;
  misconfigured?: boolean;
  firstRun?: boolean;
  seeded?: number;
  source?: string | null;
  degraded?: string | null;
  channel?: string;
  scanned?: number;
  eligible?: number;
  welcomed?: number;
  failed?: number;
  alreadyWelcomed?: number;
  results?: WelcomeOutcome[];
  error?: string;
  dryRun?: boolean;
  /**
   * On a dry run only: the exact payload that would be posted, for a real
   * member of this server.
   *
   * The point is to make the message reviewable BEFORE it is switched on. A
   * report that says "would welcome 1 member" does not tell you the avatar
   * resolves, the mention is a real mention, or the channel link points
   * somewhere; the payload does.
   */
  preview?: Record<string, unknown>;
  previewFor?: string;
}

export interface SweepOptions {
  /** Render and report without posting to Discord or writing any claim. */
  dry?: boolean;
  /** Budget check from the job runner. */
  expired?: () => boolean;
  remainingMs?: () => number;
  /** Injectable clock, for tests. */
  now?: () => number;
}

/** Whether this member should be greeted at all, before any storage is read. */
export function isEligible(
  join: JoinEvent,
  cfg: WelcomeConfig,
  nowMs: number
): { eligible: boolean; reason?: string } {
  const user = join.member.user;
  if (!user?.id) return { eligible: false, reason: "no user id" };
  if (user.bot && !cfg.includeBots) return { eligible: false, reason: "bot" };

  const ageHours = (nowMs - join.joinedAt) / 3_600_000;
  if (ageHours > cfg.maxAgeHours) {
    // Deliberately not greeted AND deliberately not claimed here — the caller
    // claims these so a long outage does not produce a burst of late welcomes
    // the next time the sweep runs.
    return { eligible: false, reason: "older than the welcome window" };
  }
  // A join timestamp in the future is a clock problem, not a join. Greet it
  // rather than dropping it: the member is real either way.
  return { eligible: true };
}

/**
 * Run one sweep.
 *
 * Never throws. Every failure path returns a report the job runner can record,
 * because a welcome that did not happen is worth exactly as much attention as
 * one that did, and an exception here would take the whole cron with it.
 */
export async function runWelcomeSweep(opts: SweepOptions = {}): Promise<SweepReport> {
  const now = opts.now ?? Date.now;
  const expired = opts.expired ?? (() => false);
  const dry = opts.dry === true;

  const token = botToken();
  if (!token) {
    return { skipped: true, reason: "DISCORD_BOT_TOKEN is not set" };
  }

  const cfgResult = welcomeConfig();
  if (!cfgResult.ok) {
    return { skipped: true, reason: cfgResult.reason, misconfigured: cfgResult.misconfigured };
  }
  const cfg = cfgResult.config;

  // Confirm the destination before doing any work, so an operator gets
  // "the bot cannot see #general" rather than "0 welcomed".
  let channelName: string | undefined;
  if (cfg.channelEnabled && cfg.channelId) {
    const chan = await getChannel(token, cfg.channelId);
    if (!chan.ok) {
      return { skipped: true, reason: chan.error, misconfigured: true };
    }
    channelName = chan.data.name;
  }

  const detected = await detectJoins(token, cfg);
  if (!detected.ok) {
    return {
      skipped: true,
      reason: detected.error ?? "could not determine who joined",
      degraded: detected.degraded,
      misconfigured: true,
    };
  }

  const nowMs = now();
  const messageOptions = {
    guildId: cfg.guildId,
    startHereChannelId: cfg.startHereChannelId,
    securityNote: cfg.securityNote,
  };

  const base: SweepReport = {
    source: detected.source,
    degraded: detected.degraded,
    channel: channelName ?? cfg.channelId ?? undefined,
    scanned: detected.joins.length,
    dryRun: dry || undefined,
  };

  // Render one real message on a dry run, even when nobody is eligible — the
  // most common time to want a preview is before the first member ever joins.
  if (dry) {
    const sample = detected.joins.find((j) => j.member.user && !j.member.user.bot) ?? detected.joins[0];
    if (sample) {
      base.preview = buildWelcomeMessage(sample.member, messageOptions);
      base.previewFor = displayName(sample.member);
    }
  }

  // ---- First run: seed, do not greet -----------------------------------
  const seenBefore = await kvGet<string>(initKey(cfg.guildId)).catch(() => null);
  if (!seenBefore && !cfg.backfillOnFirstRun) {
    if (dry) {
      return { ...base, firstRun: true, seeded: 0, welcomed: 0, reason: "first run would seed, not greet" };
    }
    let seeded = 0;
    for (const join of detected.joins) {
      const id = join.member.user?.id;
      if (!id) continue;
      const claimed = await kvSetNx(claimKey(cfg.guildId, id), new Date(nowMs).toISOString(), CLAIM_TTL_SECONDS).catch(
        () => false
      );
      if (claimed) seeded++;
    }
    await kvSet(initKey(cfg.guildId), new Date(nowMs).toISOString(), INIT_TTL_SECONDS).catch(() => {});
    log.info("discord welcome seeded", { guildId: cfg.guildId, seeded, source: detected.source });
    return {
      ...base,
      firstRun: true,
      seeded,
      welcomed: 0,
      reason:
        "First run: existing members recorded as already welcomed so nobody is greeted retroactively. " +
        "Subsequent runs greet new joins.",
    };
  }

  // ---- Normal run -------------------------------------------------------
  const results: WelcomeOutcome[] = [];
  let alreadyWelcomed = 0;
  let eligible = 0;

  for (const join of detected.joins) {
    if (expired() || (opts.remainingMs?.() ?? Infinity) < SAFETY_MARGIN_MS) {
      // Stop cleanly and say so. The unclaimed remainder is picked up next run.
      log.warn("discord welcome sweep stopped on budget", { guildId: cfg.guildId });
      break;
    }

    const user = join.member.user;
    const id = user?.id;
    if (!id) continue;

    const check = isEligible(join, cfg, nowMs);
    if (!check.eligible) {
      // Claim the too-old ones anyway, so they never become a late burst.
      if (check.reason === "older than the welcome window" && !dry) {
        await kvSetNx(claimKey(cfg.guildId, id), new Date(nowMs).toISOString(), CLAIM_TTL_SECONDS).catch(() => false);
      }
      continue;
    }
    eligible++;

    // The claim IS the duplicate protection. Taken before posting.
    const claimed = dry
      ? true
      : await kvSetNx(claimKey(cfg.guildId, id), new Date(nowMs).toISOString(), CLAIM_TTL_SECONDS).catch(() => false);
    if (!claimed) {
      alreadyWelcomed++;
      continue;
    }

    const name = displayName(join.member);
    const messageOpts = messageOptions;

    if (dry) {
      results.push({ userId: id, name, ok: true });
      continue;
    }

    let outcome: WelcomeOutcome = { userId: id, name, ok: true };

    if (cfg.channelEnabled && cfg.channelId) {
      const posted = await postMessage(token, cfg.channelId, buildWelcomeMessage(join.member, messageOpts));
      if (posted.ok) {
        outcome.channelMessageId = posted.data.id;
      } else {
        // Release the claim so the next sweep retries this member.
        await kvDel(claimKey(cfg.guildId, id)).catch(() => {});
        outcome = { userId: id, name, ok: false, error: posted.error };
      }
    }

    // The DM is best-effort and never affects the claim: a member with DMs
    // closed has not failed to be welcomed, they have declined a DM.
    if (outcome.ok && cfg.dmEnabled) {
      const dm = await sendDirectMessage(token, id, buildWelcomeDm(join.member, messageOpts));
      outcome.dmSent = dm.ok;
      if (!dm.ok) outcome.dmError = dm.error;
    }

    results.push(outcome);
  }

  const welcomed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;

  log.info("discord welcome sweep finished", {
    guildId: cfg.guildId,
    source: detected.source,
    welcomed,
    failed,
    alreadyWelcomed,
  });

  return { ...base, eligible, welcomed, failed, alreadyWelcomed, results };
}
