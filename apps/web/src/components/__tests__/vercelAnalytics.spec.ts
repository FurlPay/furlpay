import { describe, expect, it } from "vitest";
import { stripQuery } from "@/components/VercelAnalytics";

// Analytics must never receive query strings: on this site they can carry
// one-time secrets (/auth/handoff?code=…, OAuth and payment returns).
describe("VercelAnalytics stripQuery", () => {
  it.each([
    ["https://furlpay.com/auth/handoff?code=SECRET", "https://furlpay.com/auth/handoff"],
    ["https://furlpay.com/oauth/callback?code=x&state=y#frag", "https://furlpay.com/oauth/callback"],
    ["https://furlpay.com/talk-to-us", "https://furlpay.com/talk-to-us"],
  ])("%s → %s", (url, expected) => {
    const out = stripQuery({ type: "pageview", url });
    expect(out.url).toBe(expected);
    expect(out.url).not.toContain("SECRET");
  });
});
