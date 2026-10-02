import { describe, expect, it, vi } from "vitest";
import { EVENTS } from "@/lib/events/events";

// /token2049 must be a PERMANENT redirect to an event that exists, so shared
// links consolidate onto the canonical event page.
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

describe("/token2049", () => {
  it("permanently redirects to the TOKEN2049 event page", () => {
    expect(() => Token2049Redirect()).toThrow("NEXT_REDIRECT");
    expect(calls).toEqual([{ kind: "permanent", to: "/events/token2049-singapore-2026" }]);
  });
  it("targets a slug that is in EVENTS (so the page and sitemap entry exist)", () => {
    expect(EVENTS.some((e) => `/events/${e.slug}` === calls[0]?.to)).toBe(true);
  });
});
