import { describe, expect, it } from "vitest";
import { SUPPORT_KB, retrieveKb } from "../kb";

// ---------------------------------------------------------------------------
// Help-centre retrieval.
//
// This is the gate in front of the support assistant, and its FAILURE MODE IS
// ASYMMETRIC. Missing a relevant article costs a visitor one unhelpful reply.
// Returning an irrelevant one costs them a confident, cited, wrong answer —
// because `answerSupportQuestion` treats any non-empty result as grounds to
// answer and leaves `escalate` false.
//
// So "returns nothing" is a first-class correct outcome and is tested as hard
// as the hits are.
// ---------------------------------------------------------------------------

const titles = (q: string) => retrieveKb(q).map((e) => e.title);

describe("retrieveKb — finding the right article", () => {
  it("finds the declined-card article", () => {
    expect(titles("why was my card declined")[0]).toBe("Why a card transaction was declined");
  });

  it("finds KYC from the acronym", () => {
    expect(titles("kyc tiers")[0]).toBe("KYC verification & tiers");
  });

  it("finds passkeys", () => {
    expect(titles("passkey login")[0]).toBe("Passkeys & biometric login");
  });

  it("finds travel refunds", () => {
    expect(titles("cancel my hotel booking refund").join(" ")).toContain("refund");
  });

  it("ranks the most relevant article first, not merely a related one", () => {
    const top = titles("freeze my card")[0];
    expect(top).toBe("Freeze, unfreeze, or replace a card");
  });

  it("respects the limit", () => {
    expect(retrieveKb("card", 2)).toHaveLength(2);
  });
});

describe("retrieveKb — refusing to match", () => {
  // Each of these was a FALSE POSITIVE before the word-boundary fix: scoring
  // used `content.includes(token)`, so "an" hit inside *balance*, "is" inside
  // *this*, and "of" inside ordinary prose. Every article scored above zero for
  // any sentence, so the assistant never escalated.

  it("returns nothing for a question the help centre does not cover", () => {
    expect(retrieveKb("what is the airspeed velocity of an unladen swallow")).toEqual([]);
  });

  it("returns nothing for conversational filler", () => {
    expect(retrieveKb("hello there how are you")).toEqual([]);
  });

  it("returns nothing for a question about an unrelated company", () => {
    expect(retrieveKb("who won the football match last night")).toEqual([]);
  });

  it("does not match a short token inside a longer word", () => {
    // "an" is a substring of "balance", "and", "any" — across the whole corpus.
    expect(retrieveKb("an")).toEqual([]);
  });

  it("does not match on stopwords alone", () => {
    expect(retrieveKb("what is the")).toEqual([]);
  });

  it("returns nothing for an empty query", () => {
    expect(retrieveKb("")).toEqual([]);
  });

  it("returns nothing for punctuation only", () => {
    expect(retrieveKb("???")).toEqual([]);
  });

  it("needs more than one incidental shared word", () => {
    // A sentence that happens to contain "card" ONCE in an unrelated question
    // should not outrank silence — one glancing hit is not a subject match.
    // (A single keyword hit scores 3, which is the floor; this checks the floor
    // is actually applied rather than being off by one.)
    expect(retrieveKb("xyzzy plugh frobnicate")).toEqual([]);
  });
});

describe("the corpus itself", () => {
  it("has an entry per published help article", () => {
    expect(SUPPORT_KB).toHaveLength(14);
  });

  it("gives every entry a root-relative help-centre href", () => {
    // These are cited back to the visitor as links; an off-origin href here
    // would be a link out of FurlPay rendered as a FurlPay source.
    const bad = SUPPORT_KB.filter((e) => !/^\/docs\/help\/[a-z0-9-]+$/.test(e.href));
    expect(bad.map((e) => e.href)).toEqual([]);
  });

  it("gives every entry unique ids and hrefs", () => {
    expect(new Set(SUPPORT_KB.map((e) => e.id)).size).toBe(SUPPORT_KB.length);
    expect(new Set(SUPPORT_KB.map((e) => e.href)).size).toBe(SUPPORT_KB.length);
  });

  it("gives every entry grounding text and keywords", () => {
    const thin = SUPPORT_KB.filter((e) => e.content.length < 40 || e.keywords.length === 0);
    expect(thin.map((e) => e.id)).toEqual([]);
  });

  it("is reachable — every article can be retrieved by its own title", () => {
    // An article no query can reach is dead weight in the corpus and a hole in
    // the assistant's coverage.
    const unreachable = SUPPORT_KB.filter(
      (e) => !retrieveKb(e.title, 14).some((hit) => hit.id === e.id)
    );
    expect(unreachable.map((e) => e.id)).toEqual([]);
  });
});
