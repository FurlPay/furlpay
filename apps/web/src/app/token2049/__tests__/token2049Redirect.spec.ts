import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it, vi } from "vitest";
import { EVENTS } from "@/lib/events/events";

// /token2049 is a TEMPORARY redirect to an event that exists: it is repointed
// at each year's edition, so it must not be cached permanently. The config
// rule (next.config.js) runs first; the page is the fallback; both must agree.
const calls: { kind: string; to: string }[] = [];
vi.mock("next/navigation", () => ({
  permanentRedirect: (to: string) => {
    calls.push({ kind: "permanent", to });
    throw new Error("NEXT_REDIRECT");
  },
  redirect: (to: string) => {
    calls.push({ kind: "temporary", to });
    throw new Error("NEXT_REDIRECT");
  },
}));

import Token2049Redirect from "@/app/token2049/page";

const TARGET = "/events/token2049-singapore-2026";

describe("/token2049", () => {
  it("page fallback: temporary redirect to the event page", () => {
    expect(() => Token2049Redirect()).toThrow("NEXT_REDIRECT");
    expect(calls).toEqual([{ kind: "temporary", to: TARGET }]);
  });
  it("next.config.js rule: same target, permanent: false", () => {
    const cfg = readFileSync(join(__dirname, "../../../../next.config.js"), "utf8");
    const rule = cfg.match(/\{\s*source:\s*"\/token2049",\s*destination:\s*"([^"]+)",\s*permanent:\s*(true|false)\s*\}/);
    expect(rule?.[1]).toBe(TARGET);
    expect(rule?.[2]).toBe("false");
  });
  it("targets a slug that is in EVENTS (so the page and sitemap entry exist)", () => {
    expect(EVENTS.some((e) => `/events/${e.slug}` === TARGET)).toBe(true);
  });
});
