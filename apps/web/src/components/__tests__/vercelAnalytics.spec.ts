import { describe, expect, it } from "vitest";
import { beforeSend } from "@/components/VercelAnalytics";
import { REDACTED, sanitizeAnalyticsUrl } from "@/lib/analytics/sanitize";

// Analytics must never receive query strings, fragments or record ids.
// beforeSend runs before the script builds its request, so these are the
// values that would be transmitted.
const O = "https://furlpay.com";

describe("sanitizeAnalyticsUrl", () => {
  it.each([
    ["auth handoff code", `${O}/auth/handoff?code=SECRET`, `${O}/auth/handoff`],
    ["OAuth code + state", `${O}/oauth/callback?code=x&state=y`, `${O}/oauth/callback`],
    ["password reset token", `${O}/reset-password?token=SECRET`, `${O}/reset-password`],
    ["Stripe checkout return", `${O}/pricing?upgraded=pro&session_id=cs_live_SECRET`, `${O}/pricing`],
    ["email in query", `${O}/ambassadors/dashboard?email=a%40b.com`, `${O}/ambassadors/dashboard`],
    ["fragment", `${O}/docs/quickstart#access_token=SECRET`, `${O}/docs/quickstart`],
    ["encoded + odd case params", `${O}/Talk-To-Us?CODE=%53ECRET&Token=x`, `${O}/Talk-To-Us`],
    ["ordinary page", `${O}/talk-to-us`, `${O}/talk-to-us`],
    ["root", `${O}/`, `${O}/`],
    ["blog slug kept", `${O}/blog/how-to-pay-with-usdc-in-2026`, `${O}/blog/how-to-pay-with-usdc-in-2026`],
    ["market symbol kept", `${O}/markets/BRK.B`, `${O}/markets/BRK.B`],
    ["support ticket id", `${O}/support/42`, `${O}/support/${REDACTED}`],
    ["booking id", `${O}/travel/booking/bk_123`, `${O}/travel/booking/${REDACTED}`],
    ["booking id, any case", `${O}/Travel/Booking/bk_123`, `${O}/Travel/Booking/${REDACTED}`],
    ["uuid segment", `${O}/x/0b1e8c2a-3f4d-4e5a-9b6c-7d8e9f0a1b2c`, `${O}/x/${REDACTED}`],
    ["email segment", `${O}/u/a@b.com`, `${O}/u/${REDACTED}`],
    ["encoded email segment", `${O}/u/a%40b.com`, `${O}/u/${REDACTED}`],
    ["token segment", `${O}/l/AbC123xyz789TOKEN0000q`, `${O}/l/${REDACTED}`],
    ["long digits", `${O}/orders/123456789`, `${O}/orders/${REDACTED}`],
    ["malformed escape segment", `${O}/x/%E0%A4%A`, `${O}/x/${REDACTED}`],
  ])("%s", (_n, input, expected) => {
    const out = sanitizeAnalyticsUrl(input);
    expect(out).toBe(expected);
    expect(out).not.toMatch(/SECRET|session_id|cs_live|%40|@/);
  });

  it.each([
    ["not a URL", "not a url"],
    ["empty", ""],
    ["non-string", 42],
    ["undefined", undefined],
    ["javascript scheme", "javascript:alert(1)"],
    ["oversized", `${O}/${"a".repeat(5000)}`],
  ])("%s → null (send nothing)", (_n, input) => {
    expect(sanitizeAnalyticsUrl(input)).toBeNull();
  });
});

describe("beforeSend", () => {
  it("rewrites pageviews and keeps the event type", () => {
    expect(beforeSend({ type: "pageview", url: `${O}/auth/handoff?code=SECRET` })).toEqual({
      type: "pageview",
      url: `${O}/auth/handoff`,
    });
  });
  it("custom events: URL minimised, payload passed through untouched", () => {
    const ev = { type: "event", url: `${O}/talk-to-us?x=1`, payload: { name: "founder_call_booked" } } as never;
    expect(beforeSend(ev)).toMatchObject({ url: `${O}/talk-to-us`, payload: { name: "founder_call_booked" } });
  });
  it("drops an event it cannot sanitise", () => {
    expect(beforeSend({ type: "pageview", url: "%%%" })).toBeNull();
    expect(beforeSend(undefined as never)).toBeNull();
  });
});
