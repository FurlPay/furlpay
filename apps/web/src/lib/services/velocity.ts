import { kvGet, kvIncr, kvIncrBy, kvSet } from "../kv";

// ---------------------------------------------------------------------------
// Cross-instance transaction velocity — the fraud-report layer the in-memory
// policyEngine can't provide: its rolling window lives in the account's
// transaction list, which is per-serverless-instance until the Supabase
// cutover. These counters live on the durable KV layer (Upstash Redis), so a
// mule spreading requests across lambdas still trips the caps.
//
// Sumsub Identity Fraud Report 2025-26 signals implemented here:
//   - burst velocity   (>N money moves per minute → bot/agent behavior)
//   - daily USD volume (structuring / cash-out runs)
//   - impossible travel (country hop faster than a plane, from the CDN's
//     IP-country header — no geo API needed)
//
// check() is read-only; commit() records AFTER the money actually moved, so
// declined/failed attempts can never lock a victim out (same reasoning as
// policyEngine's decline handling). Both fail open: fraud heuristics must
// never take payments down — same stance as rate limiting.
// ---------------------------------------------------------------------------

const TX_PER_MIN_CAP = 5;
const USD_PER_DAY_CAP = 5_000;
const GEO_WINDOW_SECONDS = 2 * 3600; // country change within 2h = impossible travel

const minuteKey = (userId: string) => `vel:tx:${userId}:${new Date().toISOString().slice(0, 16)}`;
const dayKey = (userId: string) => `vel:usd:${userId}:${new Date().toISOString().slice(0, 10)}`;
const geoKey = (userId: string) => `vel:geo:${userId}`;

export interface VelocityVerdict {
  /** allow — proceed; review — require step-up MFA; block — refuse. */
  action: "allow" | "review" | "block";
  reasons: string[];
  flags: { burst: boolean; dailyVolume: boolean; geoJump: boolean };
}

/** Read-only pre-check. `country` comes from the `x-vercel-ip-country`
 *  header (absent locally — geo check simply no-ops). */
export async function checkVelocity(input: {
  userId: string;
  amountUsd: number;
  country?: string | null;
}): Promise<VelocityVerdict> {
  const reasons: string[] = [];
  const flags = { burst: false, dailyVolume: false, geoJump: false };
  try {
    const [txCount, usdCents, lastGeo] = await Promise.all([
      kvGet<number>(minuteKey(input.userId)),
      kvGet<number>(dayKey(input.userId)),
      kvGet<{ c: string; at: string }>(geoKey(input.userId)),
    ]);

    if ((txCount ?? 0) >= TX_PER_MIN_CAP) {
      flags.burst = true;
      reasons.push(`More than ${TX_PER_MIN_CAP} money movements in a minute`);
    }
    if ((usdCents ?? 0) / 100 + input.amountUsd > USD_PER_DAY_CAP) {
      flags.dailyVolume = true;
      reasons.push(`Daily volume above $${USD_PER_DAY_CAP.toLocaleString("en-US")}`);
    }
    if (input.country && lastGeo && lastGeo.c !== input.country) {
      flags.geoJump = true;
      reasons.push(`Country changed ${lastGeo.c} → ${input.country} within 2 hours`);
    }
  } catch {
    return { action: "allow", reasons: ["velocity check unavailable (fail-open)"], flags };
  }

  // Burst = bot/agent signature → hard stop. Volume or geo anomalies are
  // legitimate often enough (travel day, big purchase) that they step up to
  // MFA instead of blocking.
  const action = flags.burst ? "block" : flags.dailyVolume || flags.geoJump ? "review" : "allow";
  return { action, reasons, flags };
}

/** Record a completed money movement into the velocity windows. */
export async function commitVelocity(input: {
  userId: string;
  amountUsd: number;
  country?: string | null;
}): Promise<void> {
  try {
    await Promise.all([
      kvIncr(minuteKey(input.userId), 120),
      kvIncrBy(dayKey(input.userId), input.amountUsd * 100, 86_400),
      input.country
        ? kvSet(geoKey(input.userId), { c: input.country, at: new Date().toISOString() }, GEO_WINDOW_SECONDS)
        : Promise.resolve(),
    ]);
  } catch {
    // Fail open — see module comment.
  }
}

/**
 * Check AND count in one step — for callers that must not be outrun.
 *
 * checkVelocity reads, the caller acts, commitVelocity counts afterwards: ten
 * concurrent requests all read the same counters and all pass. Here the
 * counters are incremented first (INCR/INCRBY are atomic) and the verdict is
 * taken from the values AFTER this request, so the sixth request in a minute
 * sees 6 whatever the interleaving. A blocked request gives its amount back
 * so a refusal does not eat the day's volume; the burst slot stays spent,
 * since an attempt is what the burst cap counts.
 *
 * Fails open like checkVelocity: a KV outage must not stop all money
 * movement, and the route-level rate limits still apply.
 */
export async function reserveVelocity(input: {
  userId: string;
  amountUsd: number;
  country?: string | null;
}): Promise<VelocityVerdict> {
  const reasons: string[] = [];
  const flags = { burst: false, dailyVolume: false, geoJump: false };
  const cents = Math.round(input.amountUsd * 100);
  try {
    const [txCount, usdCents, lastGeo] = await Promise.all([
      kvIncr(minuteKey(input.userId), 120),
      kvIncrBy(dayKey(input.userId), cents, 86_400),
      kvGet<{ c: string; at: string }>(geoKey(input.userId)),
    ]);
    if (txCount > TX_PER_MIN_CAP) {
      flags.burst = true;
      reasons.push(`More than ${TX_PER_MIN_CAP} money movements in a minute`);
    }
    if (usdCents / 100 > USD_PER_DAY_CAP) {
      flags.dailyVolume = true;
      reasons.push(`Daily volume above $${USD_PER_DAY_CAP.toLocaleString("en-US")}`);
    }
    if (input.country && lastGeo && lastGeo.c !== input.country) {
      flags.geoJump = true;
      reasons.push(`Country changed ${lastGeo.c} → ${input.country} within 2 hours`);
    }
    if (flags.burst) await kvIncrBy(dayKey(input.userId), -cents, 86_400).catch(() => undefined);
  } catch {
    return { action: "allow", reasons: ["velocity check unavailable (fail-open)"], flags };
  }
  const action = flags.burst ? "block" : flags.dailyVolume || flags.geoJump ? "review" : "allow";
  return { action, reasons, flags };
}

/** Record the country of a movement that went ahead (the geo-jump baseline). */
export async function recordVelocityGeo(userId: string, country: string | null | undefined): Promise<void> {
  if (!country) return;
  await kvSet(geoKey(userId), { c: country, at: new Date().toISOString() }, GEO_WINDOW_SECONDS).catch(() => undefined);
}
