import { kvGet, kvSet } from "@/lib/kv";
import { recordSecurityEvent } from "@/lib/ops/events";

// ---------------------------------------------------------------------------
// Contextual anomaly signals for privileged access: WHERE and WHEN.
//
// `dataAccessAnomaly.ts` answers "how much" — volume per actor per window. It
// cannot see a compromised credential used carefully: one dossier read, from a
// country the officer has never worked from, at 03:40 local. That is the shape of
// a stolen session, and it is invisible to a counter.
//
// WHAT IS STORED, AND WHY IT IS THIS LITTLE.
//
// Per actor: a two-letter country code and a timestamp. That is the whole record.
//
//   · No IP address. No city. No coordinates. No GPS, ever.
//   · No history — one previous country, overwritten each time.
//   · Keyed by actor id, which is already in every audit row.
//
// The purpose is detecting a COMPROMISED PRIVILEGED ACCOUNT, not building a
// movement profile of an employee. A system that knows which city a compliance
// officer slept in has become the surveillance apparatus it was meant to protect
// customers from, and it would be a far more attractive target than the thing it
// guards. Country granularity is enough to notice "Milan yesterday, Lagos now"
// and too coarse to follow anyone around.
//
// NO DISTANCE TABLE, DELIBERATELY.
//
// The obvious implementation pairs countries with a travel-time matrix. That
// means inventing a lookup table of geographic guesses, which goes stale, is
// wrong at the edges, and is exactly the sort of guess-map this codebase avoids.
//
// Instead the rule is time-only: the same actor appearing in two DIFFERENT
// countries inside a short window is implausible whichever countries they are.
// This is cruder and it is honest. The cost is named below.
//
// KNOWN FALSE POSITIVE, STATED UP FRONT.
//
// Someone living near a border, or on a VPN that shifts exit country, will trip
// the country-change signal legitimately. The threshold is therefore set where a
// physical explanation is genuinely hard rather than merely unusual, the event is
// `medium` rather than `high`, and the copy tells the responder that a VPN is the
// first thing to rule out. An alert that fires on a commute gets muted, and a
// muted alert is worse than none.
// ---------------------------------------------------------------------------

export interface AccessContext {
  actorId: string;
  /** ISO 3166-1 alpha-2, from `x-vercel-ip-country` / `cf-ipcountry`. */
  country?: string | null;
  /** What the actor was doing. Used only in the alert text. */
  action: string;
  /** Injectable for tests; defaults to now. */
  now?: Date;
}

interface LastSeen {
  country: string;
  atMs: number;
}

/**
 * Minutes below which two different countries are treated as implausible.
 *
 * 90 by default. Short enough that a same-day intercontinental hop is caught,
 * long enough that a train across a European border is not. Configurable because
 * the right number depends on where a team actually works, and a threshold
 * nobody can tune is a threshold that gets deleted.
 */
function implausibleWindowMinutes(): number {
  const raw = Number(process.env.FURLPAY_GEO_ANOMALY_MINUTES);
  return Number.isFinite(raw) && raw > 0 ? raw : 90;
}

/**
 * UTC hours considered outside normal working hours.
 *
 * UTC ON PURPOSE. Converting to the actor's local time would need their
 * timezone, which means storing where they are — the thing this module exists to
 * avoid. UTC is a blunter instrument that leaks nothing: it flags activity in a
 * window that is night across most of EMEA, and a distributed team will want to
 * widen or disable it rather than have it cry wolf.
 */
function offHoursUtc(): { start: number; end: number } | null {
  const raw = process.env.FURLPAY_OFFHOURS_UTC;
  if (raw === "off") return null;
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(raw ?? "");
  if (m) {
    const [start, end] = [Number(m[1]), Number(m[2])];
    if (start >= 0 && start < 24 && end >= 0 && end < 24) return { start, end };
  }
  return { start: 1, end: 5 };
}

function inWindow(hour: number, w: { start: number; end: number }): boolean {
  // Handles a window that wraps midnight (e.g. 22-04).
  return w.start <= w.end ? hour >= w.start && hour < w.end : hour >= w.start || hour < w.end;
}

const lastSeenKey = (actorId: string) => `geoctx:last:${actorId}`;
/** 30 days. A country from last quarter tells you nothing about today. */
const LAST_SEEN_TTL_SECONDS = 30 * 24 * 3600;

export interface ContextVerdict {
  countryChanged: boolean;
  implausibleTravel: boolean;
  offHours: boolean;
  /** Null when no country was supplied — the honest "we do not know". */
  previousCountry: string | null;
}

/**
 * Record the context of one privileged action and flag what looks wrong.
 *
 * Never throws and never blocks. Same contract as the volume detector: this sits
 * inline on compliance actions, and a telemetry store being down must not fail a
 * statutory disclosure.
 *
 * A MISSING COUNTRY IS NOT AN ANOMALY. Self-hosted, local, or a proxy that strips
 * the header all produce `undefined`, and treating absence as suspicious would
 * make the detector fire constantly in exactly the deployments least able to
 * investigate it. Unknown means unknown.
 */
export async function noteAccessContext(ctx: AccessContext): Promise<ContextVerdict> {
  const now = ctx.now ?? new Date();
  const verdict: ContextVerdict = {
    countryChanged: false,
    implausibleTravel: false,
    offHours: false,
    previousCountry: null,
  };

  try {
    // ── WHEN ────────────────────────────────────────────────────────────────
    const window = offHoursUtc();
    if (window && inWindow(now.getUTCHours(), window)) {
      verdict.offHours = true;
      await recordSecurityEvent({
        rail: "transfers",
        kind: "anomaly_offhours_privileged_action",
        severity: "low",
        detail:
          `Privileged action '${ctx.action}' by ${ctx.actorId} at ` +
          `${now.toISOString().slice(11, 16)} UTC, inside the configured ` +
          `off-hours window ${window.start}-${window.end} UTC.`,
        actor: ctx.actorId,
      });
    }

    // ── WHERE ───────────────────────────────────────────────────────────────
    const country = (ctx.country ?? "").trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) return verdict;

    const previous = await kvGet<LastSeen>(lastSeenKey(ctx.actorId));
    // Written before any alerting, so a throw in the notifier cannot leave the
    // actor's position unrecorded and re-fire the same alert next time.
    await kvSet(lastSeenKey(ctx.actorId), { country, atMs: now.getTime() }, LAST_SEEN_TTL_SECONDS);

    if (!previous?.country) return verdict;
    verdict.previousCountry = previous.country;
    if (previous.country === country) return verdict;

    verdict.countryChanged = true;
    const minutesApart = (now.getTime() - previous.atMs) / 60_000;
    verdict.implausibleTravel = minutesApart >= 0 && minutesApart < implausibleWindowMinutes();

    await recordSecurityEvent({
      rail: "transfers",
      kind: verdict.implausibleTravel
        ? "anomaly_implausible_travel"
        : "anomaly_privileged_country_change",
      // MEDIUM, not high. A VPN produces this legitimately, and the responder's
      // first question is which one it was — see the false-positive note above.
      severity: "medium",
      detail:
        `Privileged actor ${ctx.actorId} performed '${ctx.action}' from ${country}, ` +
        `previously ${previous.country} ${Math.round(minutesApart)} minutes ago` +
        (verdict.implausibleTravel
          ? `. Physical travel in that time is implausible — rule out a VPN or proxy exit change, then treat as a possible session compromise.`
          : `. Confirm the actor is travelling.`),
      actor: ctx.actorId,
    });
  } catch {
    // Telemetry degrades; the controls it sits beside do not depend on it.
  }

  return verdict;
}

/** Exposed so an ops page can show the policy, and for tests. */
export function accessContextPolicy(): {
  implausibleWindowMinutes: number;
  offHoursUtc: { start: number; end: number } | null;
  storedFields: string[];
} {
  return {
    implausibleWindowMinutes: implausibleWindowMinutes(),
    offHoursUtc: offHoursUtc(),
    // Enumerated so the privacy claim is inspectable rather than asserted.
    storedFields: ["actorId", "country (ISO-3166 alpha-2)", "timestamp"],
  };
}
