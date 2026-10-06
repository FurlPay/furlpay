import { createHash } from "crypto";
import { kvDel, kvSetNx } from "@/lib/kv";

// ---------------------------------------------------------------------------
// IndexNow — tell participating search engines (Bing, Yandex, Seznam, Naver…)
// that a public page changed, so it is re-crawled in minutes instead of weeks.
// Protocol: https://www.indexnow.org/documentation (checked 2026-10-04).
//
//   key          8-128 chars of [a-zA-Z0-9-], from INDEXNOW_KEY
//   key file     https://furlpay.com/indexnow.txt  (app/indexnow.txt/route.ts)
//                Served at the ROOT on purpose: the keyLocation's directory
//                limits which URLs may be submitted, and "/" covers the site.
//   submission   POST https://api.indexnow.org/indexnow
//                { host, key, keyLocation, urlList } — up to 10,000 URLs
//   responses    200 ok · 202 accepted, key pending · 400 bad format ·
//                403 key invalid · 422 URL/host mismatch · 429 too many
//
// WHAT MAY BE SUBMITTED. Only canonical public pages on furlpay.com: https, the
// apex host, no query string or fragment, no trailing slash, no file
// downloads, nothing under the app/API paths robots.txt disallows. Anything
// else is rejected before a request is made — a preview URL, a tracking
// variant or an authenticated page must never be announced.
//
// WHEN. There is no publication pipeline to hook into (content ships with a
// deploy), so this is a utility, not a global hook: call it after a production
// deploy with the URLs that changed. It refuses to run outside Vercel
// production so preview deploys cannot announce themselves.
// ---------------------------------------------------------------------------

export const INDEXNOW_HOST = "furlpay.com";
export const INDEXNOW_KEY_LOCATION = `https://${INDEXNOW_HOST}/indexnow.txt`;
export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
export const INDEXNOW_MAX_URLS = 10_000;
/** A URL announced within this window is not announced again. */
export const INDEXNOW_DEDUPE_SECONDS = 24 * 3600;

const KEY_SHAPE = /^[A-Za-z0-9-]{8,128}$/;

/** Path prefixes that are never public content (mirrors app/robots.ts DISALLOW, plus auth). */
const PRIVATE_PREFIXES = [
  "/api/",
  "/dashboard",
  "/profile",
  "/cards",
  "/banking",
  "/bills",
  "/portfolio",
  "/earn",
  "/credit",
  "/rewards",
  "/analytics",
  "/notifications",
  "/login",
  "/signup",
  "/ops",
  "/admin",
];

type Env = Record<string, string | undefined>;

/** The configured key, or null when absent or malformed (never echoed). */
export function indexNowKey(env: Env = process.env): string | null {
  const key = env.INDEXNOW_KEY?.trim();
  return key && KEY_SHAPE.test(key) ? key : null;
}

export type UrlRejection =
  | "not_a_url"
  | "not_https"
  | "wrong_host"
  | "has_credentials_or_port"
  | "has_query_or_fragment"
  | "trailing_slash"
  | "file_download"
  | "private_path";

/** The canonical form of a submittable URL, or the reason it is refused. */
export function canonicalSubmissionUrl(raw: string): { ok: true; url: string } | { ok: false; reason: UrlRejection } {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, reason: "not_a_url" };
  }
  if (u.protocol !== "https:") return { ok: false, reason: "not_https" };
  if (u.hostname !== INDEXNOW_HOST) return { ok: false, reason: "wrong_host" };
  if (u.username || u.password || u.port) return { ok: false, reason: "has_credentials_or_port" };
  if (u.search || u.hash || raw.includes("?") || raw.includes("#")) return { ok: false, reason: "has_query_or_fragment" };
  const path = u.pathname;
  if (path !== "/" && path.endsWith("/")) return { ok: false, reason: "trailing_slash" };
  // Landing pages are announced; the files they link to are not.
  if (/\.[A-Za-z0-9]{2,5}$/.test(path)) return { ok: false, reason: "file_download" };
  if (PRIVATE_PREFIXES.some((p) => path === p.replace(/\/$/, "") || path.startsWith(p.endsWith("/") ? p : `${p}/`))) {
    return { ok: false, reason: "private_path" };
  }
  return { ok: true, url: `https://${INDEXNOW_HOST}${path}` };
}

export type SubmitOutcome =
  | "submitted" // 200
  | "accepted_key_pending" // 202
  | "bad_request" // 400
  | "key_invalid" // 403
  | "url_mismatch" // 422
  | "rate_limited" // 429
  | "provider_error" // other status
  | "network_error"
  | "not_configured"
  | "not_production"
  | "nothing_to_submit";

export interface SubmitResult {
  outcome: SubmitOutcome;
  status?: number;
  submitted: string[];
  skippedDuplicates: string[];
  rejected: { url: string; reason: UrlRejection }[];
}

interface SubmitOptions {
  env?: Env;
  fetchImpl?: typeof fetch;
  /** Skip the Vercel-production check (tests, or an explicitly operated script). */
  allowNonProduction?: boolean;
}

const dedupeKey = (url: string) => `indexnow:sent:${createHash("sha256").update(url).digest("hex").slice(0, 32)}`;

function outcomeFor(status: number): SubmitOutcome {
  if (status === 200) return "submitted";
  if (status === 202) return "accepted_key_pending";
  if (status === 400) return "bad_request";
  if (status === 403) return "key_invalid";
  if (status === 422) return "url_mismatch";
  if (status === 429) return "rate_limited";
  return "provider_error";
}

/**
 * Announce changed public pages. Never throws: every failure is an outcome, so
 * a caller in a deploy script cannot be broken by a search engine.
 */
export async function submitIndexNow(urls: readonly string[], opts: SubmitOptions = {}): Promise<SubmitResult> {
  const env = opts.env ?? process.env;
  const rejected: SubmitResult["rejected"] = [];
  const canonical = new Set<string>();
  for (const raw of urls) {
    const c = canonicalSubmissionUrl(raw);
    if (c.ok) canonical.add(c.url);
    else rejected.push({ url: raw, reason: c.reason });
  }
  const base = { submitted: [] as string[], skippedDuplicates: [] as string[], rejected };

  if (!opts.allowNonProduction && env.VERCEL_ENV !== "production") return { outcome: "not_production", ...base };
  const key = indexNowKey(env);
  if (!key) return { outcome: "not_configured", ...base };

  // Claim each URL for the dedupe window; an already-claimed URL is skipped.
  const fresh: string[] = [];
  for (const url of [...canonical].slice(0, INDEXNOW_MAX_URLS)) {
    const claimed = await kvSetNx(dedupeKey(url), 1, INDEXNOW_DEDUPE_SECONDS).catch(() => true);
    if (claimed) fresh.push(url);
    else base.skippedDuplicates.push(url);
  }
  if (fresh.length === 0) return { outcome: "nothing_to_submit", ...base };

  const release = () => Promise.all(fresh.map((u) => kvDel(dedupeKey(u)).catch(() => {})));
  let res: Response;
  try {
    res = await (opts.fetchImpl ?? fetch)(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ host: INDEXNOW_HOST, key, keyLocation: INDEXNOW_KEY_LOCATION, urlList: fresh }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    await release(); // not sent: let a later run try again
    console.warn(`[indexnow] network error submitting ${fresh.length} url(s)`);
    return { outcome: "network_error", ...base };
  }
  const outcome = outcomeFor(res.status);
  // Count and status only — never the key or the URL list.
  console.info(`[indexnow] ${fresh.length} url(s) -> ${res.status} ${outcome}`);
  if (outcome !== "submitted" && outcome !== "accepted_key_pending") {
    await release();
    return { outcome, status: res.status, ...base };
  }
  return { outcome, status: res.status, ...base, submitted: fresh };
}
