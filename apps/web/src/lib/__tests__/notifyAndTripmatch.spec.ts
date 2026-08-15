import { describe, expect, it } from "vitest";
import { prefFor, shouldNotify } from "../notify";
import { editDistanceIsAtMost1, fuzzyNameMatch, matchTrips } from "../travel/tripmatch";
import { DESTINATIONS } from "../travel/data";

// ---------------------------------------------------------------------------
// Notification gating. The senders are I/O; the part that must never silently
// regress is WHICH preference governs WHICH event — especially that declines
// ride the security toggle, because an unexpected decline is how card fraud
// usually announces itself, and a user who muted routine receipts still
// expects to hear about a refusal.
// ---------------------------------------------------------------------------

describe("transaction notification gating", () => {
  it("declines are security events; activity is transactions", () => {
    expect(prefFor("card_declined")).toBe("security");
    expect(prefFor("card_approved")).toBe("transactions");
    expect(prefFor("transfer_out")).toBe("transactions");
  });

  it("each event honours exactly its own toggle", () => {
    const onlySecurity = { transactions: false, security: true };
    expect(shouldNotify(onlySecurity, "card_declined")).toBe(true);
    expect(shouldNotify(onlySecurity, "card_approved")).toBe(false);
    expect(shouldNotify(onlySecurity, "transfer_out")).toBe(false);

    const onlyTx = { transactions: true, security: false };
    expect(shouldNotify(onlyTx, "card_declined")).toBe(false);
    expect(shouldNotify(onlyTx, "card_approved")).toBe(true);
  });

  it("missing preferences mean silence, not broadcast", () => {
    expect(shouldNotify(undefined, "card_declined")).toBe(false);
    expect(shouldNotify(undefined, "transfer_out")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Fuzzy destination matching. Dictated queries arrive with one-letter slips;
// a search that returns nothing for "tokio" reads as broken, not strict.
// ---------------------------------------------------------------------------

describe("editDistanceIsAtMost1", () => {
  it("accepts equality, one substitution, one indel, one transposition", () => {
    expect(editDistanceIsAtMost1("tokyo", "tokyo")).toBe(true);
    expect(editDistanceIsAtMost1("tokio", "tokyo")).toBe(true); // substitution
    expect(editDistanceIsAtMost1("lisbonn", "lisbon")).toBe(true); // insertion
    expect(editDistanceIsAtMost1("lisbn", "lisbon")).toBe(true); // deletion
    expect(editDistanceIsAtMost1("tokoy", "tokyo")).toBe(true); // transposition
  });

  it("rejects two edits and unrelated words", () => {
    expect(editDistanceIsAtMost1("tokyoo!", "tokyo")).toBe(false);
    expect(editDistanceIsAtMost1("paris", "peru")).toBe(false);
    expect(editDistanceIsAtMost1("berlin", "dublin")).toBe(false);
  });
});

describe("fuzzyNameMatch", () => {
  it("matches 4+-letter prefixes and near-misses, not short fragments", () => {
    expect(fuzzyNameMatch("marr", "Marrakech")).toBe(true); // prefix
    expect(fuzzyNameMatch("ma", "Marrakech")).toBe(false); // too short to mean anything
    expect(fuzzyNameMatch("tokio trip", "Tokyo")).toBe(true); // per-token near-miss
    expect(fuzzyNameMatch("beach under $100", "Tokyo")).toBe(false);
  });
});

describe("matchTrips typo tolerance (against the real catalog)", () => {
  // Data-independent: take a real destination and mangle its own name, so the
  // test cannot rot when the catalog changes.
  const dest = DESTINATIONS.find((d) => d.name.length >= 5)!;

  it("a one-letter slip in a real destination name still finds it first", () => {
    const name = dest.name.toLowerCase();
    // swap two adjacent letters mid-word — the classic thumb/dictation slip
    const i = 2;
    const mangled = name.slice(0, i) + name[i + 1] + name[i] + name.slice(i + 2);
    const { matches } = matchTrips(mangled);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].destination.slug).toBe(dest.slug);
  });

  it("an exactly-spelled competitor still outranks a fuzzy one", () => {
    const other = DESTINATIONS.find((d) => d.slug !== dest.slug && d.name.length >= 5)!;
    const name = dest.name.toLowerCase();
    const mangled = name.slice(0, 2) + name[3] + name[2] + name.slice(4);
    const { matches } = matchTrips(`${mangled} or ${other.name.toLowerCase()}`);
    expect(matches[0].destination.slug).toBe(other.slug);
  });
});
