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

// ── Character-level evidence ───────────────────────────────────────────────
//
// Whole-string Jaro-Winkler was the original character signal, and on its own
// it flagged nearly every applicant: the prefix bonus rewards any shared
// opening ("jordan lee" vs "jordanian muslim brotherhood" = 0.84) regardless of
// what follows, and on short strings a single dropped letter still scores 0.9+
// ("acme" vs "ace" = 0.93). Against 19,000 entries that produced review-level
// candidates for ordinary business names, which made screening unusable without
// making it any stricter. The fixes below keep every true-positive family the
// tests pin (transliteration, reordering, decoration, aliases, suffix drift).

/** Tokens this short carry too little signal for fuzzy matching: exact only. */
const SHORT_TOKEN = 4;
/**
 * Below this, a fuzzy token pair is not evidence. Unrelated words of ordinary
 * length routinely score 0.82–0.86 ("rossi"/"russia", "sofia"/"social");
 * transliteration and suffix variants score above it ("zumor"/"zomor" 0.88,
 * "zawahri"/"zawahiri" 0.97). Phonetic keys cover the vowel-shift families.
 */
const TOKEN_MATCH = 0.87;

function tokenSimilarity(x: string, y: string): number {
  if (x === y) return 1;
  if (Math.min(x.length, y.length) <= SHORT_TOKEN) return 0;
  const jw = jaroWinkler(x, y);
  return jw >= TOKEN_MATCH ? jw : 0;
}

/**
 * Character evidence for two normalised names.
 *
 *   - Token-aligned: every token of the shorter name is paired with its best
 *     counterpart in the longer one and the pair scores are averaged by token
 *     length, so a strong match on one token cannot carry an unrelated rest.
 *   - A single token fuzzily matching one part of a longer name is weak
 *     evidence ("northwind" vs "north wood industry") and is discounted. Exact
 *     shared tokens are unaffected — tokenSetOverlap still scores them fully.
 */
export function stringSimilarity(a: string, b: string, weightOf: (token: string) => number = (t) => t.length): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ta = a.split(" ");
  const tb = b.split(" ");
  // How well the APPLICANT's name (a) is explained by the candidate (b): every
  // applicant token is paired with its best candidate token, weighted by how
  // distinctive the token is. Extra tokens on the list side (patronymics,
  // middle names) do not dilute; extra applicant tokens that match nothing do.
  let weighted = 0;
  let weight = 0;
  for (const t of ta) {
    let best = 0;
    for (const u of tb) best = Math.max(best, tokenSimilarity(t, u));
    const w = weightOf(t);
    weighted += best * w;
    weight += w;
  }
  let aligned = weight ? weighted / weight : 0;
  if (ta.length === 1 && tb.length > 1 && !tb.includes(ta[0])) aligned *= 0.85;
  return aligned;
}

/**
 * Token rarity across the watchlist (inverse document frequency). "Company",
 * "trading", "payments", "logistics" each appear on hundreds of SDN entries, so
 * sharing one says almost nothing; sharing a rare token says a lot. Computed
 * once per list instance.
 */
const IDF_CACHE = new WeakMap<readonly WatchlistName[], (token: string) => number>();
export function tokenWeights(watchlist: readonly WatchlistName[]): (token: string) => number {
  const cached = IDF_CACHE.get(watchlist);
  if (cached) return cached;
  const df = new Map<string, number>();
  for (const entry of watchlist) {
    const seen = new Set<string>();
    for (const name of [entry.primaryName, ...(entry.aliases ?? [])]) for (const t of nameTokens(name)) seen.add(t);
    for (const t of seen) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const n = Math.max(1, watchlist.length);
  const fn = (token: string) => Math.log(1 + n / (1 + (df.get(token) ?? 0)));
  IDF_CACHE.set(watchlist, fn);
  return fn;
}

/**
 * Exact-token evidence. Either the applicant's name is (rarity-weighted)
 * covered by the candidate's tokens, or a multi-token candidate is wholly
 * contained in the applicant's name ("Ivan Petrov" inside "Ivan Sergeyevich
 * Petrov"). A single-token candidate contained in a longer applicant name
 * ("SOFIA" in "Sofia Rossi") only counts for the share of the name it explains.
 */
export function weightedOverlap(applicant: string, candidate: string, weightOf: (token: string) => number): number {
  const A = [...new Set(nameTokens(applicant))];
  const B = new Set(nameTokens(candidate));
  if (A.length === 0 || B.size === 0) return 0;
  let covered = 0;
  let total = 0;
  for (const t of A) {
    const w = weightOf(t);
    total += w;
    if (B.has(t)) covered += w;
  }
  const coverage = total ? covered / total : 0;
  const contained = B.size >= 2 && [...B].every((t) => A.includes(t)) ? 1 : 0;
  return Math.max(coverage, contained);
}

/**
 * A phonetic key is only evidence when it has enough consonants to be
 * distinctive. "Acme" and "AQIM" both reduce to "akm" — a three-letter key
 * collides with hundreds of entries. Multi-token names, or keys of five or more
 * characters, keep phonetic matching (the Mohammed/Muhammad family).
 */
export function informativePhonetic(raw: string): boolean {
  const tokens = nameTokens(raw);
  if (tokens.length >= 2) return true;
  return phoneticKey(tokens[0] ?? "").length >= 5;
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
  entry: WatchlistName,
  weightOf: (token: string) => number = (t) => t.length
): { score: number; signals: NameMatchSignals } {
  const a = normalizeName(input.name);
  const b = normalizeName(candidateName);

  const similarity = stringSimilarity(a, b, weightOf);
  const tokenOverlap = weightedOverlap(input.name, candidateName, weightOf);
  const phonetic = a.length > 0 && informativePhonetic(input.name) && phoneticNameKey(input.name) === phoneticNameKey(candidateName);

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
  const weightOf = tokenWeights(watchlist);

  for (const entry of watchlist) {
    // Every published spelling is a separate chance to match; the best wins.
    const names = [entry.primaryName, ...(entry.aliases ?? [])].filter(Boolean);
    let best: { score: number; signals: NameMatchSignals } | null = null;
    for (const name of names) {
      const scored = scoreAgainstName(input, name, entry, weightOf);
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
