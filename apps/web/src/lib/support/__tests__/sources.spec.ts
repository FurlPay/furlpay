import { describe, expect, it } from "vitest";
import { isSafeSourceHref, safeSources } from "../sources";
import { SUPPORT_KB } from "../kb";
import { answerSupportQuestion } from "../answer";

// ---------------------------------------------------------------------------
// OWASP LLM10:2026 Improper Output Handling.
//
// The client renders each cited source as a `next/link`, so this list is a
// navigation primitive built from data. Today every href is a committed
// constant in kb.ts, which is why this is defence in depth rather than a fix —
// but the test that matters most is the LAST one in the first block: the real
// KB must survive the filter, because a validator that quietly drops every
// legitimate citation is worse than none at all.
// ---------------------------------------------------------------------------

describe("isSafeSourceHref — accepts real help-centre paths", () => {
  it.each(["/docs/help/deposits-withdrawals", "/docs/help/x402-basics", "/support/new", "/legal/terms"])(
    "accepts %s",
    (href) => expect(isSafeSourceHref(href)).toBe(true)
  );

  it("accepts every href in the shipped knowledge base", () => {
    // The regression this pins: an earlier draft of the control-character check
    // was written as [ -], a range that matches a HYPHEN. Every KB slug has a
    // hyphen, so it silently rejected all 14 articles — every answer would have
    // rendered with zero citations and nothing would have thrown.
    const rejected = SUPPORT_KB.filter((e) => !isSafeSourceHref(e.href)).map((e) => e.href);
    expect(rejected).toEqual([]);
    expect(SUPPORT_KB.length).toBeGreaterThan(0);
  });
});

describe("isSafeSourceHref — rejects navigation off our origin", () => {
  it.each([
    ["protocol-relative", "//evil.com/login"],
    ["backslash-escaped host", "/\\evil.com"],
    ["absolute https", "https://evil.com/docs/help/x"],
    ["javascript scheme", "javascript:alert(1)"],
    ["data scheme", "data:text/html,<script>alert(1)</script>"],
    ["scheme after the slash", "/javascript:alert(1)"],
    ["traversal", "/docs/../../admin/users"],
    ["a path outside the help centre", "/admin/users"],
    ["a bare relative path", "docs/help/x"],
    ["empty", ""],
    ["just a slash", "/"],
  ])("rejects %s", (_label, href) => expect(isSafeSourceHref(href)).toBe(false));

  it("rejects an embedded newline", () => {
    expect(isSafeSourceHref("/docs/help/a\nb")).toBe(false);
  });

  it("rejects non-strings without throwing", () => {
    for (const v of [null, undefined, 42, {}, [], true]) {
      expect(isSafeSourceHref(v)).toBe(false);
    }
  });
});

describe("safeSources — drops rather than rewrites", () => {
  it("keeps the good and removes the bad", () => {
    const out = safeSources([
      { title: "Deposits", href: "/docs/help/deposits-withdrawals" },
      { title: "Phishing", href: "//evil.com" },
      { title: "Offsite", href: "https://evil.com" },
    ]);
    expect(out.map((s) => s.title)).toEqual(["Deposits"]);
  });

  it("does not repoint a bad href at a real article", () => {
    // Rewriting would fabricate provenance: the claim would appear cited by an
    // article that never supported it.
    const out = safeSources([{ title: "Refunds are automatic", href: "//evil.com" }]);
    expect(out).toEqual([]);
  });

  it("survives a malformed payload", () => {
    const junk = [null, undefined, {}, { title: "x" }, { href: "/docs/help/x" }] as never[];
    expect(() => safeSources(junk)).not.toThrow();
    expect(safeSources(junk)).toEqual([]);
    expect(safeSources(undefined)).toEqual([]);
  });
});

describe("the answer endpoint only ever emits safe sources", () => {
  it("every source of a grounded answer passes the validator", async () => {
    const res = await answerSupportQuestion("why was my card declined");
    expect(res.sources.length).toBeGreaterThan(0);
    for (const s of res.sources) expect(isSafeSourceHref(s.href)).toBe(true);
  });
});
