// ---------------------------------------------------------------------------
// Name-based sanctions screening.
//
// WHY THIS EXISTS SEPARATELY FROM aml.ts. `screenWallet` matches crypto
// addresses, which is an EXACT-match problem: an address is a checksum of a
// public key, so "close" is meaningless and a fuzzy match would be a bug.
// Screening a human name is the opposite problem. The same person appears on
// the SDN list as "Muhammad", "Mohammed" and "Mohamad"; as "Ivan Petrov" and
// "Petrov, Ivan"; with and without patronymics, honorifics and diacritics. An
// exact matcher misses all of it, which is why a separate engine is needed
// rather than an extension of the address path.
//
// WHAT THIS DOES NOT DO, DELIBERATELY:
//
//   - It ships NO name list. aml.ts can bundle a snapshot because OFAC's
//     crypto-address set is small and public; the SDN name corpus is large,
//     versioned, and legally consequential to get stale. Entries are supplied
//     by the caller so the list source, its version and its refresh cadence are
//     an explicit operational decision, not a constant frozen into a build.
//   - It does not fabricate a risk score. A match score is a string-similarity
//     measurement and is reported as exactly that, with the evidence that
//     produced it.
//   - It does not auto-clear. `allow` means "no candidate crossed the review
//     threshold", never "this person is not sanctioned".
//
// ON FALSE POSITIVES. Name screening is dominated by them — common names
// collide constantly, and a system tuned to never miss will flood a review
// queue. That trade-off is a compliance policy decision, not an engineering
// one, so thresholds are parameters and every decision carries the per-signal
// breakdown that produced it. An analyst reviewing an alert can see whether it
// was carried by a phonetic match on a common surname or by a full name plus
// date-of-birth agreement, which are not remotely the same evidence.
//
// Zero dependencies, matching the rest of this package. Jaro-Winkler and the
// phonetic key are implemented here rather than pulled from npm: they are
// short, well-specified algorithms, and a screening engine should not have a
// supply-chain dependency it cannot audit (AGENTS.md rule 11).
// ---------------------------------------------------------------------------

/** One sanctions-list record the caller wants screened against. */
export interface WatchlistName {
  /** Stable id from the source list, e.g. an OFAC `uid`. */
  entryId: string;
  listSource: string;
  entityType: "individual" | "entity" | "vessel" | "aircraft";
  primaryName: string;
  /** Alternate spellings the list publishes (a.k.a., f.k.a., low-quality a.k.a.). */
  aliases?: string[];
  /** ISO date, when the list gives one. Used only to CONFIRM, never to clear. */
  dateOfBirth?: string;
  nationality?: string[];
  programs?: string[];
}

export interface NameScreenInput {
  name: string;
  /** ISO date. Agreement raises confidence; a mismatch does NOT clear a match. */
  dateOfBirth?: string;
  /** ISO 3166-1 alpha-2. */
  country?: string;
}

export interface NameMatchSignals {
  /** Jaro-Winkler on the normalized full name, 0..1. */
  similarity: number;
  /** Order-insensitive token overlap, 0..1. */
  tokenOverlap: number;
  /** Whether the phonetic keys agree. */
  phonetic: boolean;
  /** Whether the supplied date of birth equals the list entry's. */
  dobAgrees: boolean;
  /** Whether the supplied country appears in the entry's nationalities. */
  countryAgrees: boolean;
  /** Which of primaryName/aliases produced the best score. */
  matchedOn: string;
}

export interface NameMatchCandidate {
  entry: WatchlistName;
  score: number;
  signals: NameMatchSignals;
}

export interface NameScreenResult {
  decision: "block" | "review" | "allow";
  /** Highest-scoring candidates, best first. Empty when nothing crossed review. */
  candidates: NameMatchCandidate[];
  /** Echoed so an audit record can prove which policy produced this decision. */
  thresholds: ScreeningThresholds;
  /** Count of list entries actually compared — proves the list was not empty. */
  screenedAgainst: number;
}

export interface ScreeningThresholds {
  /** At or above this, the decision is `block`. */
  block: number;
  /** At or above this (and below `block`), the decision is `review`. */
  review: number;
}

/**
 * Defaults are deliberately cautious rather than tuned: 0.92 to auto-block is
 * high enough that near-identical strings are required, and 0.78 sends a wide
 * band to human review. Tune against YOUR list and traffic — a shipped default
 * cannot know either.
 */
export const DEFAULT_THRESHOLDS: ScreeningThresholds = { block: 0.92, review: 0.78 };

// ── Normalization ──────────────────────────────────────────────────────────

/** Honorifics and organisational suffixes that carry no identifying signal. */
const NOISE_TOKENS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "sir", "hon", "rev",
  "jr", "sr", "ii", "iii", "iv",
  "ltd", "limited", "llc", "inc", "incorporated", "corp", "corporation",
  "co", "company", "plc", "gmbh", "sa", "ag", "bv", "nv", "pte", "pvt",
  "the", "of", "and",
]);

/**
 * Fold a name to a comparable form: strip diacritics, drop punctuation, lower
 * case, and remove tokens that carry no identity.
 *
 * "Bank of Iran, Ltd." and "BANK IRAN" both fold to "bank iran", which is the
 * point — the list and the applicant rarely agree on decoration.
 */
export function normalizeName(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritics
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0 && !NOISE_TOKENS.has(t))
    .join(" ")
    .trim();
}

export function nameTokens(raw: string): string[] {
  const n = normalizeName(raw);
  return n.length === 0 ? [] : n.split(" ");
}

// ── Jaro-Winkler ───────────────────────────────────────────────────────────

/** Jaro similarity, 0..1. */
function jaro(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aFlags = new Array<boolean>(a.length).fill(false);
  const bFlags = new Array<boolean>(b.length).fill(false);

  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - window);
    const end = Math.min(i + window + 1, b.length);
    for (let j = start; j < end; j++) {
      if (bFlags[j] || a[i] !== b[j]) continue;
      aFlags[i] = true;
      bFlags[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;

  // Transpositions: matched characters that appear out of order.
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aFlags[i]) continue;
    while (!bFlags[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  transpositions /= 2;

  const m = matches;
  return (m / a.length + m / b.length + (m - transpositions) / m) / 3;
}

/**
 * Jaro-Winkler: Jaro, boosted when the strings share a prefix. Sanctions
 * screening favours it over raw edit distance because surnames diverge at the
 * END far more often than at the start ("Yusuf"/"Yusufi", "Petrov"/"Petrova").
 */
export function jaroWinkler(a: string, b: string, prefixScale = 0.1): number {
  const j = jaro(a, b);
  if (j === 0) return 0;
  let prefix = 0;
  const max = Math.min(4, a.length, b.length);
  while (prefix < max && a[prefix] === b[prefix]) prefix++;
  return j + prefix * prefixScale * (1 - j);
}

// ── Phonetic key ───────────────────────────────────────────────────────────

/**
 * A deliberately small phonetic key, NOT Double Metaphone.
 *
 * Calling this Double Metaphone would be a lie — that algorithm is several
 * hundred lines of English-centric rules and would not, on its own, do better
 * on the transliteration families that actually matter here. This targets the
 * specific collisions sanctions lists produce: vowels carry almost no signal
 * across transliterations, doubled consonants are arbitrary, and a handful of
 * consonant classes are routinely interchanged.
 *
 * "Mohammed" / "Muhammad" / "Mohamad" all reduce to "mhmd".
 */
export function phoneticKey(token: string): string {
  if (!token) return "";
  const t = token.toLowerCase();
  let out = "";
  for (let i = 0; i < t.length; i++) {
    let c = t[i];
    // Digraphs that collapse to one sound.
    const pair = t.slice(i, i + 2);
    if (pair === "ph") { c = "f"; i++; }
    else if (pair === "gh") { c = "g"; i++; }
    else if (pair === "kh" || pair === "ch") { c = "k"; i++; }
    else if (pair === "sh") { c = "s"; i++; }
    else if (pair === "th") { c = "t"; i++; }
    else if (pair === "zh") { c = "j"; i++; }
    // Interchangeable consonant classes.
    else if (c === "c") c = "k";
    else if (c === "q") c = "k";
    else if (c === "x") c = "k";
    else if (c === "z") c = "s";
    else if (c === "v") c = "f";
    else if (c === "w") c = "v";
    else if (c === "y") c = "i";

    // Vowels are dropped except a leading one, which anchors the key.
    if ("aeiou".includes(c)) {
      if (out.length === 0) out += c;
      continue;
    }
    // Collapse doubled consonants.
    if (out.length > 0 && out[out.length - 1] === c) continue;
    out += c;
  }
  return out;
}

/** Phonetic key for a whole name: per-token keys, sorted so order cannot matter. */
export function phoneticNameKey(raw: string): string {
  return nameTokens(raw).map(phoneticKey).filter(Boolean).sort().join(" ");
}

// ── Token-set overlap ──────────────────────────────────────────────────────

/**
 * Order-insensitive overlap, so "Petrov Ivan" scores against "Ivan Petrov".
 * Uses the SMALLER token set as the denominator: a list entry carrying extra
 * patronymics or a middle name should not dilute a match on the names both
 * sides actually share.
 */
export function tokenSetOverlap(a: string, b: string): number {
  const A = new Set(nameTokens(a));
  const B = new Set(nameTokens(b));
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  return shared / Math.min(A.size, B.size);
}

// ── Scoring ────────────────────────────────────────────────────────────────

/**
 * Combine the signals for one candidate name.
 *
 * The string signals dominate; date of birth and nationality only ADD, and only
 * a little. That asymmetry is deliberate and is the most important policy
 * decision in this file: a matching date of birth is strong corroboration, but
 * a MISSING or differing one is not exculpatory. Sanctions lists carry partial,
 * approximate and outright wrong dates, and applicants lie about them. A
 * screening engine that lets a DOB mismatch pull a strong name match below the
 * review line would clear exactly the people it exists to catch.
 */
function scoreAgainstName(
  input: NameScreenInput,
  candidateName: string,
  entry: WatchlistName
): { score: number; signals: NameMatchSignals } {
  const a = normalizeName(input.name);
  const b = normalizeName(candidateName);

  const similarity = jaroWinkler(a, b);
  const tokenOverlap = tokenSetOverlap(input.name, candidateName);
  const phonetic = a.length > 0 && phoneticNameKey(input.name) === phoneticNameKey(candidateName);

  const dobAgrees = !!input.dateOfBirth && !!entry.dateOfBirth && input.dateOfBirth === entry.dateOfBirth;
  const countryAgrees =
    !!input.country && !!entry.nationality?.some((n) => n.toUpperCase() === input.country!.toUpperCase());

  // The string evidence is the maximum of the two views: a reordered exact
  // match and a character-level near-match are both strong, and neither should
  // be averaged away by the other being weak.
  let score = Math.max(similarity, tokenOverlap);
  if (phonetic) score = Math.max(score, 0.9);

  if (dobAgrees) score += 0.06;
  if (countryAgrees) score += 0.03;

  return {
    score: Math.min(1, score),
    signals: { similarity, tokenOverlap, phonetic, dobAgrees, countryAgrees, matchedOn: candidateName },
  };
}

/**
 * Screen one identity against a supplied watchlist.
 *
 * Pure and synchronous: given the same input and the same list it always
 * returns the same decision, which is what makes a screening record reproducible
 * years later during an audit — provided the caller also records the list
 * version it passed in.
 */
export function screenName(
  input: NameScreenInput,
  watchlist: readonly WatchlistName[],
  thresholds: ScreeningThresholds = DEFAULT_THRESHOLDS
): NameScreenResult {
  if (thresholds.review > thresholds.block) {
    throw new RangeError("review threshold must not exceed block threshold");
  }

  const candidates: NameMatchCandidate[] = [];

  for (const entry of watchlist) {
    // Every published spelling is a separate chance to match; the best wins.
    const names = [entry.primaryName, ...(entry.aliases ?? [])].filter(Boolean);
    let best: { score: number; signals: NameMatchSignals } | null = null;
    for (const name of names) {
      const scored = scoreAgainstName(input, name, entry);
      if (!best || scored.score > best.score) best = scored;
    }
    if (best && best.score >= thresholds.review) {
      candidates.push({ entry, score: best.score, signals: best.signals });
    }
  }

  candidates.sort((x, y) => y.score - x.score);

  const top = candidates[0]?.score ?? 0;
  const decision = top >= thresholds.block ? "block" : top >= thresholds.review ? "review" : "allow";

  return { decision, candidates, thresholds, screenedAgainst: watchlist.length };
}
