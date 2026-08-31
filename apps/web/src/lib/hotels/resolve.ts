import { haversineMeters, jaroWinkler, normalizeName } from "./h3";

// ---------------------------------------------------------------------------
// Resolving a curated luxury property to the place Google actually holds.
//
// THE PROBLEM THIS SOLVES. The curated CSV carries a name, a country, a city
// and a coordinate. The coordinate is an APPROXIMATION - measured across the
// 507-row set, 22 rows are precise to ~11km, 161 to ~1.1km, 296 to ~110m and
// only 28 to ~11m. Aman Venice sat 410m from the palazzo it occupies; "The
// Berkeley" and "The Peninsula London" sat 69m apart when the real buildings
// are several hundred metres apart. Drawn straight onto a map those pins are in
// the wrong street, and a pin in the wrong street is a false statement.
//
// WHY THE OBVIOUS APPROACH IS WRONG. Google Text Search ALWAYS answers. Asked
// for the invented "Zzqx Grand Palace Hotel Atlantis" it confidently returns
// Atlantis - The Palm in Dubai. Taking the top hit and writing its coordinate
// would silently relocate every property Google cannot find to whatever it
// returned instead - fabrication dressed as verification. Everything below
// exists to make that outcome impossible.
//
// THE APPROACH: HARD GATES, THEN WEIGHTED EVIDENCE.
//
//   Gates are disqualifying and absolute. A candidate in the wrong country is
//   not a weak match, it is a different building; no amount of name similarity
//   may rescue it. That single gate is what turns the Atlantis case from a
//   silent corruption into a clean "unresolved".
//
//   Evidence is graded. Past the gates, several independent signals are
//   combined, and only the top verdict is allowed to MOVE A PIN. This mirrors
//   the discipline in match.ts, where only a HIGH match may drive a price: here
//   only a CONFIRMED match may drive a coordinate. Everything weaker keeps the
//   curated coordinate and is labelled approximate, because a pin that admits
//   it is roughly placed is honest, and one that quietly moved to the wrong
//   building is not.
//
// THE STRONGEST SIGNAL IS NOT THE NAME. It is the website domain. Google
// returns "Wilderness Mombo" for the CSV's "Mombo Camp" - the property was
// renamed, and name similarity alone reads as a mismatch. Both cite
// wildernessdestinations.com. An operator publishing the same domain is
// near-conclusive evidence of identity in a way no string metric is.
// ---------------------------------------------------------------------------

/** How far a coordinate could be off purely from the decimals it was written
 *  with. Independent of whether the value itself is any good. */
export function roundingHalfSpanMeters(latText: string, lngText: string): number {
  const decimals = (s: string) => {
    const frac = String(s).trim().split(".")[1];
    return frac ? frac.replace(/0+$/, "").length : 0;
  };
  // Longitude degrees shrink toward the poles; latitude degrees do not. Using
  // the latitude figure for both is the conservative choice - it never
  // understates the error.
  const worst = Math.min(decimals(latText), decimals(lngText));
  const degrees = 0.5 * Math.pow(10, -worst);
  return degrees * 111_320;
}

/**
 * How far from the curated coordinate we are willing to look, and how far a
 * candidate may sit and still be believed.
 *
 * WHY IT SCALES WITH THE WRITTEN PRECISION. A coordinate given to one decimal
 * place cannot be held to a 500m standard - the notation itself admits ~5.6km
 * of slack, so a strict radius would reject the correct building for being
 * exactly as far away as the notation said it might be. A coordinate given to
 * four decimals claims ~5.6m, and holding it to kilometres would let a
 * neighbouring hotel pass.
 *
 * The additive floor covers the part rounding does not: these coordinates were
 * compiled rather than surveyed, and the measured error runs to a few hundred
 * metres even at three decimals.
 */
export function toleranceMeters(
  latText: string,
  lngText: string
): { search: number; accept: number } {
  const rounding = roundingHalfSpanMeters(latText, lngText);
  const accept = Math.min(20_000, Math.max(1_200, rounding * 2 + 800));
  return {
    // Google caps location bias at 50km.
    search: Math.min(50_000, accept * 1.5),
    accept,
  };
}

/**
 * The registrable domain of a URL - "aman.com" from any Aman page.
 *
 * Deliberately naive about multi-part suffixes, and correct for the shape that
 * matters. Comparing the last labels folds www, language prefixes, booking
 * subdomains and tracking paths, which is the whole job. For a co.uk-style
 * suffix the retained labels are the same public suffix for both sides, so the
 * comparison degrades to "same suffix" - which is why a domain match is scored
 * as evidence alongside the other signals rather than accepted alone.
 */
export function registrableDomain(url: string | undefined): string | null {
  if (!url) return null;
  let host: string;
  try {
    host = new URL(url.includes("://") ? url : `https://${url}`).hostname.toLowerCase();
  } catch {
    return null;
  }
  const labels = host.replace(/^www\./, "").split(".").filter(Boolean);
  if (labels.length < 2) return null;
  // Second-level suffixes that need a third label to mean anything. Keeping
  // three labels for these is what stops every co.uk site matching every other.
  const TWO_PART = new Set(["co", "com", "net", "org", "gov", "edu", "ac"]);
  const take = labels.length >= 3 && TWO_PART.has(labels[labels.length - 2]) ? 3 : 2;
  return labels.slice(-take).join(".");
}

/**
 * ICU spells a handful of countries differently from common usage. Each entry
 * is a name ICU renders another way, not a guess about which country somebody
 * meant.
 */
const ICU_SPELLING_ALIASES: Record<string, string> = {
  "czech republic": "Czechia",
  turkey: "Türkiye",
  macau: "Macao SAR China",
  "hong kong": "Hong Kong SAR China",
  "turks and caicos islands": "Turks & Caicos Islands",
  "saint kitts and nevis": "St. Kitts & Nevis",
};

function foldCountry(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\bst\b/g, "saint")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A retired or aliased region code mapped to the one currently in use.
 *
 * ICU knows names for WITHDRAWN codes. Sweeping every two-letter pair and
 * indexing by name maps "Vietnam" to VD - North Vietnam, withdrawn in 1977 -
 * because it sorts before VN. maximize() canonicalises a retired code to its
 * successor (VD to VN, ZR to CD, AN to CW), so every code passes through here
 * before it is compared. Both sides go through the same funnel, which is what
 * makes a match a match on codes that still exist.
 */
export function canonicalCountryCode(code: string | undefined): string | null {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return null;
  try {
    return new Intl.Locale(`und-${code.toUpperCase()}`).maximize().region ?? code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

let countryIndex: Map<string, string> | null = null;

/** Name to code, from the runtime's own ICU tables rather than a written list. */
function buildCountryIndex(): Map<string, string> {
  const index = new Map<string, string>();
  const display = new Intl.DisplayNames(["en"], { type: "region", style: "long" });
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b);
      let name: string | undefined;
      try {
        name = display.of(code);
      } catch {
        continue;
      }
      // An unassigned code echoes itself back rather than throwing.
      if (!name || name === code) continue;
      const canonical = canonicalCountryCode(code);
      if (!canonical) continue;
      const folded = foldCountry(name);
      for (const key of [folded, folded.replace(/\band\b/g, "&"), folded.replace(/&/g, "and")]) {
        if (!index.has(key)) index.set(key, canonical);
      }
    }
  }
  return index;
}

/** ISO 3166-1 alpha-2 for a country name, or null when it is not a country. */
export function countryCodeFromName(name: string): string | null {
  if (!name?.trim()) return null;
  countryIndex ??= buildCountryIndex();
  const folded = foldCountry(name);
  const direct = countryIndex.get(folded);
  if (direct) return direct;
  const alias = ICU_SPELLING_ALIASES[folded];
  return alias ? (countryIndex.get(foldCountry(alias)) ?? null) : null;
}

/**
 * Google place types that mean "somewhere you sleep".
 *
 * Deliberately WIDER than the "hotel" type the detail lookup uses. The curated
 * set is full of properties Google does not type as hotels: Wilderness Mombo is
 * `lodging`, Gora Kadan is `japanese_inn`, and a private island or a chateau
 * can come back as either. Gating on `hotel` alone silently dropped exactly the
 * properties that make this a LUXURY map rather than a chain-hotel map.
 */
export const LODGING_TYPES = new Set([
  "hotel",
  "resort_hotel",
  "lodging",
  "motel",
  "inn",
  "japanese_inn",
  "guest_house",
  "bed_and_breakfast",
  "cottage",
  "campground",
  "camping_cabin",
  "rv_park",
  "extended_stay_hotel",
  "budget_japanese_inn",
  "farmstay",
  "hostel",
  "private_guest_room",
  "childrens_camp",
]);

export function isLodging(types: readonly string[] | undefined): boolean {
  return (types ?? []).some((t) => LODGING_TYPES.has(t));
}

/** The curated row, as far as resolution cares about it. */
export interface CuratedSubject {
  name: string;
  /** Text, not a number: the decimals carry the precision claim. */
  latitudeText: string;
  longitudeText: string;
  country: string;
  city?: string;
  brand?: string;
  website?: string;
}

/** One Google Places candidate, reduced to the fields that decide identity. */
export interface PlaceCandidate {
  placeId: string;
  name: string;
  latitude: number;
  longitude: number;
  /** ISO 3166-1 alpha-2 from addressComponents. */
  countryCode?: string;
  formattedAddress?: string;
  types?: string[];
  primaryType?: string;
  websiteUri?: string;
  businessStatus?: string;
}

/**
 * Token containment, length-penalised.
 *
 * WHY JARO-WINKLER IS NOT ENOUGH ON ITS OWN. Google frequently holds a property
 * under a longer or shorter name than the curated one: "Sofitel Legend Old
 * Cataract Aswan" is listed as "Old Cataract, Aswan", and "The Gritti Palace"
 * as "The Gritti Palace, a Luxury Collection Hotel, Venice". Both are the same
 * building; Jaro-Winkler scores them 0.700 and 0.868 because it reads
 * characters in sequence and a missing prefix costs it dearly.
 *
 * Containment reads WORDS instead. Every token of the shorter name appearing in
 * the longer is strong evidence of identity - but only when the longer name
 * does not bury it in additions, so the score is scaled down by how much longer
 * that name is. Pure containment would rate "Mombo Camp" against "Little Mombo
 * Camp" a perfect 1.0, and those are two genuinely different camps.
 */
export function tokenContainment(a: string, b: string): number {
  const tokens = (s: string) =>
    new Set(normalizeName(s).split(" ").filter((t) => t.length > 1));
  const ta = tokens(a);
  const tb = tokens(b);
  // A single token carries too little signal: "Peninsula" is contained in every
  // Peninsula on earth, and the distance gate is not always tight enough to
  // separate them.
  if (ta.size < 2 || tb.size < 2) return 0;

  const [shorter, longer] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  const shared = [...shorter].filter((t) => longer.has(t)).length;
  return (shared / shorter.size) * Math.sqrt(shorter.size / longer.size);
}

export type ResolutionVerdict = "confirmed" | "probable" | "rejected";

export interface CandidateAssessment {
  verdict: ResolutionVerdict;
  /** 0-1, for ranking candidates against each other. Never displayed. */
  score: number;
  distanceMeters: number;
  /** How far this candidate was allowed to sit, given how strong the
   *  non-spatial evidence was. Recorded so a large correction is auditable. */
  distanceCeilingMeters: number;
  nameSimilarity: number;
  /** max(Jaro-Winkler, token containment) - the figure decisions are made on. */
  nameEvidence: number;
  domainMatch: boolean;
  /** False when the matching domain is an operator domain shared by many
   *  curated properties, which identifies a chain rather than a building. */
  domainExclusive: boolean;
  cityMatch: boolean;
  brandMatch: boolean;
  countryMatch: boolean;
  lodging: boolean;
  operational: boolean;
  /** Why a candidate was thrown out. Empty when it was not. */
  gateFailures: string[];
}

/** Name evidence at or above this stands on its own. */
const STRONG_NAME = 0.9;
/** With corroboration from the city, the brand or the domain, this is enough. */
const CORROBORATED_NAME = 0.75;
/** Below this the strings are not evidence of anything. */
const FLOOR_NAME = 0.68;
/**
 * The outer bound on a conclusively-evidenced correction.
 *
 * Not a claim that 150km is a plausible error - it is the point past which an
 * exact name in the right country is more likely to be a second property than a
 * badly-placed first one. Corrections anywhere near it are rare and every one
 * is written to the audit CSV with the distance it moved.
 */
const CONCLUSIVE_CEILING_M = 150_000;

/**
 * How far a candidate may sit from the curated coordinate, given how strong the
 * evidence of identity is.
 *
 * WHY DISTANCE IS NOT A FIXED GATE. A fixed ceiling gets both ends wrong at
 * once, and both failures were measured on the real data:
 *
 *   TOO STRICT. Kasbah Tamadot is written at two decimal places, which buys a
 *   ~5.7km ceiling. Google holds it 11.5km away under an IDENTICAL name, an
 *   identical operator domain, in the right country, typed as a hotel, with no
 *   competing candidate. Rejecting that is rejecting the correction the whole
 *   exercise exists to make - the curated coordinate was simply wrong.
 *
 *   TOO LOOSE. Widen the ceiling for everyone and a weakly-named candidate 15km
 *   away starts winning, which is how a pin ends up on a different hotel.
 *
 * So the ceiling is bought with evidence. At the floor it is the plain
 * tolerance; at a perfect name it opens to 25x, and never past 50km - a
 * property is not fifty kilometres from its own approximate coordinate, and a
 * match that far out is a different building however well the name reads.
 */
export function distanceCeilingMeters(
  identity: number,
  acceptMeters: number,
  /**
   * True when the name is exact AND the operator's own domain agrees AND the
   * country agrees. Only then does the absolute cap lift.
   *
   * WHY THERE IS A SECOND CAP AT ALL. Amanpulo's curated coordinate is ~76km
   * from the island it stands on - the compiler of the CSV put it in the wrong
   * part of Palawan. Google holds it under an identical name, on aman.com, in
   * the Philippines, with nothing else competing. Refusing that correction
   * because 76km "looks like too far" would keep a pin in open sea to satisfy a
   * number chosen for convenience. Every correction this large is written to
   * the audit CSV with its ceiling, so none of them passes unseen.
   */
  conclusive = false
): number {
  // Conclusive evidence does not scale with the curated coordinate at all. An
  // exact name on the operator's own domain in the right country identifies the
  // building outright, and the curated coordinate contributes nothing further -
  // so the ceiling stops being a multiple of it and becomes a flat outer bound.
  // Without this the multiplier stayed binding: Amanpulo is written to four
  // decimals, which buys 1.2km of tolerance and 30km of ceiling, and the island
  // is 76km away.
  if (conclusive) return CONCLUSIVE_CEILING_M;
  const earned = Math.max(0, Math.min(1, (identity - CORROBORATED_NAME) / (1 - CORROBORATED_NAME)));
  return Math.min(50_000, acceptMeters * (1 + 24 * earned));
}

/**
 * Judge one candidate against one curated row.
 *
 * `domainCorpusCount` is how many curated rows publish the candidate's domain.
 * It is what separates a property domain from an operator domain: aman.com and
 * wildernessdestinations.com appear on dozens of rows and say only "same
 * group", while a domain unique to one row is that property's own. Passing 1
 * (the default) treats every domain as exclusive, which is the right behaviour
 * for a caller matching a single property with no corpus to count against.
 */
export function assessCandidate(
  subject: CuratedSubject,
  candidate: PlaceCandidate,
  domainCorpusCount = 1
): CandidateAssessment {
  const tol = toleranceMeters(subject.latitudeText, subject.longitudeText);
  const distanceMeters = haversineMeters(
    Number(subject.latitudeText),
    Number(subject.longitudeText),
    candidate.latitude,
    candidate.longitude
  );

  const expected = countryCodeFromName(subject.country);
  const actual = canonicalCountryCode(candidate.countryCode);
  // Unknown on either side is not a mismatch. A country we cannot name and a
  // response missing addressComponents both mean "no evidence", and treating
  // absence as contradiction would reject correct matches over a missing field.
  const countryMatch = !expected || !actual || expected === actual;

  const lodging =
    isLodging(candidate.types) ||
    (candidate.primaryType ? LODGING_TYPES.has(candidate.primaryType) : false);

  // CLOSED_TEMPORARILY IS NOT DISQUALIFYING. It is a statement about trading,
  // not about geography - the building has not moved. Google reports the Burj
  // Al Arab that way; gating on it discarded an exact name, on jumeirah.com, 5m
  // from the curated coordinate, and left the most recognisable hotel on the
  // map unplaced. Only CLOSED_PERMANENTLY is treated as disqualifying, because
  // a permanently closed listing is as likely to be a stale record of something
  // that is now a different business.
  const operational = (candidate.businessStatus ?? "OPERATIONAL") !== "CLOSED_PERMANENTLY";

  const subjectDomain = registrableDomain(subject.website);
  const candidateDomain = registrableDomain(candidate.websiteUri);
  const domainMatch = Boolean(subjectDomain && candidateDomain && subjectDomain === candidateDomain);
  const domainExclusive = domainMatch && domainCorpusCount <= 1;

  const nameSimilarity = jaroWinkler(normalizeName(subject.name), normalizeName(candidate.name));
  const nameEvidence = Math.max(nameSimilarity, tokenContainment(subject.name, candidate.name));

  const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const address = fold(candidate.formattedAddress ?? "");
  const cityMatch = Boolean(
    subject.city && subject.city.length >= 3 && address.includes(fold(subject.city))
  );
  const brandMatch = Boolean(
    subject.brand && subject.brand.length >= 3 && fold(candidate.name).includes(fold(subject.brand))
  );

  // Identity: what we know about this candidate WITHOUT looking at where it is.
  // Kept separate from the score on purpose - it is what buys the distance
  // ceiling, and letting proximity feed back into it would be circular.
  const identity = Math.min(
    1,
    nameEvidence +
      (domainExclusive ? 0.25 : domainMatch ? 0.05 : 0) +
      (brandMatch ? 0.03 : 0)
  );
  const conclusive =
    nameEvidence >= STRONG_NAME && domainMatch && Boolean(expected) && Boolean(actual) && countryMatch;
  const ceiling = distanceCeilingMeters(identity, tol.accept, conclusive);

  /**
   * The type gate is evidence, not law.
   *
   * It exists to stop a hotel row matching the airport or the restaurant next
   * door, and for that it is worth having. But Google types Necker Island as
   * `island` and Akelarre as `fine_dining_restaurant` - both are the places the
   * curated rows mean, and both were being discarded by a gate that was meant
   * to break weak ties, not to overrule conclusive evidence.
   *
   * So it is waived on conclusive identity: an exact name together with a
   * domain unique to this row settles what the building is, and Google's
   * opinion about its category adds nothing - Clinique La Prairie is typed
   * `medical_clinic` and is exactly the medical wellness resort the curated row
   * describes. Short of that pairing, the waiver also needs the candidate to be
   * CLOSE - inside the plain tolerance, not the widened ceiling.
   *
   * Both routes stay narrow. Viña VIK is an exact name on a winery, but 21km
   * away and on no shared domain, and stays rejected.
   */
  const typeWaived =
    !lodging &&
    ((nameEvidence >= STRONG_NAME && domainExclusive) ||
      (distanceMeters <= tol.accept && (nameEvidence >= STRONG_NAME || domainExclusive)));

  const gateFailures: string[] = [];
  if (!countryMatch) gateFailures.push(`country ${actual ?? "?"} != ${expected ?? "?"}`);
  if (!lodging && !typeWaived) gateFailures.push(`not lodging (${candidate.primaryType ?? "unknown"})`);
  if (distanceMeters > ceiling) {
    gateFailures.push(`${Math.round(distanceMeters)}m > ceiling ${Math.round(ceiling)}m`);
  }
  if (!operational) gateFailures.push(`businessStatus ${candidate.businessStatus}`);

  const proximity = Math.max(0, 1 - distanceMeters / Math.max(1, ceiling));
  const score = Math.min(
    1,
    0.46 * nameEvidence +
      0.24 * (domainExclusive ? 1 : domainMatch ? 0.3 : 0) +
      0.18 * proximity +
      0.06 * (cityMatch ? 1 : 0) +
      0.06 * (brandMatch ? 1 : 0)
  );

  const base = {
    score,
    distanceMeters,
    distanceCeilingMeters: ceiling,
    nameSimilarity,
    nameEvidence,
    domainMatch,
    domainExclusive,
    cityMatch,
    brandMatch,
    countryMatch,
    lodging,
    operational,
  };

  if (gateFailures.length) {
    return { verdict: "rejected", ...base, gateFailures };
  }

  // Corroboration is anything independent of the name that points at the same
  // building. A SHARED operator domain deliberately does not count: it is true
  // of every property in the group and would corroborate all of them equally.
  const corroborated = cityMatch || brandMatch || domainExclusive;
  // A domain unique to this row, on a candidate inside the plain tolerance, is
  // the operator identifying its own property - and it outranks the name, which
  // is the half of the record that goes stale. SHA Wellness Clinic now trades
  // as "SHA Spain" and Airelles Courchevel as "Les Airelles"; both score below
  // the name floor and both are unmistakably right.
  const ownDomainNearby = domainExclusive && distanceMeters <= tol.accept;
  const verdict: ResolutionVerdict =
    nameEvidence >= STRONG_NAME || ownDomainNearby || (domainExclusive && nameEvidence >= FLOOR_NAME)
      ? "confirmed"
      : nameEvidence >= CORROBORATED_NAME && corroborated && distanceMeters <= tol.accept
        ? "confirmed"
        : nameEvidence >= FLOOR_NAME
          ? "probable"
          : "rejected";

  return { verdict, ...base, gateFailures: [] };
}

export type AssessedCandidate = CandidateAssessment & { candidate: PlaceCandidate };

export interface Resolution {
  best: AssessedCandidate | null;
  /** Every candidate considered, best first. Kept so a run is auditable. */
  considered: AssessedCandidate[];
  /**
   * True when a rival candidate scored close enough that we cannot say which
   * building is meant. A best match is downgraded to `probable` when set, so
   * an ambiguous result never moves a pin.
   */
  ambiguous: boolean;
  /** The rival that caused it, for the audit trail. */
  runnerUpName?: string;
}

/** A rival within this of the winner's score is not distinguishable from it. */
const AMBIGUITY_MARGIN = 0.08;
/**
 * Rivals closer together than this are the same building described twice - an
 * entrance and a centroid, a hotel and its own restaurant listing - so they are
 * not in competition. MERGE_DISTANCE_M in h3.ts is set from the same measured
 * spread of source disagreement; a little wider here because the two records
 * come from one provider rather than two.
 */
const SAME_BUILDING_M = 100;
/**
 * How far ahead an exact name must be before it settles the question.
 *
 * An epsilon, not a margin. The question is only whether the curated name
 * picked ONE of the candidates out, and an exact match that beats its rival at
 * all has done that: "Four Seasons Hotel Tokyo At Marunouchi" scores 1.000
 * against the Otemachi hotel's 0.951, which is decisive even though the two
 * names differ in a single token. A larger threshold read that 0.049 gap as a
 * tie and refused a correct 295m correction.
 *
 * A genuine tie still reads as one: "Royal Malewane" and "Malewane Lodge at
 * Royal Malewane" both score 1.000, and there the names really do not separate
 * the two properties.
 */
const NAME_LEAD = 0.01;

/**
 * Pick the best candidate Google returned.
 *
 * WHY NOT JUST THE FIRST. Asked for "Mombo Camp, Okavango Delta, Botswana",
 * Google's first result is "Little Mombo Camp" and its second is "Wilderness
 * Mombo". Rank order is relevance to a search string, not identity, so every
 * candidate is assessed and the winner is the best-scoring one past the gates.
 *
 * WHY A WINNER IS NOT ALWAYS ENOUGH. Those two Mombo camps are 250m apart, run
 * by the same operator, publishing the same domain, and one of them is the
 * curated "Mombo Camp" under a rename. Nothing in the data distinguishes them,
 * and picking the higher score would be a coin toss dressed as a verification.
 * When the runner-up is that close the result is reported as AMBIGUOUS, the
 * verdict drops to `probable`, and the curated coordinate stands. Declining to
 * answer is the correct answer when the evidence does not decide.
 */
export function resolveBestCandidate(
  subject: CuratedSubject,
  candidates: readonly PlaceCandidate[],
  domainCorpusCount = 1
): Resolution {
  const considered: AssessedCandidate[] = candidates
    .map((candidate) => ({
      ...assessCandidate(subject, candidate, domainCorpusCount),
      candidate,
    }))
    .sort((a, b) => b.score - a.score);

  const rank: Record<ResolutionVerdict, number> = { confirmed: 2, probable: 1, rejected: 0 };
  const best = considered
    .filter((c) => c.verdict !== "rejected")
    .reduce<AssessedCandidate | null>((acc, cur) => {
      if (!acc) return cur;
      if (rank[cur.verdict] !== rank[acc.verdict]) {
        return rank[cur.verdict] > rank[acc.verdict] ? cur : acc;
      }
      return cur.score > acc.score ? cur : acc;
    }, null);

  if (!best) return { best: null, considered, ambiguous: false };

  // Rivals are judged among everything that PASSED THE GATES, not just what
  // scored well. A sibling property whose name scores badly is precisely the
  // candidate that matters here: it is real, it is in the right place, and its
  // low name score is the thing in question.
  const subjectDomain = registrableDomain(subject.website);
  const nameIsExact = best.nameEvidence >= STRONG_NAME;

  const rival = considered.find((c) => {
    if (c.candidate.placeId === best.candidate.placeId) return false;
    if (c.gateFailures.length) return false;
    const apart = haversineMeters(
      best.candidate.latitude,
      best.candidate.longitude,
      c.candidate.latitude,
      c.candidate.longitude
    );
    // Two records of one building - an entrance and a centroid, a hotel and its
    // own restaurant listing - are not in competition.
    if (apart <= SAME_BUILDING_M) return false;

    // Two candidates we cannot rank apart on the evidence.
    //
    // An exact name that clearly beats the rival's is not one of them, and
    // saying otherwise cost real corrections: "Mandarin Oriental, Hong Kong"
    // 59m away was called ambiguous against "Mandarin Oriental The Landmark,
    // Hong Kong", and "Four Seasons Hotel Tokyo At Marunouchi" against the
    // Otemachi one. Those are different hotels with similar names, and the
    // curated row names one of them exactly. Score alone reads them as close
    // because proximity and a shared brand domain lift both.
    if (best.score - c.score <= AMBIGUITY_MARGIN) {
      const decided = nameIsExact && best.nameEvidence - c.nameEvidence >= NAME_LEAD;
      if (!decided) return true;
    }

    // The sibling-property case. Mombo Camp resolves to "Little Mombo Camp"
    // only because the curated name is CONTAINED in it; 250m away sits
    // "Wilderness Mombo", the same camp under its new name, publishing the same
    // operator domain. Nothing in the data says which one the row meant. So
    // when the winner's name is merely contained rather than exact, and another
    // property of the same group is standing right next to it, the question is
    // open - and an open question must not move a pin.
    return (
      !nameIsExact &&
      Boolean(subjectDomain) &&
      registrableDomain(c.candidate.websiteUri) === subjectDomain
    );
  });

  if (!rival) return { best, considered, ambiguous: false };

  return {
    best: { ...best, verdict: best.verdict === "confirmed" ? "probable" : best.verdict },
    considered,
    ambiguous: true,
    runnerUpName: rival.candidate.name,
  };
}
