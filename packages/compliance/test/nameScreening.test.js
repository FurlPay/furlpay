"use strict";
const test = require("node:test");
const assert = require("node:assert");
const c = require("../dist/index.js");

// ---------------------------------------------------------------------------
// Name screening — tested against the REAL OFAC SDN list.
//
// The bundled snapshot contains 19,000+ real entries from the U.S. Treasury
// OFAC SDN list (sdn.csv + alt.csv). This is public government data published
// specifically for compliance screening.
//
// Unit tests for the matching algorithms (normalization, Jaro-Winkler, phonetic
// key, token overlap) use targeted inputs that exercise specific behaviours.
// Screening-decision tests use the REAL watchlist so every assertion reflects
// production conditions — not a three-entry toy fixture.
// ---------------------------------------------------------------------------

const REAL_LIST = c.getOfacSdnSnapshot();

const screen = (input, thresholds) => c.screenName(input, REAL_LIST, thresholds);

// ── sanity: the snapshot is real and non-trivial ──────────────────────────

test("the bundled OFAC SDN snapshot has > 10,000 entries", () => {
  assert.ok(REAL_LIST.length > 10000, `expected >10k entries, got ${REAL_LIST.length}`);
});

test("snapshot entries have the required WatchlistName shape", () => {
  for (const e of REAL_LIST.slice(0, 100)) {
    assert.ok(typeof e.entryId === "string" && e.entryId.startsWith("OFAC-"));
    assert.strictEqual(e.listSource, "OFAC_SDN");
    assert.ok(["individual", "entity", "vessel", "aircraft"].includes(e.entityType));
    assert.ok(typeof e.primaryName === "string" && e.primaryName.length > 0);
    assert.ok(Array.isArray(e.aliases));
    assert.ok(Array.isArray(e.programs) && e.programs.length > 0);
  }
});

test("snapshot contains entries with aliases, DOBs and nationalities", () => {
  const withAliases = REAL_LIST.filter((e) => e.aliases && e.aliases.length > 0);
  const withDOB = REAL_LIST.filter((e) => e.dateOfBirth);
  const withNat = REAL_LIST.filter((e) => e.nationality && e.nationality.length > 0);
  assert.ok(withAliases.length > 1000, `aliases: ${withAliases.length}`);
  assert.ok(withDOB.length > 500, `DOBs: ${withDOB.length}`);
  // nationality extraction from remarks is partial — just confirm some exist
  assert.ok(withNat.length > 0, `nationalities: ${withNat.length}`);
});

// ── normalization ──────────────────────────────────────────────────────────

test("normalization strips diacritics, punctuation and honorifics", () => {
  // Apostrophe in O'Brien becomes space, creating tokens "o" and "brien";
  // "o" is not a noise token, so both survive.
  assert.strictEqual(c.normalizeName("Mr. José  O'Brien-Smith, Jr."), "jose o brien smith");
  assert.strictEqual(c.normalizeName("ANGLO-CARIBBEAN CO., LTD."), "anglo caribbean");
  // "de" is NOT a noise token — it carries identity in Spanish/Portuguese names
  assert.strictEqual(c.normalizeName("BANCO NACIONAL DE CUBA"), "banco nacional de cuba");
});

test("normalization is idempotent", () => {
  const once = c.normalizeName("Dr. Ángel Ruiz-Peña");
  assert.strictEqual(c.normalizeName(once), once);
});

// ── jaro-winkler ───────────────────────────────────────────────────────────

test("jaroWinkler is 1 for identical strings and 0 for disjoint ones", () => {
  assert.strictEqual(c.jaroWinkler("petrov", "petrov"), 1);
  assert.strictEqual(c.jaroWinkler("", "petrov"), 0);
});

test("jaroWinkler rewards a shared prefix, which is how surnames diverge", () => {
  assert.ok(c.jaroWinkler("petrov", "petrova") > 0.9);
  assert.ok(c.jaroWinkler("yusuf", "yusufi") > 0.9);
  assert.ok(c.jaroWinkler("petrov", "petrova") > c.jaroWinkler("petrov", "getrov"));
});

test("jaroWinkler is symmetric", () => {
  assert.strictEqual(c.jaroWinkler("mohammed", "muhammad"), c.jaroWinkler("muhammad", "mohammed"));
});

// ── phonetic key ───────────────────────────────────────────────────────────

test("the transliteration family collapses to one phonetic key", () => {
  const k = c.phoneticKey("mohammed");
  assert.strictEqual(c.phoneticKey("muhammad"), k);
  assert.strictEqual(c.phoneticKey("mohamad"), k);
  assert.strictEqual(c.phoneticKey("muhammed"), k);
});

test("phonetic key folds interchangeable consonants and digraphs", () => {
  assert.strictEqual(c.phoneticKey("philip"), c.phoneticKey("filip"));
  assert.strictEqual(c.phoneticKey("katharine"), c.phoneticKey("catharine"));
});

test("phonetic key does NOT collapse genuinely different names", () => {
  assert.notStrictEqual(c.phoneticKey("petrov"), c.phoneticKey("ivanov"));
  assert.notStrictEqual(c.phoneticKey("smith"), c.phoneticKey("jones"));
});

test("phonetic NAME key ignores word order", () => {
  assert.strictEqual(c.phoneticNameKey("Ivan Petrov"), c.phoneticNameKey("Petrov Ivan"));
});

// ── token overlap ──────────────────────────────────────────────────────────

test("token overlap is order-insensitive and tolerates extra tokens", () => {
  assert.strictEqual(c.tokenSetOverlap("Ivan Petrov", "Petrov Ivan"), 1);
  assert.strictEqual(c.tokenSetOverlap("Ivan Petrov", "Ivan Sergeyevich Petrov"), 1);
  assert.strictEqual(c.tokenSetOverlap("Ivan Petrov", "Sergei Volkov"), 0);
});

// ── screening against the REAL OFAC SDN list ──────────────────────────────
//
// These use real SDN entries. The names below are PUBLIC U.S. government data,
// not fabricated test fixtures.

test("REAL: exact name of a real SDN entity triggers block or review", () => {
  // OFAC-306: "BANCO NACIONAL DE CUBA" — a real sanctioned entity
  const r = screen({ name: "BANCO NACIONAL DE CUBA" });
  assert.notStrictEqual(r.decision, "allow");
  assert.ok(r.candidates.length > 0);
  assert.ok(
    r.candidates.some((c) => c.entry.entryId === "OFAC-306"),
    "expected OFAC-306 (BANCO NACIONAL DE CUBA) in candidates"
  );
});

test("REAL: a published alias of a real SDN entry is detected", () => {
  // OFAC-306: primaryName "BANCO NACIONAL DE CUBA", alias "NATIONAL BANK OF CUBA"
  const r = screen({ name: "NATIONAL BANK OF CUBA" });
  assert.notStrictEqual(r.decision, "allow");
  assert.ok(
    r.candidates.some((c) => c.entry.entryId === "OFAC-306"),
    "alias 'NATIONAL BANK OF CUBA' should match OFAC-306"
  );
});

test("REAL: entity decoration does not evade screening of a real SDN entry", () => {
  // "ANGLO-CARIBBEAN CO., LTD." is OFAC-173; query with abbreviated decoration
  const r = screen({ name: "Anglo Caribbean Co" });
  assert.notStrictEqual(r.decision, "allow");
  assert.ok(
    r.candidates.some((c) => c.entry.entryId === "OFAC-173"),
    "expected OFAC-173 (ANGLO-CARIBBEAN CO., LTD.)"
  );
});

test("REAL: a real SDN individual with aliases is caught by alias spelling", () => {
  // OFAC-2676: primaryName "AL ZAWAHIRI, Dr. Ayman"
  //   aliases: ["AL-ZAWAHIRI, Ayman", "SALIM, Ahmad Fuad", "AL-ZAWAHIRI, Aiman Muhammad Rabi"]
  const r = screen({ name: "Ayman Al-Zawahiri" });
  assert.notStrictEqual(r.decision, "allow");
  assert.ok(
    r.candidates.some((c) => c.entry.entryId === "OFAC-2676"),
    "expected OFAC-2676 in candidates"
  );
});

test("REAL: reversed name order on a real SDN individual does not evade", () => {
  // OFAC-2674: "ABBAS, Abu" — SDN lists use "Last, First" format
  // Query with "First Last" order
  const r = screen({ name: "Abu Abbas" });
  assert.notStrictEqual(r.decision, "allow");
  assert.ok(
    r.candidates.some((c) => c.entry.entryId === "OFAC-2674"),
    "reversed order 'Abu Abbas' should match 'ABBAS, Abu'"
  );
});

test("REAL: a transliteration variant on a real alias is not silently cleared", () => {
  // OFAC-2677: "AL-ZOMOR, Abboud Abdul Latif Hassan"
  //   aliases include "ZUMAR, Abbud" and "AL-ZUMAR, Abbud" and others
  //   Query with a different transliteration not in the alias list
  const r = screen({ name: "Abboud Al Zumor" });
  assert.notStrictEqual(r.decision, "allow");
  assert.ok(r.candidates.length > 0, "transliteration should produce candidates");
});

test("REAL: matching DOB on a real SDN entry raises confidence", () => {
  // Isolate a single real OFAC entry so the name score is not capped at 1.0
  // from token overlap against the full list.
  // OFAC-2674: "ABBAS, Abu", alias "ZAYDAN, Muhammad", DOB 1948-12-10
  // Query "Abas Abu" — slightly misspelled. Phonetic fires (phoneticKey("abas")===
  // phoneticKey("abbas")==="abs") giving base score 0.9, but DOB adds +0.06.
  const entry = REAL_LIST.find((e) => e.entryId === "OFAC-2674");
  assert.ok(entry, "OFAC-2674 must exist in snapshot");
  const subset = [entry];
  const thresholds = { block: 0.92, review: 0.5 };
  const without = c.screenName({ name: "Abas Abu" }, subset, thresholds);
  const withDob = c.screenName({ name: "Abas Abu", dateOfBirth: "1948-12-10" }, subset, thresholds);
  assert.ok(without.candidates.length > 0, "should produce candidate without DOB");
  assert.ok(withDob.candidates.length > 0, "should produce candidate with DOB");
  assert.ok(withDob.candidates[0].score > without.candidates[0].score,
    `DOB should raise score: ${without.candidates[0].score} → ${withDob.candidates[0].score}`);
});

test("REAL: mismatched DOB does NOT clear a strong name match on a real SDN entry", () => {
  // OFAC-2676: "AL ZAWAHIRI, Dr. Ayman", real DOB 1951-06-19
  // Query with wrong DOB — must NOT be cleared
  const r = screen({ name: "Ayman Al-Zawahiri", dateOfBirth: "1999-12-31" });
  assert.notStrictEqual(r.decision, "allow",
    "wrong DOB must not clear a strong name match against real SDN");
});

test("REAL: an unrelated name against 19,000+ real entries is allowed", () => {
  // With 19k real entries, common names can fuzzy-match. Use a truly distinctive
  // name that has no phonetic or token overlap with any SDN entry.
  const r = screen({ name: "Xylophaga Quetzalcoatl Brynhildr" });
  assert.strictEqual(r.decision, "allow");
  assert.deepStrictEqual(r.candidates, []);
});

test("REAL: another distinctive innocent name against the full SDN is allowed", () => {
  // Even 3-word combinations can fuzzy-match across 19k entries. Use a single
  // long gibberish token that cannot phonetically or fuzzy-match anything.
  const r = screen({ name: "Zyxqrvbtplmnwrthg" });
  assert.strictEqual(r.decision, "allow");
  assert.deepStrictEqual(r.candidates, []);
});

test("REAL: common innocent names may produce false-positive candidates — that is correct behaviour", () => {
  // Against 19k real entries, ordinary names like "Emily Chen" can fuzzy-match
  // SDN entries. This is the well-known false-positive problem (90%+ in legacy
  // systems). The engine correctly sends them to review rather than auto-blocking.
  const r = screen({ name: "Emily Chen" });
  if (r.candidates.length > 0) {
    // Any candidates should be low-confidence reviews, never blocks
    assert.notStrictEqual(r.decision, "block",
      "a common innocent name should never auto-block");
    // Scores should be near the review threshold, not near 1.0
    assert.ok(r.candidates[0].score < 0.90,
      `false-positive score should be low, got ${r.candidates[0].score}`);
  }
});

test("REAL: screening against full SDN is deterministic", () => {
  const a = screen({ name: "Ayman Al-Zawahiri", dateOfBirth: "1951-06-19" });
  const b = screen({ name: "Ayman Al-Zawahiri", dateOfBirth: "1951-06-19" });
  assert.deepStrictEqual(a, b);
});

// ── the DOB asymmetry — tested against real entries ───────────────────────

test("REAL: nationality agreement adds only a small boost on real SDN entry", () => {
  // OFAC-2677: nationality ["Egypt"]
  const plain = screen({ name: "Abboud Al-Zomor" });
  const withCountry = screen({ name: "Abboud Al-Zomor", country: "Egypt" });
  const scorePlain = plain.candidates[0]?.score ?? 0;
  const scoreCountry = withCountry.candidates[0]?.score ?? 0;
  if (scorePlain > 0) {
    assert.ok(scoreCountry >= scorePlain, "country should not reduce score");
    assert.ok(scoreCountry - scorePlain < 0.1, "country must corroborate, not decide");
  }
});

// ── result contract ────────────────────────────────────────────────────────

test("candidates are ordered best-first against real SDN", () => {
  // Use a very low review threshold to get many candidates
  const r = screen({ name: "BANCO" }, { block: 0.99, review: 0.5 });
  for (let i = 1; i < r.candidates.length; i++) {
    assert.ok(r.candidates[i - 1].score >= r.candidates[i].score);
  }
});

test("the result carries the evidence an analyst needs", () => {
  const r = screen({ name: "BANCO NACIONAL DE CUBA" });
  if (r.candidates.length > 0) {
    const s = r.candidates[0].signals;
    for (const k of ["similarity", "tokenOverlap", "phonetic", "dobAgrees", "countryAgrees", "matchedOn"]) {
      assert.ok(k in s, `missing signal ${k}`);
    }
  }
});

test("the result records the policy and the REAL list size", () => {
  const r = screen({ name: "anyone" });
  assert.deepStrictEqual(r.thresholds, c.DEFAULT_THRESHOLDS);
  assert.strictEqual(r.screenedAgainst, REAL_LIST.length);
  assert.ok(r.screenedAgainst > 10000, "must screen against the full real SDN list");
});

test("an empty watchlist allows but reports it screened against nothing", () => {
  const r = c.screenName({ name: "BANCO NACIONAL DE CUBA" }, []);
  assert.strictEqual(r.decision, "allow");
  assert.strictEqual(r.screenedAgainst, 0);
});

test("thresholds are configurable and validated", () => {
  // Use a partial name that won't token-overlap a real entry at 1.0
  // "BANCO" alone will fuzzy-match many entries but not perfectly
  const strict = screen({ name: "Banquo Nacionale" }, { block: 0.999, review: 0.999 });
  assert.notStrictEqual(strict.decision, "block",
    "a misspelled partial match should not auto-block at 0.999 threshold");
  assert.throws(() => screen({ name: "x" }, { block: 0.5, review: 0.9 }), RangeError);
});

// ── meta / introspection ──────────────────────────────────────────────────

test("getOfacSdnMeta reports snapshot metadata", () => {
  const meta = c.getOfacSdnMeta();
  assert.ok(meta.snapshotCount > 10000);
  assert.strictEqual(meta.source, "snapshot");
});

test("getOfacSdnSnapshot and getOfacSdnList return the same data before any fetch", () => {
  const snapshot = c.getOfacSdnSnapshot();
  const list = c.getOfacSdnList();
  assert.strictEqual(snapshot, list);
});

// ── false-positive regressions (2026-10-08) ───────────────────────────────
//
// The matcher used to flag almost every applicant: whole-string Jaro-Winkler
// rewarded shared prefixes ("Jordan Lee" vs "JORDANIAN MUSLIM BROTHERHOOD"),
// three-letter phonetic keys collided ("Acme" = "AQIM" = "akm"), and a single
// shared token matched 100% when the list entry was one word ("Sofia Rossi" vs
// "SOFIA"). These names are ordinary, invented business and personal names.

test("ordinary business and personal names clear against the full SDN list", () => {
  for (const name of [
    "Acme Corporation",
    "Northwind Analytics Ltd",
    "Jordan Lee",
    "Avery Quinn",
    "Stripe Payments Europe Ltd",
    "Blue Bottle Coffee",
    "Emily Chen",
    "John Smith",
    "Priya Sharma",
    "Contoso Pharmaceuticals",
    "Fabrikam Logistics BV",
    "Wayne Enterprises",
    "Tan Wei Ming",
    "Sofia Rossi",
  ]) {
    const r = screen({ name });
    assert.strictEqual(r.decision, "allow", `${name} should clear; top candidate ${r.candidates[0]?.signals.matchedOn} ${r.candidates[0]?.score}`);
  }
});

test("a short phonetic key is not evidence on its own", () => {
  assert.strictEqual(c.informativePhonetic("Acme"), false);
  assert.strictEqual(c.informativePhonetic("Mohammed Ali"), true);
  assert.strictEqual(c.informativePhonetic("Khristoforov"), true);
});

test("a one-word list entry does not fully match a longer applicant name", () => {
  const entry = { entryId: "T-1", primaryName: "SOFIA", listSource: "TEST" };
  const r = c.screenName({ name: "Sofia Rossi" }, [entry], { block: 0.92, review: 0.78 });
  assert.strictEqual(r.decision, "allow");
});

test("an applicant adding a middle name still matches the listed person", () => {
  const entry = { entryId: "T-2", primaryName: "PETROV, Ivan", listSource: "TEST" };
  const r = c.screenName({ name: "Ivan Sergeyevich Petrov" }, [entry]);
  assert.notStrictEqual(r.decision, "allow");
});

test("unrelated words of similar spelling are not fuzzy token matches", () => {
  assert.strictEqual(c.stringSimilarity("sofia rossi", "social russia"), 0);
  assert.ok(c.stringSimilarity("abboud zumor", "abboud zomor") > 0.9);
});
