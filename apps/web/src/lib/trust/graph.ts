import type { ObservedReason } from "./reasons";

// ---------------------------------------------------------------------------
// The entity graph.
//
// WHY A GRAPH AND NOT MORE RULES. A per-account rule engine can only ever ask
// "is this account behaving badly?". The expensive frauds are not one account
// behaving badly — they are thirty accounts each behaving unremarkably while
// sharing four devices, six instruments and one address. Every individual
// account passes. The STRUCTURE is the signal, and structure is invisible to a
// row-at-a-time evaluator.
//
// WHAT THIS MODULE IS. Pure graph analysis over a supplied edge set. It holds
// no database, makes no queries and has no I/O, so it can run over an
// in-memory fixture in a test, a Postgres recursive CTE in production, or a
// dedicated graph store later, without any of them leaking in here.
//
// THE MISTAKE THIS IS BUILT TO AVOID. Shared attributes are NOT evidence of
// fraud by default. A family shares a tablet. A household shares an address.
// A university shares an IP. A refurbished handset carries a device id to a
// stranger. Corporate NAT puts a thousand people behind one address. So:
//
//   - every entity type carries its OWN sharing threshold, because "two
//     accounts on one device" and "two accounts on one IP" are not remotely
//     the same claim;
//   - IP is deliberately the weakest link type and cannot, alone, produce a
//     high-severity reason;
//   - distance is preserved, because sharing a device with a fraudster is not
//     the same as sharing an IP with someone who shares a device with one.
//
// Getting these thresholds wrong does not produce a slightly worse system. It
// produces a system that blocks families, students and everyone behind a
// corporate NAT, which is both a fraud failure and a fairness failure.
// ---------------------------------------------------------------------------

export type EntityType =
  | "account"
  | "identity"
  | "device"
  | "phone"
  | "email"
  | "address"
  | "ip"
  | "asn"
  | "card"
  | "bank_account"
  | "wallet"
  | "beneficiary"
  | "merchant";

export interface EntityId {
  readonly type: EntityType;
  /** Stable identifier. For anything sensitive this MUST already be a hash or
   *  a token — the graph never holds a PAN, an account number or a raw email. */
  readonly id: string;
}

export function entityKey(entity: EntityId): string {
  return `${entity.type}:${entity.id}`;
}

/** Why we believe two entities are connected. */
export type EdgeKind =
  | "used" // account used device / ip / instrument
  | "owns" // identity owns phone / email / address
  | "paid_to" // account paid beneficiary / merchant
  | "shares_with"; // derived link, produced by analysis

export interface Edge {
  readonly from: EntityId;
  readonly to: EntityId;
  readonly kind: EdgeKind;
  readonly firstSeen: string;
  readonly lastSeen: string;
  /** How many times observed. One shared session is not a relationship. */
  readonly observations: number;
}

/** Outcome attached to an entity. The only labels that may drive severity. */
export type EntityLabel =
  /** Investigated and CONFIRMED fraudulent. The only label strong enough to
   *  justify a high-severity graph reason on its own. */
  | "confirmed_fraud"
  /** Declined by an automated control. NOT proof — it may be a false positive,
   *  and treating it as proof is how one false positive becomes a hundred. */
  | "auto_declined"
  /** Produced a fraud-coded chargeback. */
  | "chargeback"
  /** Reviewed by a human and cleared. Actively lowers risk. */
  | "cleared";

export interface LabelledEntity {
  readonly entity: EntityId;
  readonly label: EntityLabel;
  readonly at: string;
}

/**
 * How many accounts may legitimately share an entity of each type before the
 * sharing itself becomes evidence.
 *
 * These are POLICY, not measurements, and each one encodes a real-world
 * explanation for benign sharing. They are the numbers to retune first once
 * outcome data exists.
 */
export const SHARING_THRESHOLDS: Record<EntityType, number> = {
  // A household device might serve 4-5 people. Beyond that it is a farm or a
  // resold handset, and both deserve a look.
  device: 5,
  // A phone number is meant to be personal. Two accounts is a couple; eight is
  // an account farm.
  phone: 2,
  email: 2,
  // A family, a shared flat, a small office all share an address legitimately.
  address: 6,
  // The weakest of all. Corporate NAT, campus wifi, CGNAT and mobile carriers
  // put thousands of unrelated people behind one address. A high number here
  // means almost nothing on its own.
  ip: 50,
  // An ASN is an entire network operator. Effectively never evidence.
  asn: 100_000,
  // One card belonging to several identities is the classic stolen-card or
  // farming shape, and has few benign explanations.
  card: 2,
  bank_account: 2,
  wallet: 3,
  // Many people legitimately pay one merchant or one beneficiary.
  merchant: 100_000,
  beneficiary: 25,
  identity: 3,
  account: 1,
};

// ── Index ──────────────────────────────────────────────────────────────────

/**
 * An adjacency index over an edge set.
 *
 * Built once per query rather than maintained globally: the caller supplies
 * the neighbourhood it fetched, which keeps this module free of any assumption
 * about how much of the graph fits in memory.
 */
export class GraphIndex {
  private readonly adjacency = new Map<string, Set<string>>();
  private readonly entities = new Map<string, EntityId>();
  private readonly labels = new Map<string, EntityLabel[]>();
  private readonly edges: Edge[] = [];

  constructor(edges: readonly Edge[], labelled: readonly LabelledEntity[] = []) {
    for (const edge of edges) this.addEdge(edge);
    for (const l of labelled) {
      const key = entityKey(l.entity);
      this.entities.set(key, l.entity);
      const existing = this.labels.get(key);
      if (existing) existing.push(l.label);
      else this.labels.set(key, [l.label]);
    }
  }

  private addEdge(edge: Edge): void {
    this.edges.push(edge);
    const a = entityKey(edge.from);
    const b = entityKey(edge.to);
    this.entities.set(a, edge.from);
    this.entities.set(b, edge.to);
    // Undirected for reachability. Fraud rings do not respect edge direction:
    // "device used by account" and "account used device" are the same fact.
    (this.adjacency.get(a) ?? this.adjacency.set(a, new Set()).get(a)!).add(b);
    (this.adjacency.get(b) ?? this.adjacency.set(b, new Set()).get(b)!).add(a);
  }

  neighbours(entity: EntityId): readonly EntityId[] {
    const keys = this.adjacency.get(entityKey(entity)) ?? new Set<string>();
    return [...keys].map((k) => this.entities.get(k)!).filter(Boolean);
  }

  labelsOf(entity: EntityId): readonly EntityLabel[] {
    return this.labels.get(entityKey(entity)) ?? [];
  }

  allEntities(): readonly EntityId[] {
    return [...this.entities.values()];
  }

  allEdges(): readonly Edge[] {
    return this.edges;
  }

  /** Accounts directly attached to an entity — the sharing count. */
  accountsOn(entity: EntityId): readonly EntityId[] {
    return this.neighbours(entity).filter((n) => n.type === "account");
  }
}

// ── Traversal ──────────────────────────────────────────────────────────────

export interface ReachedEntity {
  readonly entity: EntityId;
  /** Hops from the origin. 1 = directly linked. */
  readonly distance: number;
  /**
   * The INTERMEDIATE entity types the path ran through — neither the origin
   * nor the reached entity.
   *
   * Empty for a direct link. This is what makes link quality assessable: a
   * path with `["card"]` is a shared payment instrument, a path with `["ip"]`
   * is two strangers behind one NAT, and they are not the same evidence.
   * An earlier version included the origin's own type here, which made every
   * path look like it ran through an "account" and broke the weak-link test.
   */
  readonly via: readonly EntityType[];
}

/**
 * Breadth-first neighbourhood, bounded by hops.
 *
 * `maxDepth` defaults to 2 because the third hop is where a graph stops being
 * evidence: at depth 3 through an IP, half the internet is "connected" to
 * everyone. Bounding it is not a performance concession, it is the difference
 * between a signal and a coincidence.
 */
export function neighbourhood(
  index: GraphIndex,
  origin: EntityId,
  maxDepth = 2
): readonly ReachedEntity[] {
  const seen = new Set<string>([entityKey(origin)]);
  const out: ReachedEntity[] = [];
  let frontier: ReachedEntity[] = [{ entity: origin, distance: 0, via: [] }];

  for (let depth = 1; depth <= maxDepth; depth++) {
    const next: ReachedEntity[] = [];
    for (const current of frontier) {
      for (const neighbour of index.neighbours(current.entity)) {
        const key = entityKey(neighbour);
        if (seen.has(key)) continue;
        seen.add(key);
        const reached: ReachedEntity = {
          entity: neighbour,
          distance: depth,
          // The origin contributes nothing; every hop after it contributes the
          // entity it passed through.
          via: depth === 1 ? [] : [...current.via, current.entity.type],
        };
        out.push(reached);
        next.push(reached);
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }
  return out;
}

// ── Findings ───────────────────────────────────────────────────────────────

export interface SharingFinding {
  readonly entity: EntityId;
  readonly accountCount: number;
  readonly threshold: number;
  /** How far past the threshold, as a multiple. 1.0 = exactly at it. */
  readonly excessRatio: number;
}

/** Entities shared by more accounts than their type plausibly allows. */
export function excessiveSharing(
  index: GraphIndex,
  origin: EntityId,
  maxDepth = 1
): readonly SharingFinding[] {
  const candidates = [origin, ...neighbourhood(index, origin, maxDepth).map((r) => r.entity)];
  const findings: SharingFinding[] = [];

  for (const entity of candidates) {
    if (entity.type === "account") continue;
    const threshold = SHARING_THRESHOLDS[entity.type];
    const count = index.accountsOn(entity).length;
    if (count > threshold) {
      findings.push({
        entity,
        accountCount: count,
        threshold,
        excessRatio: Number((count / threshold).toFixed(2)),
      });
    }
  }
  return findings.sort((a, b) => b.excessRatio - a.excessRatio);
}

export interface FraudProximity {
  readonly entity: EntityId;
  readonly label: EntityLabel;
  readonly distance: number;
  /** The link types on the path — an IP path is far weaker than a card path. */
  readonly via: readonly EntityType[];
}

/**
 * Labelled entities within the neighbourhood.
 *
 * Returns the label and the DISTANCE rather than a boolean, because "shares a
 * card with a confirmed fraudster" and "shares an IP with someone who shares a
 * device with one" are different claims and must not collapse into one flag.
 */
export function fraudProximity(
  index: GraphIndex,
  origin: EntityId,
  maxDepth = 2
): readonly FraudProximity[] {
  const found: FraudProximity[] = [];
  for (const reached of neighbourhood(index, origin, maxDepth)) {
    for (const label of index.labelsOf(reached.entity)) {
      found.push({ entity: reached.entity, label, distance: reached.distance, via: reached.via });
    }
  }
  return found.sort((a, b) => a.distance - b.distance);
}

export interface ComponentStats {
  readonly size: number;
  readonly accountCount: number;
  readonly sharedEntityCount: number;
  /**
   * Accounts per distinct shared entity.
   *
   * The ring signature. Normal customers produce a low ratio — each has their
   * own phone, device and card. A farm produces a high one: many accounts
   * funnelled through few resources, because resources cost money and
   * identities are cheap.
   */
  readonly density: number;
}

/**
 * Structural statistics for the bounded neighbourhood around `origin`.
 *
 * NOT a full connected component, and deliberately so: an unbounded traversal
 * is unbounded work, and on a graph with any IP edges it eventually reaches
 * everything. `maxDepth` is the honest limit.
 *
 * THE DEPTH IS DOUBLED because this graph is bipartite in practice — accounts
 * connect to accounts only THROUGH a shared resource, so every account-to-
 * account hop costs two levels. A depth of 6 sees three account-hops out. An
 * earlier default of 3 saw only one, measured a fragment of a ring, and
 * reported its density as if it were the whole.
 */
export function componentStats(index: GraphIndex, origin: EntityId, maxDepth = 6): ComponentStats {
  const reached = neighbourhood(index, origin, maxDepth);
  const all = [origin, ...reached.map((r) => r.entity)];
  const accounts = all.filter((e) => e.type === "account");
  // Only resource-like entities count toward density. Merchants and ASNs are
  // shared by construction and would swamp the ratio.
  const shared = all.filter((e) =>
    (["device", "phone", "email", "address", "card", "bank_account", "wallet"] as EntityType[]).includes(
      e.type
    )
  );

  return {
    size: all.length,
    accountCount: accounts.length,
    sharedEntityCount: shared.length,
    density: shared.length === 0 ? 0 : Number((accounts.length / shared.length).toFixed(2)),
  };
}

/** Density at or above which a component looks like a ring rather than a family. */
// Measured against the fixtures in the tests: twelve ordinary customers, each
// with their own device and card, produce a density of 0.5. Twelve accounts
// funnelled through three devices and two cards produce 2.4. The threshold sits
// between them with margin on both sides rather than being picked round.
export const RING_DENSITY_THRESHOLD = 2.0;
/** Below this many accounts, density is noise — two accounts on one phone is a couple. */
export const RING_MIN_ACCOUNTS = 6;

// ── Reason production ──────────────────────────────────────────────────────

/**
 * Convert graph structure into observed reasons for the trust score.
 *
 * The confidence assigned here is where graph analysis either earns its place
 * or produces mass false positives, so each one is justified inline. Nothing
 * emitted from this function is `sufficientAlone`: the graph proposes, the
 * score decides, and a human sees anything it cannot decide confidently.
 */
export function graphReasons(
  index: GraphIndex,
  origin: EntityId,
  now: string = new Date().toISOString()
): readonly ObservedReason[] {
  const reasons: ObservedReason[] = [];

  // 1. Excessive sharing.
  for (const finding of excessiveSharing(index, origin, 1)) {
    // IP sharing NEVER produces this reason. Corporate NAT, campus wifi and
    // CGNAT put thousands of unrelated people behind one address; emitting a
    // high-severity reason for it would flag an office building.
    if (finding.entity.type === "ip" || finding.entity.type === "asn") continue;

    const isInstrument =
      finding.entity.type === "card" ||
      finding.entity.type === "bank_account" ||
      finding.entity.type === "wallet";

    reasons.push({
      code: isInstrument ? "GRF.SHARED_INSTRUMENT" : "GRF.SHARED_DEVICE_CLUSTER",
      // Confidence scales with how far past plausible the sharing is, capped
      // below certainty: a refurbished handset or a shared family card is
      // always a live alternative explanation.
      confidence: Math.min(0.9, 0.4 + 0.15 * (finding.excessRatio - 1)),
      detail: `${finding.entity.type} linked to ${finding.accountCount} accounts (threshold ${finding.threshold})`,
      observedAt: now,
    });
  }

  // 2. Proximity to confirmed fraud.
  const proximity = fraudProximity(index, origin, 2);
  const confirmed = proximity.filter((p) => p.label === "confirmed_fraud");
  if (confirmed.length > 0) {
    const nearest = confirmed[0];
    // Only CONFIRMED fraud produces this. `auto_declined` is deliberately
    // excluded: an automated decline may itself be a false positive, and
    // treating it as ground truth is how one bad decision propagates through a
    // graph into a hundred.
    const throughWeakLink = nearest.via.includes("ip") || nearest.via.includes("asn");
    reasons.push({
      code: "GRF.LINKED_TO_CONFIRMED_FRAUD",
      // Distance and link quality both discount it. A direct card link is
      // strong; a two-hop IP link is barely evidence at all.
      confidence: Math.max(
        0.15,
        (nearest.distance === 1 ? 0.85 : 0.45) * (throughWeakLink ? 0.35 : 1)
      ),
      detail:
        `${confirmed.length} confirmed-fraud entit${confirmed.length === 1 ? "y" : "ies"} at ` +
        `distance ${nearest.distance} via ${nearest.via.join(" -> ") || "direct"}`,
      observedAt: now,
    });
  }

  // 3. Component density.
  const stats = componentStats(index, origin);
  if (stats.accountCount >= RING_MIN_ACCOUNTS && stats.density >= RING_DENSITY_THRESHOLD) {
    reasons.push({
      code: "GRF.DENSE_COMPONENT",
      confidence: Math.min(0.85, 0.35 + 0.12 * (stats.density - RING_DENSITY_THRESHOLD)),
      detail:
        `${stats.accountCount} accounts share ${stats.sharedEntityCount} resources ` +
        `(density ${stats.density}, threshold ${RING_DENSITY_THRESHOLD})`,
      observedAt: now,
    });
  }

  return reasons;
}
