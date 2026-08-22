// ---------------------------------------------------------------------------
// Alerting.
//
// What this replaces: `needsAttention()` returning true into a log line. A log
// line is a record, not a notification — nobody is watching at 3am, and a
// reconciliation mismatch that nobody reads is indistinguishable from one that
// never happened.
//
// THE HARD PART IS NOT DELIVERY, IT IS NOISE. An alerting system that fires on
// every occurrence trains its audience to ignore it within a week, and then the
// one alert that mattered arrives into a muted channel. So the delivery
// adapters are the small part of this file and the suppression rules are the
// large one:
//
//   FINGERPRINT   Alerts are grouped by what is wrong, not by when. Fifty
//                 reconciliation mismatches on one account are one alert with a
//                 count, not fifty pages.
//   COOLDOWN      A fingerprint that has fired stays quiet for a window, so a
//                 job running every five minutes cannot page every five
//                 minutes for the same standing problem.
//   SEVERITY      Sets the cooldown. A critical alert repeats often enough to
//                 be impossible to miss; a medium one repeats daily.
//
// SUPPRESSION IS NOT SILENCE. A suppressed alert still increments its
// fingerprint's count and is still readable through `recentAlerts`. The
// notification is throttled; the record never is.
//
// DELIVERY IS BEST-EFFORT AND NEVER THROWS. An alerting failure must not fail
// the operation that raised the alert — a reconciler that crashes because Slack
// is down has turned a monitoring outage into a financial one.
// ---------------------------------------------------------------------------

import { createHash } from "crypto";
import { kvGet, kvIncr, kvListPush, kvListRange, kvSet } from "@/lib/kv";
import { log } from "@/lib/log";

export type Severity = "critical" | "high" | "medium";

export interface Alert {
  /** Stable identity of the PROBLEM, not the occurrence. */
  fingerprint: string;
  severity: Severity;
  title: string;
  detail: string;
  /** Structured context. Must never carry secrets or full PII. */
  context: Record<string, string | number | boolean | null>;
  raisedAt: string;
  /** How many times this fingerprint has fired inside the current window. */
  occurrences: number;
}

/**
 * How long a fingerprint stays quiet after notifying.
 *
 * Critical repeats every 15 minutes: often enough that a standing incident
 * cannot be forgotten, rare enough that it does not become wallpaper.
 */
const COOLDOWN_SECONDS: Record<Severity, number> = {
  critical: 15 * 60,
  high: 60 * 60,
  medium: 24 * 60 * 60,
};

const ALERT_TTL_SECONDS = 7 * 24 * 3600;
const HISTORY_MAX = 200;

const countKey = (fp: string) => `alert:count:${fp}`;
const recordKey = (fp: string) => `alert:last:${fp}`;
const historyKey = () => `alert:history`;
const ackKey = (fp: string) => `alert:ack:${fp}`;

/**
 * A stable fingerprint.
 *
 * Built from the alert KIND plus the identifying dimensions the caller
 * supplies — deliberately NOT from the detail string, which usually embeds a
 * timestamp or a changing count and would make every occurrence unique,
 * defeating suppression entirely.
 */
export function fingerprint(kind: string, dimensions: Record<string, string | number> = {}): string {
  const parts = Object.keys(dimensions)
    .sort()
    .map((k) => `${k}=${dimensions[k]}`)
    .join("|");
  return createHash("sha256").update(`${kind}::${parts}`).digest("hex").slice(0, 24);
}

// ---------------------------------------------------------------------------
// Sinks
// ---------------------------------------------------------------------------

export interface AlertSink {
  readonly name: string;
  /** Resolves true when delivered. Must never throw. */
  deliver(alert: Alert): Promise<boolean>;
}

/**
 * The always-present sink.
 *
 * Not a placeholder: a structured error log IS the durable record, and it is
 * what a log-drain or an error tracker ingests. It is simply not a
 * notification, which is why the others exist.
 */
class LogSink implements AlertSink {
  readonly name = "log";
  async deliver(alert: Alert): Promise<boolean> {
    log.error(`ALERT[${alert.severity}] ${alert.title}`, {
      fingerprint: alert.fingerprint,
      detail: alert.detail,
      occurrences: alert.occurrences,
      ...alert.context,
    });
    return true;
  }
}

/**
 * Slack via an incoming webhook.
 *
 * A webhook URL is the entire credential, so it is read from the environment
 * and never echoed — not into an alert body, not into a log line, not into the
 * readiness endpoint, which reports only whether one is configured.
 */
class SlackSink implements AlertSink {
  readonly name = "slack";
  constructor(private readonly webhookUrl: string) {}

  async deliver(alert: Alert): Promise<boolean> {
    const emoji = alert.severity === "critical" ? ":rotating_light:" : alert.severity === "high" ? ":warning:" : ":information_source:";
    const contextLines = Object.entries(alert.context)
      .slice(0, 12)
      .map(([k, v]) => `• *${k}*: ${String(v)}`)
      .join("\n");

    try {
      const res = await fetch(this.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `${emoji} *[${alert.severity.toUpperCase()}] ${alert.title}*`,
          blocks: [
            {
              type: "section",
              text: { type: "mrkdwn", text: `${emoji} *[${alert.severity.toUpperCase()}] ${alert.title}*\n${alert.detail}` },
            },
            ...(contextLines ? [{ type: "section", text: { type: "mrkdwn", text: contextLines } }] : []),
            {
              type: "context",
              elements: [
                {
                  type: "mrkdwn",
                  text: `fingerprint \`${alert.fingerprint}\` · ${alert.occurrences} occurrence(s) · ${alert.raisedAt}`,
                },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(5_000),
      });
      return res.ok;
    } catch {
      // Never throws. A Slack outage must not fail the reconciler.
      return false;
    }
  }
}

/** A generic JSON webhook — PagerDuty-compatible receivers, or anything else. */
class WebhookSink implements AlertSink {
  readonly name = "webhook";
  constructor(private readonly url: string) {}

  async deliver(alert: Alert): Promise<boolean> {
    try {
      const res = await fetch(this.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Shaped so a PagerDuty Events v2 receiver can consume it directly,
          // while staying readable to anything else.
          payload: {
            summary: alert.title,
            severity: alert.severity === "medium" ? "warning" : alert.severity,
            source: "furlpay",
            custom_details: { detail: alert.detail, ...alert.context },
          },
          dedup_key: alert.fingerprint,
          event_action: "trigger",
        }),
        signal: AbortSignal.timeout(5_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}

/**
 * The configured sinks.
 *
 * The log sink is ALWAYS included, so an alert is never lost merely because no
 * notifier is configured. Notifiers are additive.
 */
export function resolveSinks(): AlertSink[] {
  const sinks: AlertSink[] = [new LogSink()];

  const slack = (process.env.FURLPAY_ALERT_SLACK_WEBHOOK ?? "").trim();
  if (slack.startsWith("https://")) sinks.push(new SlackSink(slack));

  const webhook = (process.env.FURLPAY_ALERT_WEBHOOK_URL ?? "").trim();
  if (webhook.startsWith("https://")) sinks.push(new WebhookSink(webhook));

  return sinks;
}

/** Whether a real NOTIFIER (not just the log) is configured. */
export function notifierConfigured(): boolean {
  return resolveSinks().some((s) => s.name !== "log");
}

// ---------------------------------------------------------------------------
// Raising
// ---------------------------------------------------------------------------

export interface RaiseResult {
  fingerprint: string;
  /** False when suppressed by cooldown or acknowledgement. */
  notified: boolean;
  occurrences: number;
  suppressedBy: "cooldown" | "acknowledged" | null;
  delivered: string[];
}

/**
 * Raise an alert.
 *
 * Always records. Notifies only when the fingerprint is outside its cooldown
 * and has not been acknowledged.
 *
 * Never throws: a KV failure degrades to "notify anyway", because during an
 * infrastructure incident the wrong side to err on is silence.
 */
export async function raiseAlert(input: {
  kind: string;
  severity: Severity;
  title: string;
  detail: string;
  dimensions?: Record<string, string | number>;
  context?: Record<string, string | number | boolean | null>;
}): Promise<RaiseResult> {
  const fp = fingerprint(input.kind, input.dimensions);

  let occurrences = 1;
  let suppressedBy: RaiseResult["suppressedBy"] = null;

  try {
    occurrences = await kvIncr(countKey(fp), COOLDOWN_SECONDS[input.severity]);
  } catch {
    /* counting is a nicety; the alert still fires */
  }

  const alert: Alert = {
    fingerprint: fp,
    severity: input.severity,
    title: input.title,
    detail: input.detail,
    context: input.context ?? {},
    raisedAt: new Date().toISOString(),
    occurrences,
  };

  // Record first, so the alert exists even if every sink fails.
  try {
    await kvSet(recordKey(fp), alert, ALERT_TTL_SECONDS);
    await kvListPush(historyKey(), fp, HISTORY_MAX);
  } catch {
    /* delivery still attempted */
  }

  // Acknowledged: a human has seen this and is working on it. Still recorded.
  try {
    if (await kvGet(ackKey(fp))) suppressedBy = "acknowledged";
  } catch {
    /* not acknowledged as far as we can tell */
  }

  // The cooldown IS the counter's window. `kvIncr` sets the TTL when the
  // window opens and returns the running count, so `occurrences > 1` means
  // this fingerprint already notified inside the window — one atomic operation
  // rather than a separate flag that could disagree with the count.
  if (!suppressedBy && occurrences > 1) suppressedBy = "cooldown";

  if (suppressedBy) {
    return { fingerprint: fp, notified: false, occurrences, suppressedBy, delivered: [] };
  }

  const sinks = resolveSinks();
  const results = await Promise.all(
    sinks.map(async (s) => ({ name: s.name, ok: await s.deliver(alert).catch(() => false) }))
  );

  return {
    fingerprint: fp,
    notified: true,
    occurrences,
    suppressedBy: null,
    delivered: results.filter((r) => r.ok).map((r) => r.name),
  };
}

/** Acknowledge a fingerprint — suppress notifications while it is worked on. */
export async function acknowledgeAlert(fp: string, hours = 4): Promise<void> {
  await kvSet(ackKey(fp), { at: new Date().toISOString() }, Math.round(hours * 3600));
}

/** Recent alerts, newest first, for the ops console. */
export async function recentAlerts(limit = 50): Promise<Alert[]> {
  try {
    const fps = await kvListRange(historyKey(), limit);
    const unique = [...new Set(fps)];
    const alerts = await Promise.all(unique.map((fp) => kvGet<Alert>(recordKey(fp))));
    return alerts
      .filter((a): a is Alert => a !== null)
      .sort((a, b) => b.raisedAt.localeCompare(a.raisedAt));
  } catch {
    return [];
  }
}
