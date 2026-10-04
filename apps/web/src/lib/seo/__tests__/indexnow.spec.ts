import { describe, expect, it, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import {
  INDEXNOW_ENDPOINT,
  INDEXNOW_KEY_LOCATION,
  canonicalSubmissionUrl,
  indexNowKey,
  submitIndexNow,
} from "../indexnow";
import { GET as keyFile } from "@/app/indexnow.txt/route";
import robots from "@/app/robots";

const KEY = "0f6b1d9e-4c2a-4b7e-9a3d-1e2f3a4b5c6d";
const PROD = { VERCEL_ENV: "production", INDEXNOW_KEY: KEY };

function respond(status: number) {
  return vi.fn(async (_url: string, _init?: RequestInit) => new Response("", { status }));
}
// Each test announces fresh URLs so the 24 h dedupe does not couple tests.
const page = () => `https://furlpay.com/research/t-${randomUUID().slice(0, 8)}`;

describe("indexNowKey", () => {
  it("accepts 8-128 chars of [A-Za-z0-9-] and nothing else", () => {
    expect(indexNowKey({ INDEXNOW_KEY: KEY })).toBe(KEY);
    expect(indexNowKey({ INDEXNOW_KEY: "abcd1234" })).toBe("abcd1234");
    expect(indexNowKey({})).toBeNull();
    expect(indexNowKey({ INDEXNOW_KEY: "short" })).toBeNull();
    expect(indexNowKey({ INDEXNOW_KEY: "has space in it" })).toBeNull();
    expect(indexNowKey({ INDEXNOW_KEY: "a".repeat(129) })).toBeNull();
    expect(indexNowKey({ INDEXNOW_KEY: "under_score_key" })).toBeNull();
  });
});

describe("canonicalSubmissionUrl", () => {
  it.each([
    ["https://furlpay.com/", "https://furlpay.com/"],
    ["https://furlpay.com/reports/global-stablecoin-report-2026", "https://furlpay.com/reports/global-stablecoin-report-2026"],
    ["https://furlpay.com/investing/insights", "https://furlpay.com/investing/insights"],
  ])("accepts %s", (raw, url) => {
    expect(canonicalSubmissionUrl(raw)).toEqual({ ok: true, url });
  });

  it.each([
    ["not a url", "not_a_url"],
    ["http://furlpay.com/pricing", "not_https"],
    ["https://www.furlpay.com/pricing", "wrong_host"],
    ["https://evil.example/furlpay.com", "wrong_host"],
    ["https://web-abc123-ashutoshs-projects-754ff406.vercel.app/pricing", "wrong_host"],
    ["https://furlpay.com.evil.example/pricing", "wrong_host"],
    ["https://user:pw@furlpay.com/pricing", "has_credentials_or_port"],
    ["https://furlpay.com:8443/pricing", "has_credentials_or_port"],
    ["https://furlpay.com/pricing?utm_source=x", "has_query_or_fragment"],
    ["https://furlpay.com/pricing?", "has_query_or_fragment"],
    ["https://furlpay.com/pricing#faq", "has_query_or_fragment"],
    ["https://furlpay.com/pricing/", "trailing_slash"],
    ["https://furlpay.com/reports/global-stablecoin-report-2026.pdf", "file_download"],
    ["https://furlpay.com/reports/global-stablecoin-report-2026-lite.pdf", "file_download"],
    ["https://furlpay.com/api/research/download", "private_path"],
    ["https://furlpay.com/dashboard", "private_path"],
    ["https://furlpay.com/cards/123", "private_path"],
    ["https://furlpay.com/login", "private_path"],
  ])("rejects %s (%s)", (raw, reason) => {
    expect(canonicalSubmissionUrl(raw)).toEqual({ ok: false, reason });
  });

  it("does not mistake a public path for a private prefix", () => {
    expect(canonicalSubmissionUrl("https://furlpay.com/cardsharing-guide").ok).toBe(true);
    expect(canonicalSubmissionUrl("https://furlpay.com/earnings-report").ok).toBe(true);
  });
});

describe("submitIndexNow", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("refuses outside Vercel production, before any request", async () => {
    const f = respond(200);
    const r = await submitIndexNow([page()], { env: { INDEXNOW_KEY: KEY, VERCEL_ENV: "preview" }, fetchImpl: f });
    expect(r.outcome).toBe("not_production");
    expect(f).not.toHaveBeenCalled();
  });

  it("reports not_configured without a valid key, before any request", async () => {
    const f = respond(200);
    const r = await submitIndexNow([page()], { env: { VERCEL_ENV: "production" }, fetchImpl: f });
    expect(r.outcome).toBe("not_configured");
    expect(f).not.toHaveBeenCalled();
  });

  it("POSTs the documented body to api.indexnow.org with only canonical URLs", async () => {
    const f = respond(200);
    const good = page();
    const r = await submitIndexNow([good, `${good}?utm_source=x`, "https://evil.example/x", good], { env: PROD, fetchImpl: f });
    expect(r.outcome).toBe("submitted");
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe(INDEXNOW_ENDPOINT);
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)["content-type"]).toBe("application/json; charset=utf-8");
    expect(JSON.parse(String(init?.body))).toEqual({
      host: "furlpay.com",
      key: KEY,
      keyLocation: INDEXNOW_KEY_LOCATION,
      urlList: [good],
    });
    expect(r.submitted).toEqual([good]);
    expect(r.rejected.map((x) => x.reason).sort()).toEqual(["has_query_or_fragment", "wrong_host"]);
  });

  it("does not announce the same URL twice within the dedupe window", async () => {
    const f = respond(200);
    const u = page();
    expect((await submitIndexNow([u], { env: PROD, fetchImpl: f })).outcome).toBe("submitted");
    const again = await submitIndexNow([u], { env: PROD, fetchImpl: f });
    expect(again.outcome).toBe("nothing_to_submit");
    expect(again.skippedDuplicates).toEqual([u]);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("treats 202 as accepted with the key still being validated", async () => {
    const r = await submitIndexNow([page()], { env: PROD, fetchImpl: respond(202) });
    expect(r.outcome).toBe("accepted_key_pending");
    expect(r.submitted).toHaveLength(1);
  });

  it.each([
    [400, "bad_request"],
    [403, "key_invalid"],
    [422, "url_mismatch"],
    [429, "rate_limited"],
    [500, "provider_error"],
  ])("maps HTTP %i to %s and releases the URLs so a later run can retry", async (status, outcome) => {
    const u = page();
    const r = await submitIndexNow([u], { env: PROD, fetchImpl: respond(status) });
    expect(r.outcome).toBe(outcome);
    expect(r.submitted).toEqual([]);
    const retry = respond(200);
    expect((await submitIndexNow([u], { env: PROD, fetchImpl: retry })).outcome).toBe("submitted");
  });

  it("never throws on a network failure and releases the URLs", async () => {
    const u = page();
    const boom = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const r = await submitIndexNow([u], { env: PROD, fetchImpl: boom as unknown as typeof fetch });
    expect(r.outcome).toBe("network_error");
    expect((await submitIndexNow([u], { env: PROD, fetchImpl: respond(200) })).outcome).toBe("submitted");
  });

  it("never logs the key", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await submitIndexNow([page()], { env: PROD, fetchImpl: respond(200) });
    const logged = [...info.mock.calls, ...warn.mock.calls].flat().join(" ");
    expect(logged).not.toContain(KEY);
  });
});

describe("GET /indexnow.txt", () => {
  it("serves exactly the key as UTF-8 text when configured", async () => {
    vi.stubEnv("INDEXNOW_KEY", KEY);
    const res = keyFile();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await res.text()).toBe(KEY);
    vi.unstubAllEnvs();
  });

  it("404s when unset or malformed, so no invalid key is published", async () => {
    vi.stubEnv("INDEXNOW_KEY", "");
    expect(keyFile().status).toBe(404);
    vi.stubEnv("INDEXNOW_KEY", "bad key!");
    expect(keyFile().status).toBe(404);
    vi.unstubAllEnvs();
  });
});

describe("robots.txt policy", () => {
  const r = robots();
  const rules = Array.isArray(r.rules) ? r.rules : [r.rules];
  const groupFor = (ua: string) => rules.find((g) => (Array.isArray(g.userAgent) ? g.userAgent : [g.userAgent]).includes(ua));

  it("keeps the sitemap declaration", () => {
    expect(r.sitemap).toBe("https://furlpay.com/sitemap.xml");
  });

  it.each(["Googlebot", "Bingbot", "PetalBot", "YouBot", "OAI-SearchBot", "ChatGPT-User", "Claude-User", "PerplexityBot", "GPTBot", "ClaudeBot"])(
    "%s has an explicit group: public site allowed, app and API disallowed",
    (ua) => {
      const g = groupFor(ua)!;
      expect(g).toBeDefined();
      expect(g.allow).toContain("/");
      expect(g.disallow).toEqual(expect.arrayContaining(["/api/", "/dashboard", "/cards", "/profile"]));
      expect(g.disallow).not.toContain("/");
    }
  );

  it("never disallows the public research and report pages", () => {
    for (const g of rules) {
      const d = Array.isArray(g.disallow) ? g.disallow : g.disallow ? [g.disallow] : [];
      expect(d.some((p) => "/reports/global-stablecoin-report-2026".startsWith(p) || "/research".startsWith(p))).toBe(false);
    }
  });
});
