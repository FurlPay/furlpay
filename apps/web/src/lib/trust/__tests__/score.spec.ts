import { describe, it, expect } from "vitest";
import {
  assessTrust,
  bandFor,
  BANDS,
  decayFactor,
  explainDecision,
  MIN_CONFIDENCE_TO_DECLINE,
  recommendedAction,
  SCORE_MAX,
} from "../score";
import { customerFacingMessage, REASONS, standaloneCodes, type ObservedReason, type ReasonCode } from "../reasons";

// ---------------------------------------------------------------------------
// The Trust Score.
//
// Every block below is a documented failure of the additive scorer this
// replaces, or a safety property that must hold for an automated decline to be
// defensible.
// ---------------------------------------------------------------------------

const NOW = Date.parse("2026-09-06T12:00:00.000Z");

function reason(code: ReasonCode, opts: Partial<ObservedReason> = {}): ObservedReason {
  return {
    code,
    confidence: 1,
    observedAt: new Date(NOW).toISOString(),
    ...opts,
  };
}

function daysAgo(n: number): string {
  return new Date(NOW - n * 86_400_000).toISOString();
}

describe("saturation — the defect that motivated the rewrite", () => {
  it("does not let many weak signals reach the strength of one critical one", () => {
    // The old engine: automation(+75) + emulator(+40) hit the block threshold,
    // so "new device on a VPN" scored the same as a confirmed fraud ring. Once
    // the ceiling is reached the score stops carrying information exactly where
    // the decision matters.
    const manyWeak = assessTrust(
      [
        reason("IDN.THIN_HISTORY"),
        reason("DEV.NEW_TO_ACCOUNT"),
        reason("BEH.PASTED_CREDENTIALS"),
        reason("NET.ANONYMISING_PROXY"),
      ],
      NOW
    );
    const oneCritical = assessTrust([reason("GRF.LINKED_TO_CONFIRMED_FRAUD")], NOW);

    expect(manyWeak.score).toBeLessThan(oneCritical.score);
  });

  it("shows diminishing returns within a category", () => {
    // Noisy-OR: the second signal of a kind adds less than the first. Without
    // this, stacking cheap correlated signals is a way to manufacture a block.
    const one = assessTrust([reason("DEV.EMULATOR")], NOW);
    const two = assessTrust([reason("DEV.EMULATOR"), reason("DEV.INTEGRITY_FAILED")], NOW);
    const three = assessTrust(
      [reason("DEV.EMULATOR"), reason("DEV.INTEGRITY_FAILED"), reason("DEV.MUTATION_MID_SESSION")],
      NOW
    );

    expect(two.score).toBeGreaterThan(one.score);
    expect(three.score).toBeGreaterThan(two.score);
    expect(three.score - two.score).toBeLessThan(two.score - one.score);
  });

  it("never exceeds the scale even with every reason firing at once", () => {
    const everything = (Object.keys(REASONS) as ReasonCode[]).map((c) => reason(c));
    const result = assessTrust(everything, NOW);
    expect(result.score).toBeLessThanOrEqual(SCORE_MAX);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });
});

describe("confidence — the guard against declining on thin evidence", () => {
  it("reports low confidence for a single signal", () => {
    const result = assessTrust([reason("GRF.LINKED_TO_CONFIRMED_FRAUD")], NOW);
    expect(result.confidence).toBeLessThan(MIN_CONFIDENCE_TO_DECLINE);
  });

  it("rises as independent categories corroborate", () => {
    const oneCategory = assessTrust(
      [reason("DEV.EMULATOR"), reason("DEV.INTEGRITY_FAILED")],
      NOW
    );
    const threeCategories = assessTrust(
      [reason("DEV.EMULATOR"), reason("GRF.SHARED_INSTRUMENT"), reason("VEL.BURST")],
      NOW
    );
    // Three categories agreeing is stronger evidence than one shouting.
    expect(threeCategories.confidence).toBeGreaterThan(oneCategory.confidence);
  });

  it("routes a HIGH score with thin evidence to a human, not to a decline", () => {
    // The single most important safety property here. Declining on thin
    // evidence concentrates false positives on the customers we know least
    // about — new, foreign, thin-file — and they cannot argue, because nobody
    // looked.
    const thin = assessTrust([reason("PAY.CARD_TESTING")], NOW);
    const decision = recommendedAction(thin);

    // Reaches "high" only because of the critical floor — by category weight
    // alone it would score 204 and auto-approve a detected card-testing run.
    expect(thin.band).toBe("high");
    expect(thin.confidence).toBeLessThan(MIN_CONFIDENCE_TO_DECLINE);
    expect(decision.action).toBe("manual_review");
    expect(decision.basis).toBe("low_confidence_guard");
  });

  it("holds funds — not declines — at HIGH with good corroboration", () => {
    // A hold is reversible; a decline is not. At the high band the right answer
    // is to stop the money and verify, keeping the customer recoverable.
    //
    // Two strong categories agreeing is what "high" is calibrated to mean. The
    // six-signal fixture below reaches critical, which is why the two cases are
    // separate tests rather than one.
    const corroborated = assessTrust(
      [reason("VEL.BURST"), reason("GRF.SHARED_INSTRUMENT")],
      NOW
    );
    expect(corroborated.confidence).toBeGreaterThanOrEqual(MIN_CONFIDENCE_TO_DECLINE);
    expect(corroborated.band).toBe("high");
    expect(recommendedAction(corroborated).action).toBe("hold");
  });

  it("declines only at CRITICAL with corroboration across many categories", () => {
    const overwhelming = assessTrust(
      [
        reason("PAY.CARD_TESTING"),
        reason("PAY.INSTRUMENT_CHARGEBACK_HISTORY"),
        reason("GRF.LINKED_TO_CONFIRMED_FRAUD"),
        reason("GRF.SHARED_INSTRUMENT"),
        reason("GRF.DENSE_COMPONENT"),
        reason("VEL.RAPID_IN_OUT"),
        reason("VEL.BURST"),
        reason("IDN.SYNTHETIC_PATTERN"),
        reason("DEV.EMULATOR"),
        reason("BEH.AUTOMATION"),
      ],
      NOW
    );
    expect(overwhelming.band).toBe("critical");
    expect(overwhelming.confidence).toBeGreaterThanOrEqual(MIN_CONFIDENCE_TO_DECLINE);
    expect(recommendedAction(overwhelming).action).toBe("decline");
  });

  it("has zero confidence when there is nothing to go on", () => {
    const empty = assessTrust([], NOW);
    expect(empty.confidence).toBe(0);
    expect(empty.score).toBe(0);
    expect(recommendedAction(empty).action).toBe("approve");
  });
});

describe("decay — a customer can recover from a bad day", () => {
  it("halves session-scoped evidence at its half-life", () => {
    // Behaviour has a 3-day half-life: automation observed last week says
    // nothing about this session.
    const fresh = decayFactor("behavior", new Date(NOW).toISOString(), NOW);
    const halfLife = decayFactor("behavior", daysAgo(3), NOW);
    expect(fresh).toBeCloseTo(1, 3);
    expect(halfLife).toBeCloseTo(0.5, 2);
  });

  it("keeps compliance evidence effectively permanent", () => {
    // A sanctions match from last month is still a sanctions match.
    expect(decayFactor("compliance", daysAgo(30), NOW)).toBeGreaterThan(0.99);
  });

  it("lowers the score as behavioural evidence ages", () => {
    const today = assessTrust([reason("BEH.AUTOMATION")], NOW);
    const lastMonth = assessTrust([reason("BEH.AUTOMATION", { observedAt: daysAgo(30) })], NOW);
    expect(lastMonth.score).toBeLessThan(today.score);
  });

  it("treats an unparseable timestamp as fully decayed, not fully fresh", () => {
    // Unknown provenance must never be the strongest evidence in the set.
    expect(decayFactor("device", "not-a-date", NOW)).toBe(0);
    const result = assessTrust([reason("DEV.EMULATOR", { observedAt: "garbage" })], NOW);
    expect(result.score).toBe(0);
  });
});

describe("trust signals offset risk — within their category only", () => {
  it("lets a long-tenured device quiet device risk", () => {
    const newDevice = assessTrust([reason("DEV.NEW_TO_ACCOUNT")], NOW);
    const knownDevice = assessTrust(
      [reason("DEV.NEW_TO_ACCOUNT"), reason("DEV.LONG_TENURE")],
      NOW
    );
    // Without a counterweight a risk engine only ever ratchets upward, and
    // every good customer eventually accumulates enough noise to be stopped.
    expect(knownDevice.score).toBeLessThan(newDevice.score);
  });

  it("does NOT let good history offset a sanctions match", () => {
    const withHistory = assessTrust(
      [reason("CMP.SANCTIONS_MATCH"), reason("ACC.ESTABLISHED_GOOD_HISTORY")],
      NOW
    );
    // Trust evidence offsets within its own category. A well-behaved customer
    // is still a sanctioned customer.
    expect(recommendedAction(withHistory).action).toBe("decline");
    expect(withHistory.standaloneTriggers).toContain("CMP.SANCTIONS_MATCH");
  });
});

describe("standalone triggers", () => {
  it("declines on a sanctions match regardless of score or confidence", () => {
    const result = assessTrust([reason("CMP.SANCTIONS_MATCH")], NOW);
    const decision = recommendedAction(result);
    // The obligation is absolute; the low-confidence guard does not apply.
    expect(result.confidence).toBeLessThan(MIN_CONFIDENCE_TO_DECLINE);
    expect(decision.action).toBe("decline");
    expect(decision.basis).toBe("standalone_trigger");
  });

  it("keeps the standalone set deliberately tiny", () => {
    // A single-signal decline is a single point of failure for a false
    // positive. Only legal absolutes belong here.
    const standalone = standaloneCodes();
    expect(standalone.length).toBeLessThanOrEqual(3);
    for (const code of standalone) {
      expect(REASONS[code].category, code).toBe("compliance");
    }
  });
});

describe("bands", () => {
  it("covers 0..1000 with no gap or overlap", () => {
    for (let score = 0; score <= 1000; score += 1) {
      expect(() => bandFor(score), String(score)).not.toThrow();
    }
    for (let i = 1; i < BANDS.length; i++) {
      expect(BANDS[i].min).toBe(BANDS[i - 1].max + 1);
    }
  });

  it("maps each band to the intended action", () => {
    const cases: [number, string][] = [
      [100, "approve"],
      [300, "approve"],
      [500, "step_up"],
    ];
    for (const [score, action] of cases) {
      const fake = { ...assessTrust([], NOW), score, band: bandFor(score), confidence: 0.9 };
      expect(recommendedAction(fake).action, String(score)).toBe(action);
    }
  });
});

describe("determinism and auditability", () => {
  it("produces the same score for the same inputs", () => {
    // A decision that cannot be reproduced cannot be audited, and "why was
    // this customer declined in March" must be answerable in September.
    const reasons = [reason("DEV.EMULATOR"), reason("VEL.BURST"), reason("GRF.SHARED_INSTRUMENT")];
    const a = assessTrust(reasons, NOW);
    const b = assessTrust(reasons, NOW);
    expect(a.score).toBe(b.score);
    expect(a.confidence).toBe(b.confidence);
  });

  it("explains an approval, not only a refusal", () => {
    // A system that only explains its refusals cannot show its approvals were
    // considered at all.
    const record = explainDecision(assessTrust([reason("DEV.LONG_TENURE")], NOW), NOW);
    expect(record.decision.action).toBe("approve");
    expect(record.decision.explanation.length).toBeGreaterThan(10);
  });

  it("attributes the score to categories, ordered by impact", () => {
    const record = explainDecision(
      assessTrust([reason("NET.ANONYMISING_PROXY"), reason("CMP.KYC_TIER_EXCEEDED")], NOW),
      NOW
    );
    const points = record.assessment.contributions.map((c) => Math.abs(c.points));
    expect([...points].sort((a, b) => b - a)).toEqual(points);
  });

  it("carries no raw credential in any factor detail", () => {
    const record = explainDecision(
      assessTrust([reason("PAY.CARD_TESTING", { detail: "6 instruments in 4 minutes" })], NOW),
      NOW
    );
    for (const factor of record.topFactors) {
      expect(factor.detail ?? "").not.toMatch(/\d{13,19}/); // PAN-shaped
    }
  });
});

describe("customer-facing disclosure", () => {
  it("says nothing specific when no reason is cleared for disclosure", () => {
    // A fraudster who learns which control fired learns what to change.
    const message = customerFacingMessage([
      { code: "IDN.SYNTHETIC_PATTERN", confidence: 1, observedAt: new Date(NOW).toISOString() },
      { code: "DEV.EMULATOR", confidence: 1, observedAt: new Date(NOW).toISOString() },
    ]);
    expect(message).toBe("We need to check a few details before we can continue.");
  });

  it("surfaces the most severe disclosable message, not all of them", () => {
    // Concatenating three specific messages re-discloses the detection logic
    // each one alone was written to protect.
    const message = customerFacingMessage([
      { code: "DEV.NEW_TO_ACCOUNT", confidence: 1, observedAt: new Date(NOW).toISOString() },
      { code: "CMP.SANCTIONS_MATCH", confidence: 1, observedAt: new Date(NOW).toISOString() },
    ]);
    expect(message).toBe(REASONS["CMP.SANCTIONS_MATCH"].customerMessage);
  });
});
