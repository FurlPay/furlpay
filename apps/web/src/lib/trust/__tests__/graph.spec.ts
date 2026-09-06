import { describe, it, expect } from "vitest";
import {
  componentStats,
  excessiveSharing,
  fraudProximity,
  GraphIndex,
  graphReasons,
  neighbourhood,
  RING_DENSITY_THRESHOLD,
  SHARING_THRESHOLDS,
  type Edge,
  type EntityId,
  type LabelledEntity,
} from "../graph";
import { assessTrust, recommendedAction } from "../score";

// ---------------------------------------------------------------------------
// The entity graph.
//
// Half these tests exist to prove the system does NOT fire. A graph that flags
// every shared device flags families, students, shared offices and anyone with
// a refurbished phone — a fraud failure and a fairness failure at once.
// ---------------------------------------------------------------------------

const NOW = "2026-09-06T12:00:00.000Z";

const account = (n: string | number): EntityId => ({ type: "account", id: `acc_${n}` });
const device = (n: string | number): EntityId => ({ type: "device", id: `dev_${n}` });
const phone = (n: string | number): EntityId => ({ type: "phone", id: `ph_${n}` });
const card = (n: string | number): EntityId => ({ type: "card", id: `card_${n}` });
const ip = (n: string | number): EntityId => ({ type: "ip", id: `ip_${n}` });

function edge(from: EntityId, to: EntityId, observations = 5): Edge {
  return { from, to, kind: "used", firstSeen: NOW, lastSeen: NOW, observations };
}

/** N accounts all attached to one entity. */
function fanOut(target: EntityId, n: number, offset = 0): Edge[] {
  return Array.from({ length: n }, (_, i) => edge(account(i + offset), target));
}

describe("benign sharing does not fire — the fairness property", () => {
  it("does not flag a family device shared by four accounts", () => {
    const index = new GraphIndex(fanOut(device(1), 4));
    expect(excessiveSharing(index, device(1))).toHaveLength(0);
    expect(graphReasons(index, account(0), NOW)).toHaveLength(0);
  });

  it("does not flag a household address shared by six accounts", () => {
    const address: EntityId = { type: "address", id: "addr_1" };
    const index = new GraphIndex(fanOut(address, 6));
    expect(excessiveSharing(index, address)).toHaveLength(0);
  });

  it("NEVER produces a graph reason for a heavily shared IP", () => {
    // Corporate NAT, campus wifi and CGNAT put thousands of unrelated people
    // behind one address. Flagging this flags an office building.
    const index = new GraphIndex(fanOut(ip(1), 400));
    const reasons = graphReasons(index, account(0), NOW);
    expect(reasons.filter((r) => r.code.startsWith("GRF."))).toHaveLength(0);
  });

  it("does not flag a merchant paid by many accounts", () => {
    const merchant: EntityId = { type: "merchant", id: "m_1" };
    const index = new GraphIndex(fanOut(merchant, 5_000));
    expect(excessiveSharing(index, merchant)).toHaveLength(0);
  });
});

describe("the concrete fraud shapes", () => {
  it("detects one device across 15 accounts", () => {
    const index = new GraphIndex(fanOut(device(1), 15));
    const findings = excessiveSharing(index, device(1));

    expect(findings).toHaveLength(1);
    expect(findings[0].accountCount).toBe(15);
    expect(findings[0].threshold).toBe(SHARING_THRESHOLDS.device);
    expect(findings[0].excessRatio).toBe(3);

    const reasons = graphReasons(index, account(0), NOW);
    expect(reasons.map((r) => r.code)).toContain("GRF.SHARED_DEVICE_CLUSTER");
  });

  it("detects one phone across 8 accounts", () => {
    // A phone number is meant to be personal. Two is a couple; eight is a farm.
    const index = new GraphIndex(fanOut(phone(1), 8));
    const findings = excessiveSharing(index, phone(1));
    expect(findings[0].accountCount).toBe(8);
    expect(findings[0].excessRatio).toBe(4);
  });

  it("detects one card across multiple unrelated identities", () => {
    const index = new GraphIndex(fanOut(card(1), 6));
    const reasons = graphReasons(index, account(0), NOW);
    // An instrument shared across identities is the stolen-card / farming
    // shape and gets the instrument code, not the device one.
    expect(reasons.map((r) => r.code)).toContain("GRF.SHARED_INSTRUMENT");
  });

  it("detects a dense ring: 12 accounts funnelled through 3 resources", () => {
    // Resources cost money; identities are cheap. Many accounts through few
    // devices is the structural signature of a farm.
    const edges: Edge[] = [];
    for (let i = 0; i < 12; i++) {
      edges.push(edge(account(i), device(i % 3)));
      edges.push(edge(account(i), card(i % 2)));
    }
    const index = new GraphIndex(edges);
    // Depth 6 = three account-hops. At depth 3 only 8 of the 12 accounts are
    // reachable and the density of a ring FRAGMENT gets reported as the whole.
    const stats = componentStats(index, account(0));

    expect(stats.accountCount).toBe(12);
    expect(stats.density).toBeGreaterThanOrEqual(RING_DENSITY_THRESHOLD);
    expect(graphReasons(index, account(0), NOW).map((r) => r.code)).toContain(
      "GRF.DENSE_COMPONENT"
    );
  });

  it("does not call a normal customer population a ring", () => {
    // 12 accounts, each with its own device and card. Same account count as
    // the ring above; entirely different structure.
    const edges: Edge[] = [];
    for (let i = 0; i < 12; i++) {
      edges.push(edge(account(i), device(i)));
      edges.push(edge(account(i), card(i)));
    }
    const index = new GraphIndex(edges);
    expect(componentStats(index, account(0)).density).toBeLessThan(RING_DENSITY_THRESHOLD);
    expect(graphReasons(index, account(0), NOW).map((r) => r.code)).not.toContain(
      "GRF.DENSE_COMPONENT"
    );
  });
});

describe("distance and link quality discount the evidence", () => {
  const labelled: LabelledEntity[] = [
    { entity: account(99), label: "confirmed_fraud", at: NOW },
  ];

  it("weights a direct card link far above a two-hop IP link", () => {
    const direct = new GraphIndex(
      [edge(account(0), card(1)), edge(account(99), card(1))],
      labelled
    );
    // Both fixtures are 2 hops. The ONLY difference is what the path runs
     // through — a card versus an IP — which is exactly what should change the
     // weight.
    const viaIp = new GraphIndex(
      [edge(account(0), ip(1)), edge(account(99), ip(1))],
      labelled
    );

    const directReason = graphReasons(direct, account(0), NOW).find(
      (r) => r.code === "GRF.LINKED_TO_CONFIRMED_FRAUD"
    );
    const ipReason = graphReasons(viaIp, account(0), NOW).find(
      (r) => r.code === "GRF.LINKED_TO_CONFIRMED_FRAUD"
    );

    expect(directReason).toBeDefined();
    expect(ipReason).toBeDefined();
    // Sharing a card with a fraudster is not the same claim as sharing an IP
    // with someone who knows one.
    expect(directReason!.confidence).toBeGreaterThan(ipReason!.confidence * 2);
  });

  it("reports distance rather than a boolean", () => {
    const index = new GraphIndex(
      [edge(account(0), device(1)), edge(account(50), device(1)), edge(account(50), card(9)), edge(account(99), card(9))],
      labelled
    );
    const proximity = fraudProximity(index, account(0), 4);
    expect(proximity.length).toBeGreaterThan(0);
    expect(proximity[0].distance).toBeGreaterThan(1);
    // `via` carries the INTERMEDIATE hops. An intermediate ACCOUNT is a real
    // part of the path and belongs here; what must never appear is the origin
    // itself, which would make every path look like it ran through an account.
    expect(proximity[0].via[0]).toBe("device");
  });

  it("bounds traversal so the third hop does not connect everyone", () => {
    // At depth 3 through an IP, half the population is "linked" to everyone.
    // Bounding is what separates a signal from a coincidence.
    const chain: Edge[] = [];
    for (let i = 0; i < 10; i++) chain.push(edge(account(i), account(i + 1)));
    const index = new GraphIndex(chain);
    expect(neighbourhood(index, account(0), 2)).toHaveLength(2);
  });
});

describe("an automated decline is not ground truth", () => {
  it("does NOT propagate auto_declined as confirmed fraud", () => {
    // An automated decline may itself be a false positive. Treating it as
    // proof is how one bad decision propagates through a graph into a hundred
    // — the feedback loop that poisons a fraud system from the inside.
    const index = new GraphIndex(
      [edge(account(0), device(1)), edge(account(99), device(1))],
      [{ entity: account(99), label: "auto_declined", at: NOW }]
    );
    const reasons = graphReasons(index, account(0), NOW);
    expect(reasons.map((r) => r.code)).not.toContain("GRF.LINKED_TO_CONFIRMED_FRAUD");
  });

  it("does propagate a human-confirmed fraud label", () => {
    const index = new GraphIndex(
      [edge(account(0), device(1)), edge(account(99), device(1))],
      [{ entity: account(99), label: "confirmed_fraud", at: NOW }]
    );
    expect(graphReasons(index, account(0), NOW).map((r) => r.code)).toContain(
      "GRF.LINKED_TO_CONFIRMED_FRAUD"
    );
  });
});

describe("graph reasons feed the score without ever deciding alone", () => {
  it("routes a lone graph signal to a human rather than a decline", () => {
    const index = new GraphIndex(
      [edge(account(0), device(1)), edge(account(99), device(1))],
      [{ entity: account(99), label: "confirmed_fraud", at: NOW }]
    );
    const assessment = assessTrust(graphReasons(index, account(0), NOW));
    const decision = recommendedAction(assessment);

    // Graph structure proposes; the score decides; a human sees anything the
    // score cannot decide confidently.
    expect(decision.action).not.toBe("decline");
    expect(["manual_review", "step_up", "hold", "approve"]).toContain(decision.action);
  });

  it("escalates when the graph corroborates itself across shapes", () => {
    const edges: Edge[] = [];
    for (let i = 0; i < 12; i++) {
      edges.push(edge(account(i), device(i % 2)));
      edges.push(edge(account(i), card(i % 2)));
    }
    edges.push(edge(account(99), device(0)));
    const index = new GraphIndex(edges, [
      { entity: account(99), label: "confirmed_fraud", at: NOW },
    ]);

    const reasons = graphReasons(index, account(0), NOW);
    const codes = reasons.map((r) => r.code);
    expect(codes).toContain("GRF.SHARED_DEVICE_CLUSTER");
    expect(codes).toContain("GRF.SHARED_INSTRUMENT");
    expect(codes).toContain("GRF.DENSE_COMPONENT");
    expect(codes).toContain("GRF.LINKED_TO_CONFIRMED_FRAUD");

    expect(assessTrust(reasons).band).toBe("high");
  });

  it("emits no reason at all for an isolated account", () => {
    const index = new GraphIndex([edge(account(0), device(0))]);
    expect(graphReasons(index, account(0), NOW)).toHaveLength(0);
    expect(assessTrust(graphReasons(index, account(0), NOW)).score).toBe(0);
  });
});

describe("the graph holds no sensitive material", () => {
  it("keeps identifiers opaque in reason details", () => {
    const index = new GraphIndex(fanOut(card(1), 6));
    for (const reason of graphReasons(index, account(0), NOW)) {
      // Entity ids reaching this module must already be hashed or tokenised.
      expect(reason.detail ?? "").not.toMatch(/\d{13,19}/);
    }
  });
});
