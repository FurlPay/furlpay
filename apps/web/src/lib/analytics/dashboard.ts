import { listAccounts } from "@/lib/store";
import { SupabaseFunctionMissing, sbCount, sbRpc, sbSelect, supabaseBackend } from "@/lib/supabase";
import { kvListRange, kvMGetCounts, kvPfCount, kvZRangeByScore } from "@/lib/kv";
import { listSecurityEvents, listTxEvents, type OpsSecurityEvent, type OpsTxEvent } from "@/lib/ops/events";
import { RAILS, type Rail } from "@/lib/ops/controls";
import { PRODUCT_LABELS } from "./products";
import { bucketIndex, dayStamps, hourStamps, type AnalyticsRange } from "./range";
import { ERR_PREFIX, ERROR_LIST, PV_PREFIX, REQ_PREFIX, geoCountriesAllKey, geoKey, visitorsKey, type ServerErrorEntry } from "./telemetry";

// ---------------------------------------------------------------------------
// Admin analytics: every number on /analytics comes from here, and every
// number comes from a durable record of something that actually happened.
// docs/release/PRODUCTION_READINESS_FINAL.md §Metric definitions has the
// table / column / filter / aggregation for each one.
//
//   users, signups, KYC     users (created_at, kyc_status)        SQL: analytics_signup_cohort
//   wallet linked           linked_wallets                         SQL: analytics_signup_cohort
//   signup started          analytics_events (signup_started)      SQL: analytics_signup_starts
//   active users            audit_log, non-admin actions           SQL: analytics_active_users
//   transactions, volume    ops_tx_events (the ops LEDGER)         SQL: analytics_tx_buckets
//   product usage           ops_tx_events, distinct settled users  SQL: analytics_rail_users
//   page views, visitors    telemetry (middleware)                 Redis counters / HyperLogLog
//   geography               telemetry (signed-in, Vercel country)  Redis HyperLogLog
//   API requests, errors    telemetry (middleware, onRequestError) Redis counters
//   alerts                  ops_security_events + server errors
//
// Aggregation happens IN POSTGRES (migration 0027): the dashboard receives
// one row per bucket, not one per event. Without 0027 it falls back to a
// bounded row read and says so on the affected cards.
//
// A section whose source is missing, failing, or not instrumented reports
// `status: "unavailable"` with the reason. A zero is only ever a measured zero.
//
// IDENTITY: user ids leave this module only as pseudonyms (usr_ab12…ef34). No
// email, name, IP, KYC field or wallet address is selected from any table.
// ---------------------------------------------------------------------------

export type Section<T> = { status: "ok"; data: T; note?: string } | { status: "unavailable"; reason: string };
const ok = <T,>(data: T, note?: string): Section<T> => (note ? { status: "ok", data, note } : { status: "ok", data });
const unavailable = (reason: string): Section<never> => ({ status: "unavailable", reason });
const why = (e: unknown) => (e instanceof SupabaseFunctionMissing ? MIGRATION_MISSING : e instanceof Error ? e.message.slice(0, 160) : "source failed");
const MIGRATION_MISSING = "Aggregation function not installed: apply migration 0027_analytics.sql.";

export type ProductFilter = "all" | Rail;
export { PRODUCT_LABELS };
export function parseProduct(raw: string | null): ProductFilter | null {
  if (!raw || raw === "all") return "all";
  return (RAILS as string[]).includes(raw) ? (raw as Rail) : null;
}

/** usr_ab12…ef34 — enough to tell rows apart, not enough to look anyone up. */
export function pseudonym(id: string | undefined | null): string {
  if (!id) return "—";
  const clean = id.replace(/^usr_/, "");
  return clean.length <= 8 ? "usr_…" : `usr_${clean.slice(0, 4)}…${clean.slice(-4)}`;
}

const ROW_LIMIT = 20_000;
const iso = (ms: number) => new Date(ms).toISOString();
const isoQ = (ms: number) => encodeURIComponent(iso(ms));
const change = (cur: number, prev: number): number | null => (prev > 0 ? Number(((cur - prev) / prev).toFixed(4)) : null);
const zeros = (r: AnalyticsRange) => r.buckets.map(() => 0);
const num = (v: number | string | null | undefined) => (v === null || v === undefined ? 0 : Number(v) || 0);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

// ── Users / cohort ───────────────────────────────────────────────────────────

interface CohortAgg {
  size: number;
  signups: number[];
  verifiedSeries: number[];
  kycStarted: number;
  kycVerified: number;
  walletLinked: number | null;
  transacted: number | null;
  truncated: boolean;
  source: "sql" | "rows";
}

interface UserFacts {
  total: number;
  totalAtFrom: number;
  prevSignups: number;
  verifiedTotal: number;
  prevCohortVerified: number;
  cohort: CohortAgg;
}

async function cohortSql(r: AnalyticsRange): Promise<CohortAgg> {
  const rows = await sbRpc<{ bucket: string; signups: number | string; kyc_started: number | string; kyc_verified: number | string; wallet_linked: number | string; transacted: number | string }[]>(
    "analytics_signup_cohort",
    { p_from: iso(r.fromMs), p_to: iso(r.toMs), p_unit: r.bucket }
  );
  const signups = zeros(r);
  const verifiedSeries = zeros(r);
  let kycStarted = 0, kycVerified = 0, walletLinked = 0, transacted = 0;
  for (const row of rows) {
    const i = bucketIndex(r, Date.parse(row.bucket));
    if (i >= 0) {
      signups[i] += num(row.signups);
      verifiedSeries[i] += num(row.kyc_verified);
    }
    kycStarted += num(row.kyc_started);
    kycVerified += num(row.kyc_verified);
    walletLinked += num(row.wallet_linked);
    transacted += num(row.transacted);
  }
  return { size: sum(signups), signups, verifiedSeries, kycStarted, kycVerified, walletLinked, transacted, truncated: false, source: "sql" };
}

/** Fallback without 0027: a bounded row read; wallet and first-transaction stages unknown. */
async function cohortRows(r: AnalyticsRange): Promise<CohortAgg> {
  const rows = await sbSelect<{ created_at: string; kyc_status: string }>(
    "users",
    `select=created_at,kyc_status&created_at=gte.${isoQ(r.fromMs)}&created_at=lt.${isoQ(r.toMs)}&order=created_at.asc&limit=${ROW_LIMIT}`
  );
  const signups = zeros(r);
  const verifiedSeries = zeros(r);
  for (const u of rows) {
    const i = bucketIndex(r, Date.parse(u.created_at));
    if (i < 0) continue;
    signups[i]++;
    if (u.kyc_status === "verified") verifiedSeries[i]++;
  }
  return {
    size: rows.length,
    signups,
    verifiedSeries,
    kycStarted: rows.filter((u) => u.kyc_status !== "unverified").length,
    kycVerified: rows.filter((u) => u.kyc_status === "verified").length,
    walletLinked: null,
    transacted: null,
    truncated: rows.length >= ROW_LIMIT,
    source: "rows",
  };
}

async function userFacts(r: AnalyticsRange): Promise<UserFacts> {
  if (supabaseBackend !== "supabase") throw new Error("no durable user store configured (SUPABASE_URL)");
  const inPrev = `created_at=gte.${isoQ(r.prevFromMs)}&created_at=lt.${isoQ(r.prevToMs)}`;
  const cohort = cohortSql(r).catch((e) => {
    if (e instanceof SupabaseFunctionMissing) return cohortRows(r);
    throw e;
  });
  const [total, totalAtFrom, prevSignups, verifiedTotal, prevCohortVerified, c] = await Promise.all([
    sbCount("users", "select=id"),
    sbCount("users", `select=id&created_at=lt.${isoQ(r.fromMs)}`),
    sbCount("users", `select=id&${inPrev}`),
    sbCount("users", "select=id&kyc_status=eq.verified"),
    sbCount("users", `select=id&kyc_status=eq.verified&${inPrev}`),
    cohort,
  ]);
  return { total, totalAtFrom, prevSignups, verifiedTotal, prevCohortVerified, cohort: c };
}

// ── Active users ─────────────────────────────────────────────────────────────
// Active user = an authenticated user with at least one audited, NON-admin
// action in the period. Not counted: admin.* (operators using the console,
// including this dashboard's polling), system/cron/anonymous actors (their
// audit rows carry no user_id), health checks and bots (never audited).

interface ActiveFacts {
  perBucket: number[];
  distinct: number;
  prevDistinct: number;
  truncated: boolean;
  source: "sql" | "rows";
}

async function activeSql(r: AnalyticsRange): Promise<ActiveFacts> {
  type Row = { bucket: string | null; users: number | string };
  const [cur, prev] = await Promise.all([
    sbRpc<Row[]>("analytics_active_users", { p_from: iso(r.fromMs), p_to: iso(r.toMs), p_unit: r.bucket }),
    sbRpc<Row[]>("analytics_active_users", { p_from: iso(r.prevFromMs), p_to: iso(r.prevToMs), p_unit: r.bucket }),
  ]);
  const perBucket = zeros(r);
  for (const row of cur) {
    if (row.bucket === null) continue;
    const i = bucketIndex(r, Date.parse(row.bucket));
    if (i >= 0) perBucket[i] = num(row.users);
  }
  const whole = (rows: Row[]) => num(rows.find((x) => x.bucket === null)?.users ?? 0);
  return { perBucket, distinct: whole(cur), prevDistinct: whole(prev), truncated: false, source: "sql" };
}

async function activeRows(r: AnalyticsRange): Promise<ActiveFacts> {
  const LIMIT = 50_000;
  const q = (from: number, to: number) =>
    sbSelect<{ user_id: string; created_at: string }>(
      "audit_log",
      `select=user_id,created_at&user_id=not.is.null&action=not.like.admin.*&created_at=gte.${isoQ(from)}&created_at=lt.${isoQ(to)}&limit=${LIMIT}`
    );
  const [cur, prev] = await Promise.all([q(r.fromMs, r.toMs), q(r.prevFromMs, r.prevToMs)]);
  const sets = r.buckets.map(() => new Set<string>());
  const all = new Set<string>();
  for (const row of cur) {
    const i = bucketIndex(r, Date.parse(row.created_at));
    if (i >= 0) sets[i].add(row.user_id);
    all.add(row.user_id);
  }
  return {
    perBucket: sets.map((s) => s.size),
    distinct: all.size,
    prevDistinct: new Set(prev.map((p) => p.user_id)).size,
    truncated: cur.length >= LIMIT || prev.length >= LIMIT,
    source: "rows",
  };
}

async function activeFacts(r: AnalyticsRange): Promise<ActiveFacts> {
  if (supabaseBackend !== "supabase") throw new Error("audit trail is not durable here (SUPABASE_URL unset)");
  return activeSql(r).catch((e) => {
    if (e instanceof SupabaseFunctionMissing) return activeRows(r);
    throw e;
  });
}

// ── Transactions (the ops ledger) ────────────────────────────────────────────

interface TxAgg {
  count: number[];
  volume: number[];
  fees: number[];
  totalCount: number;
  totalVolume: number;
  totalFees: number;
  failed: number;
  byToken: Map<string, number[]>;
  railUsers: { rail: Rail; users: number }[] | null;
  allUsers: number | null;
  truncated: boolean;
  source: "sql" | "rows" | "hot-feed";
}

interface TxRow {
  rail: Rail;
  state: string;
  amount_usd: number | string | null;
  fee_usd: number | string | null;
  token: string | null;
  user_id: string | null;
  created_at: string;
}

function emptyTx(r: AnalyticsRange, source: TxAgg["source"]): TxAgg {
  return { count: zeros(r), volume: zeros(r), fees: zeros(r), totalCount: 0, totalVolume: 0, totalFees: 0, failed: 0, byToken: new Map(), railUsers: null, allUsers: null, truncated: false, source };
}

function addSettled(agg: TxAgg, r: AnalyticsRange, i: number, n: number, vol: number, fee: number, token: string) {
  agg.totalCount += n;
  agg.totalVolume += vol;
  agg.totalFees += fee;
  if (i < 0) return;
  agg.count[i] += n;
  agg.volume[i] += vol;
  agg.fees[i] += fee;
  if (!agg.byToken.has(token)) agg.byToken.set(token, zeros(r));
  agg.byToken.get(token)![i] += vol;
}

async function txSql(r: AnalyticsRange, fromMs: number, toMs: number, product: ProductFilter, withUsers: boolean): Promise<TxAgg> {
  const rail = product === "all" ? null : product;
  const [buckets, users] = await Promise.all([
    sbRpc<{ bucket: string; token: string; state: string; n: number | string; volume_usd: number | string; fee_usd: number | string }[]>(
      "analytics_tx_buckets",
      { p_from: iso(fromMs), p_to: iso(toMs), p_unit: r.bucket, p_rail: rail }
    ),
    withUsers ? sbRpc<{ rail: Rail; users: number | string; all_users: number | string }[]>("analytics_rail_users", { p_from: iso(fromMs), p_to: iso(toMs), p_rail: rail }) : Promise.resolve(null),
  ]);
  const agg = emptyTx(r, "sql");
  for (const b of buckets) {
    if (b.state === "settled") {
      const i = fromMs === r.fromMs ? bucketIndex(r, Date.parse(b.bucket)) : -1;
      addSettled(agg, r, i, num(b.n), num(b.volume_usd), num(b.fee_usd), (b.token || "OTHER").slice(0, 10));
    } else if (b.state === "failed" || b.state === "rejected") {
      agg.failed += num(b.n);
    }
  }
  if (users) {
    agg.railUsers = users.map((u) => ({ rail: u.rail, users: num(u.users) }));
    agg.allUsers = users.length ? num(users[0].all_users) : 0;
  }
  return agg;
}

async function txRowsAgg(r: AnalyticsRange, fromMs: number, toMs: number, product: ProductFilter): Promise<TxAgg> {
  let rows: TxRow[];
  let truncated: boolean;
  let source: TxAgg["source"];
  if (supabaseBackend === "supabase") {
    const rail = product === "all" ? "" : `&rail=eq.${product}`;
    rows = await sbSelect<TxRow>(
      "ops_tx_events",
      `select=rail,state,amount_usd,fee_usd,token,user_id,created_at&created_at=gte.${isoQ(fromMs)}&created_at=lt.${isoQ(toMs)}${rail}&order=created_at.asc&limit=${ROW_LIMIT}`
    );
    truncated = rows.length >= ROW_LIMIT;
    source = "rows";
  } else {
    // Development: the bounded Redis/in-memory hot feed.
    const events = await listTxEvents(5000);
    rows = events
      .filter((e) => {
        const t = Date.parse(e.ts);
        return t >= fromMs && t < toMs && (product === "all" || e.rail === product);
      })
      .map((e: OpsTxEvent) => ({ rail: e.rail, state: e.state, amount_usd: e.amountUsd ?? null, fee_usd: e.feeUsd ?? null, token: e.token ?? null, user_id: e.userId ?? null, created_at: e.ts }));
    truncated = events.length >= 5000;
    source = "hot-feed";
  }
  const agg = emptyTx(r, source);
  agg.truncated = truncated;
  const per = new Map<Rail, Set<string>>();
  const all = new Set<string>();
  for (const x of rows) {
    if (x.state === "settled") {
      const i = fromMs === r.fromMs ? bucketIndex(r, Date.parse(x.created_at)) : -1;
      addSettled(agg, r, i, 1, num(x.amount_usd), num(x.fee_usd), (x.token ?? "OTHER").toUpperCase().slice(0, 10));
      if (x.user_id) {
        if (!per.has(x.rail)) per.set(x.rail, new Set());
        per.get(x.rail)!.add(x.user_id);
        all.add(x.user_id);
      }
    } else if (x.state === "failed" || x.state === "rejected") {
      agg.failed++;
    }
  }
  agg.railUsers = [...per.entries()].map(([rail, s]) => ({ rail, users: s.size }));
  agg.allUsers = all.size;
  return agg;
}

async function txFacts(r: AnalyticsRange, fromMs: number, toMs: number, product: ProductFilter, withUsers: boolean): Promise<TxAgg> {
  if (supabaseBackend !== "supabase") return txRowsAgg(r, fromMs, toMs, product);
  return txSql(r, fromMs, toMs, product, withUsers).catch((e) => {
    if (e instanceof SupabaseFunctionMissing) return txRowsAgg(r, fromMs, toMs, product);
    throw e;
  });
}

// ── Signup starts (lifecycle events) ─────────────────────────────────────────

interface SignupStarts {
  started: number;
  completed: number;
  firstEvent: string | null;
}

async function signupStarts(r: AnalyticsRange): Promise<SignupStarts> {
  if (supabaseBackend !== "supabase") throw new Error("lifecycle events are recorded only in the durable store");
  const rows = await sbRpc<{ started: number | string; completed: number | string; first_event: string | null }[]>("analytics_signup_starts", {
    p_from: iso(r.fromMs),
    p_to: iso(r.toMs),
  });
  const row = rows[0];
  return { started: num(row?.started), completed: num(row?.completed), firstEvent: row?.first_event ?? null };
}

// ── Platforms (0028) ──────────────────────────────────────────────────────────
// Users per platform are DISTINCT AUTHENTICATED users on that platform: one
// person on web and Android appears in both rows and ONCE in allUsers.
// Anonymous ids are counted separately and never added to users.

async function platformSection(r: AnalyticsRange) {
  if (supabaseBackend !== "supabase") return unavailable("Client analytics are recorded only in the durable store.");
  type P = { platform: string; users: number | string; anonymous: number | string; events: number | string; errors: number | string; all_users: number | string };
  type V = { platform: string; app_version: string; users: number | string; installs: number | string };
  const [p, v] = await Promise.all([
    sbRpc<P[]>("analytics_platforms", { p_from: iso(r.fromMs), p_to: iso(r.toMs) }),
    sbRpc<V[]>("analytics_versions", { p_from: iso(r.fromMs), p_to: iso(r.toMs) }),
  ]).catch((e) => {
    if (e instanceof SupabaseFunctionMissing) throw new Error("Platform functions not installed: apply migration 0028_cross_platform_analytics.sql.");
    throw e;
  });
  if (!p.length) return unavailable("No client or server events recorded in this period.");
  return ok(
    {
      allUsers: num(p[0].all_users),
      platforms: p
        .map((x) => ({ platform: x.platform, users: num(x.users), anonymous: num(x.anonymous), events: num(x.events), errors: num(x.errors) }))
        .sort((a, b) => b.events - a.events),
      versions: v
        .map((x) => ({ platform: x.platform, version: x.app_version, users: num(x.users), installs: num(x.installs) }))
        .sort((a, b) => (a.platform === b.platform ? b.users + b.installs - (a.users + a.installs) : a.platform.localeCompare(b.platform))),
    },
    "Signed-in users per platform are distinct users; a person on two platforms counts in both rows but once in the total. Anonymous sessions are separate and never added to users. Client events are informational."
  );
}

// ── Traffic (telemetry) ──────────────────────────────────────────────────────

async function trafficSection(r: AnalyticsRange) {
  const hours = hourStamps(r.fromMs, r.toMs);
  const days = dayStamps(r.fromMs, r.toMs);
  const [pv, visitors] = await Promise.all([
    kvMGetCounts(hours.map((h) => PV_PREFIX + h)),
    Promise.all(days.map((d) => kvPfCount(visitorsKey(d)))),
  ]);
  const pageViews = zeros(r);
  hours.forEach((h, k) => {
    const i = bucketIndex(r, Date.parse(`${h}:00:00Z`));
    if (i >= 0) pageViews[i] += pv[k];
    else if (k === 0 && pageViews.length) pageViews[0] += pv[k];
  });
  const totalViews = sum(pv);
  if (totalViews === 0) {
    return unavailable("No page views recorded in this period. Counting starts with the middleware that records them.");
  }
  const daily = days.map((day, i) => ({ day, visitors: visitors[i] }));
  const measured = daily.filter((d) => d.visitors > 0);
  return ok(
    {
      pageViews: totalViews,
      pageViewSeries: pageViews,
      dailyVisitors: daily,
      avgDailyVisitors: measured.length ? Math.round(sum(measured.map((d) => d.visitors)) / measured.length) : null,
      sessions: null as number | null,
    },
    "Page views exclude bots, prefetches, assets and admin pages. Unique visitors are counted per UTC day from a daily-rotating hash (no cookie), so they are never summed across days. Sessions are not tracked: they would need a consented cookie."
  );
}

async function geoSection(r: AnalyticsRange): Promise<Section<{ countries: { code: string; name: string; users: number; pct: number }[]; total: number }>> {
  const days = dayStamps(r.fromMs, r.toMs);
  // ONE read for the country list (scored by last-seen time), then one PFCOUNT
  // per country over the range's day keys, issued in parallel. Never a call per
  // (day x country) pair, which is what the original endpoint did.
  const codes = (await kvZRangeByScore(geoCountriesAllKey, r.fromMs, "+inf")).filter((c) => /^[A-Z]{2}$/.test(c));
  if (codes.length === 0) {
    return unavailable(
      "No signed-in activity with a platform-provided country in this period. Country is recorded only on Vercel (x-vercel-ip-country); behind CloudFront no trustworthy country header exists."
    );
  }
  const counts = await Promise.all(codes.map((c) => kvPfCount(...days.map((d) => geoKey(d, c)))));
  const names = new Intl.DisplayNames(["en"], { type: "region" });
  const total = counts.reduce((a, b) => a + b, 0);
  const countries = codes
    .map((code, i) => ({ code, name: names.of(code) ?? code, users: counts[i], pct: total ? counts[i] / total : 0 }))
    .sort((a, b) => b.users - a.users);
  return ok({ countries, total }, "Distinct signed-in users per country (HyperLogLog, ~1% error). A user active in two countries counts in both.");
}

async function observabilitySection(r: AnalyticsRange) {
  const cur = hourStamps(r.fromMs, r.toMs);
  const prev = hourStamps(r.prevFromMs, r.prevToMs);
  const [reqCur, reqPrev, errCur] = await Promise.all([
    kvMGetCounts(cur.map((h) => REQ_PREFIX + h)),
    kvMGetCounts(prev.map((h) => REQ_PREFIX + h)),
    kvMGetCounts(cur.map((h) => ERR_PREFIX + h)),
  ]);
  // Fold hours into the range's buckets (hours already are the buckets for 24h).
  const fold = (vals: number[]) => {
    const out = zeros(r);
    cur.forEach((h, k) => {
      const i = bucketIndex(r, Date.parse(`${h}:00:00Z`));
      if (i >= 0) out[i] += vals[k];
      else if (k === 0 && out.length) out[0] += vals[k]; // the partial first hour
    });
    return out;
  };
  const requests = reqCur.reduce((a, b) => a + b, 0);
  const errors = errCur.reduce((a, b) => a + b, 0);
  const previous = reqPrev.reduce((a, b) => a + b, 0);
  const errSeries = fold(errCur);
  const reqSeries = fold(reqCur);
  return {
    requests:
      requests === 0 && previous === 0
        ? unavailable("No customer API requests recorded yet. The counter starts with the middleware that writes it.")
        : ok({ total: requests, change: change(requests, previous), series: reqSeries }, "Customer-facing /api requests counted by middleware: excludes /api/health (load-balancer checks), /api/cron/*, /api/ops/* (admin console), HEAD and OPTIONS. These are requests, not users."),
    errors:
      requests === 0
        ? unavailable("No API requests in this period, so there is no error rate to compute.")
        : ok(
            { total: errors, rate: errors / requests, series: errSeries.map((e, i) => (reqSeries[i] ? e / reqSeries[i] : 0)) },
            "Unhandled exceptions in customer API handlers (onRequestError) ÷ customer API requests, over the same routes. Handled errors returned as 4xx/5xx (validation, auth, provider failures surfaced as 502/503) are NOT in the numerator."
          ),
    latency: unavailable("Not instrumented. Middleware runs before the handler and never sees the response; latency needs a platform metric (Vercel / CloudWatch)."),
    invocations: unavailable("Not available to the application. Function invocations are a platform metric (Vercel / CloudWatch)."),
  };
}

const LEVEL: Record<OpsSecurityEvent["severity"], "Critical" | "Error" | "Warning" | "Info"> = {
  critical: "Critical",
  high: "Error",
  medium: "Warning",
  low: "Warning",
  info: "Info",
};

// Latest-N reads for the feed and alerts. On the durable path only the columns
// the dashboard displays are selected: the ops tables also hold payer/recipient
// addresses and actors, which the dashboard never shows and so never fetches.
type SecLite = Pick<OpsSecurityEvent, "kind" | "rail" | "severity" | "detail" | "ts">;
type TxLite = Pick<OpsTxEvent, "rail" | "state" | "amountUsd" | "token" | "userId" | "sourceChain" | "destChain" | "ts">;

async function latestSecurity(limit: number): Promise<SecLite[]> {
  if (supabaseBackend !== "supabase") return listSecurityEvents(limit);
  const rows = await sbSelect<{ kind: string; rail: Rail; severity: OpsSecurityEvent["severity"]; detail: string; created_at: string }>(
    "ops_security_events",
    `select=kind,rail,severity,detail,created_at&order=created_at.desc&limit=${limit}`
  );
  return rows.map((r) => ({ kind: r.kind, rail: r.rail, severity: r.severity, detail: r.detail, ts: r.created_at }));
}

async function latestTx(limit: number): Promise<TxLite[]> {
  if (supabaseBackend !== "supabase") return listTxEvents(limit);
  const rows = await sbSelect<{
    rail: Rail; state: OpsTxEvent["state"]; amount_usd: number | string | null; token: string | null;
    user_id: string | null; source_chain: string | null; dest_chain: string | null; created_at: string;
  }>(
    "ops_tx_events",
    `select=rail,state,amount_usd,token,user_id,source_chain,dest_chain,created_at&order=created_at.desc&limit=${limit}`
  );
  return rows.map((r) => ({
    rail: r.rail,
    state: r.state,
    amountUsd: r.amount_usd === null ? undefined : Number(r.amount_usd),
    token: r.token ?? undefined,
    userId: r.user_id ?? undefined,
    sourceChain: r.source_chain ?? undefined,
    destChain: r.dest_chain ?? undefined,
    ts: r.created_at,
  }));
}

async function alertsSection(r: AnalyticsRange) {
  const [sec, errs] = await Promise.all([latestSecurity(200), kvListRange(ERROR_LIST, 200)]);
  const items: { ts: string; level: "Critical" | "Error" | "Warning" | "Info"; service: string; message: string }[] = [];
  for (const e of sec) {
    const t = Date.parse(e.ts);
    if (t < r.fromMs || t >= r.toMs) continue;
    items.push({ ts: e.ts, level: LEVEL[e.severity] ?? "Info", service: e.rail, message: `${e.kind}: ${e.detail}`.slice(0, 180) });
  }
  for (const raw of errs) {
    try {
      const e = JSON.parse(raw) as ServerErrorEntry;
      const t = Date.parse(e.ts);
      if (t < r.fromMs || t >= r.toMs) continue;
      items.push({ ts: e.ts, level: "Error", service: e.route, message: `${e.error} in ${e.method} ${e.routeType}${e.digest ? ` (digest ${e.digest})` : ""}` });
    } catch {
      /* a corrupt list entry is skipped, not invented */
    }
  }
  items.sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
  return ok({ items: items.slice(0, 50) });
}

export type FeedKind = "signup" | "transaction" | "security";
export interface FeedItem {
  ts: string;
  kind: FeedKind;
  event: string;
  user: string;
  location: string | null;
  details: string;
}

async function feedSection(product: ProductFilter): Promise<Section<{ items: FeedItem[] }>> {
  const [tx, sec, signups] = await Promise.all([
    latestTx(60),
    latestSecurity(20),
    supabaseBackend === "supabase"
      ? sbSelect<{ id: string; created_at: string }>("users", "select=id,created_at&order=created_at.desc&limit=20")
      : Promise.resolve([]),
  ]);
  const items: FeedItem[] = [];
  for (const e of tx) {
    if (product !== "all" && e.rail !== product) continue;
    const amount = typeof e.amountUsd === "number" ? `$${e.amountUsd.toFixed(2)}` : "";
    items.push({
      ts: e.ts,
      kind: "transaction",
      event: `Transaction ${e.state}`,
      user: pseudonym(e.userId),
      location: null, // the ops ledger records no location; never inferred
      details: [PRODUCT_LABELS[e.rail] ?? e.rail, e.token, amount, e.destChain ?? e.sourceChain].filter(Boolean).join(" · "),
    });
  }
  for (const u of signups) {
    items.push({ ts: u.created_at, kind: "signup", event: "New user signup", user: pseudonym(u.id), location: null, details: "Account created" });
  }
  for (const s of sec) {
    items.push({ ts: s.ts, kind: "security", event: `Security · ${s.kind}`, user: "—", location: null, details: `${s.severity} on ${s.rail}` });
  }
  items.sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
  return ok({ items: items.slice(0, 60) });
}

// ── Assembly ─────────────────────────────────────────────────────────────────

export interface Kpi {
  value: number;
  change: number | null;
  series: number[];
}

export async function buildDashboard(r: AnalyticsRange, product: ProductFilter) {
  const [users, active, txCur, txPrev, starts, traffic, platforms, geo, obs, alerts, feed] = await Promise.allSettled([
    userFacts(r),
    activeFacts(r),
    txFacts(r, r.fromMs, r.toMs, product, true),
    txFacts(r, r.prevFromMs, r.prevToMs, product, false),
    signupStarts(r),
    trafficSection(r),
    platformSection(r),
    geoSection(r),
    observabilitySection(r),
    alertsSection(r),
    feedSection(product),
  ]);

  const u = users.status === "fulfilled" ? users.value : null;
  const a = active.status === "fulfilled" ? active.value : null;
  const cur = txCur.status === "fulfilled" ? txCur.value : null;
  const prev = txPrev.status === "fulfilled" ? txPrev.value : null;
  const usersErr = users.status === "rejected" ? why(users.reason) : "";
  const activeErr = active.status === "rejected" ? why(active.reason) : "";
  const txErr = txCur.status === "rejected" ? why(txCur.reason) : txPrev.status === "rejected" ? why(txPrev.reason) : "";

  // Development without a durable user store: the in-memory accounts can still
  // answer totals (not signup dates, which they do not record).
  const memAccounts = !u && supabaseBackend !== "supabase" ? listAccounts() : null;
  const fallbackNote = (src: string, truncated: boolean) =>
    src === "rows"
      ? `Row-limited fallback (migration 0027 not applied)${truncated ? `; the ${ROW_LIMIT.toLocaleString()}-row limit was reached, so this is a lower bound` : ""}.`
      : src === "hot-feed"
        ? "Development hot feed (no durable ledger configured)."
        : "";
  const c = u?.cohort;

  const kpis = {
    totalUsers: u
      ? ok<Kpi>({ value: u.total, change: change(u.total, u.totalAtFrom), series: cumulative(u.totalAtFrom, c!.signups) }, "All accounts (users table). Change is growth since the start of the period.")
      : memAccounts
        ? ok<Kpi>({ value: memAccounts.length, change: null, series: [] }, "In-memory store (development); no signup dates, so no trend.")
        : unavailable(usersErr),
    newSignups: u
      ? ok<Kpi>({ value: c!.size, change: change(c!.size, u.prevSignups), series: c!.signups }, `Accounts created in the period (users.created_at). ${fallbackNote(c!.source, c!.truncated)}`.trim())
      : unavailable(usersErr || "Signup dates are only recorded in the durable user store."),
    kycCompleted: u
      ? ok<Kpi>(
          { value: u.verifiedTotal, change: change(c!.kycVerified, u.prevCohortVerified), series: c!.verifiedSeries },
          "All-time verified users. Change and trend compare users who signed up in each period and are now verified: no verification timestamp is stored."
        )
      : memAccounts
        ? ok<Kpi>({ value: memAccounts.filter((x) => x.user.kycStatus === "verified").length, change: null, series: [] })
        : unavailable(usersErr),
    activeUsers: a
      ? ok<Kpi>(
          { value: a.distinct, change: change(a.distinct, a.prevDistinct), series: a.perBucket },
          `Distinct signed-in users with at least one audited, non-admin action in the period (audit_log). Not counted: admin console use, system/cron jobs, anonymous and bot traffic. ${fallbackNote(a.source, a.truncated)}`.trim()
        )
      : unavailable(activeErr),
    transactions: cur && prev
      ? ok<Kpi>({ value: cur.totalCount, change: change(cur.totalCount, prev.totalCount), series: cur.count }, `Settled transactions in the ops ledger (ops_tx_events, state = settled). ${fallbackNote(cur.source, cur.truncated)}`.trim())
      : unavailable(txErr),
    volume: cur && prev
      ? ok<Kpi>({ value: cur.totalVolume, change: change(cur.totalVolume, prev.totalVolume), series: cur.volume }, "Sum of amount_usd over settled ledger events.")
      : unavailable(txErr),
  };

  const growth = u
    ? ok({
        totalUsers: u.total,
        change: change(u.total, u.totalAtFrom),
        newUsers: c!.signups,
        activeUsers: a ? a.perBucket : null,
        activeNote: a ? null : activeErr,
      })
    : unavailable(usersErr || "Signup dates are only recorded in the durable user store.");

  const trafficData = traffic.status === "fulfilled" ? traffic.value : unavailable(why(traffic.reason));
  const funnel = u ? funnelFrom(r, u, starts, trafficData) : unavailable(usersErr);

  const transactions = cur && prev
    ? ok({
        volume: cur.totalVolume,
        change: change(cur.totalVolume, prev.totalVolume),
        count: cur.totalCount,
        fees: cur.totalFees,
        feesChange: change(cur.totalFees, prev.totalFees),
        feeSeries: cur.fees,
        countSeries: cur.count,
        failed: cur.failed,
        byToken: tokenSeries(cur.byToken, r),
        truncated: cur.truncated,
      }, fallbackNote(cur.source, cur.truncated) || undefined)
    : unavailable(txErr);

  const products = cur ? productSection(cur) : unavailable(txErr);

  return {
    range: { key: r.key, from: iso(r.fromMs), to: iso(r.toMs), bucket: r.bucket, buckets: r.buckets.map((b) => iso(b)) },
    product,
    generatedAt: new Date().toISOString(),
    kpis,
    growth,
    funnel,
    traffic: trafficData,
    platforms: platforms.status === "fulfilled" ? platforms.value : unavailable(why(platforms.reason)),
    geo: geo.status === "fulfilled" ? geo.value : unavailable(why(geo.reason)),
    transactions,
    products,
    observability:
      obs.status === "fulfilled"
        ? obs.value
        : { requests: unavailable(why(obs.reason)), errors: unavailable(why(obs.reason)), latency: unavailable("Not instrumented."), invocations: unavailable("Platform metric.") },
    alerts: alerts.status === "fulfilled" ? alerts.value : unavailable(why(alerts.reason)),
    feed: feed.status === "fulfilled" ? feed.value : unavailable(why(feed.reason)),
  };
}

export type Dashboard = Awaited<ReturnType<typeof buildDashboard>>;

function cumulative(start: number, perBucket: number[]): number[] {
  let run = start;
  return perBucket.map((n) => (run += n));
}

function tokenSeries(by: Map<string, number[]>, r: AnalyticsRange) {
  // Four largest tokens by volume, the rest folded into "Other".
  const ranked = [...by.entries()].sort((a, b) => sum(b[1]) - sum(a[1]));
  const top = ranked.slice(0, 4);
  const rest = ranked.slice(4);
  if (rest.length) {
    const other = zeros(r);
    for (const [, vals] of rest) vals.forEach((v, i) => (other[i] += v));
    top.push(["Other", other]);
  }
  return top.map(([token, values]) => ({ token, values }));
}

function productSection(tx: TxAgg) {
  if (!tx.railUsers || !tx.allUsers) return unavailable("No settled transactions with an attributed user in this period.");
  const total = sum(tx.railUsers.map((x) => x.users));
  const items = tx.railUsers
    .filter((x) => x.users > 0)
    .map(({ rail, users }) => ({ rail, label: PRODUCT_LABELS[rail] ?? rail, users, pct: users / total }))
    .sort((a, b) => b.users - a.users);
  return ok(
    { totalUsers: tx.allUsers, items },
    "Distinct users with at least one settled ledger transaction per product (ops_tx_events.rail). A user of two products counts in both, so shares are of product-users."
  );
}

type FunnelStage = { key: string; label: string; count: number | null; tracked: boolean; note: string; context?: boolean };

function funnelFrom(r: AnalyticsRange, u: UserFacts, starts: PromiseSettledResult<SignupStarts>, traffic: Section<{ avgDailyVisitors: number | null }>) {
  const c = u.cohort;
  const s = starts.status === "fulfilled" ? starts.value : null;
  const startsReason = starts.status === "rejected" ? why(starts.reason) : "";
  // Signup starts exist only from the deployment that records them onward.
  const startsCover = s?.firstEvent ? Date.parse(s.firstEvent) <= r.fromMs : false;
  const stages: FunnelStage[] = [
    {
      key: "visitors",
      label: "Daily visitors (avg)",
      count: traffic.status === "ok" ? traffic.data.avgDailyVisitors : null,
      tracked: traffic.status === "ok",
      context: true,
      note: traffic.status === "ok" ? "Context only: visitors are not linked to signups (no cookie)." : traffic.reason,
    },
    {
      key: "signup_started",
      label: "Started signup",
      count: s && startsCover ? s.started : null,
      tracked: Boolean(s && startsCover),
      context: true,
      note: !s
        ? startsReason
        : !startsCover
          ? s.firstEvent
            ? `Recorded only since ${s.firstEvent.slice(0, 10)}; earlier periods are unavailable, not zero.`
            : "No signup starts recorded yet (counting begins with this release)."
          : `OTP signups only; ${s.completed} of these completed.`,
    },
    { key: "signup_complete", label: "Completed signup", count: c.size, tracked: true, note: "" },
    { key: "kyc_started", label: "Started KYC", count: c.kycStarted, tracked: true, note: "" },
    { key: "kyc_complete", label: "Completed KYC", count: c.kycVerified, tracked: true, note: "" },
    { key: "wallet_linked", label: "Wallet linked", count: c.walletLinked, tracked: c.walletLinked !== null, note: c.walletLinked === null ? MIGRATION_MISSING : "" },
    { key: "first_transaction", label: "First transaction", count: c.transacted, tracked: c.transacted !== null, note: c.transacted === null ? MIGRATION_MISSING : "" },
  ];
  return ok(
    { stages, cohortSize: c.size, truncated: c.truncated },
    "Cohort funnel: users who signed up in the period and how far each has got since (all products). Percentages are of completed signups. Email verification is part of signup itself (OTP or Google/Apple-verified email), so it is not a separate step."
  );
}
