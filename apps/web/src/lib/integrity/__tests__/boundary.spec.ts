import { describe, it, expect } from "vitest";
import {
  canonicalise,
  CanonicalisationError,
  intentDigest,
  sameIntent,
  verifyBinding,
  type CanonicalIntent,
} from "../canonical";
import {
  authorizeForSigning,
  simulationSummary,
  type SimulationResult,
  type UserConfirmation,
} from "../boundary";
import { AndroidPlayIntegrityProvider, verifyIntegrity } from "../providers";
import { integrityRiskWeight, type AppIntegritySignal } from "../types";

// ---------------------------------------------------------------------------
// The unified attestation + simulation boundary.
//
// The red-team scenarios from the brief are implemented literally here:
// transaction tampering, signer substitution, token replay onto another
// request. Each must BLOCK.
// ---------------------------------------------------------------------------

const NOW = Date.parse("2026-09-06T12:00:00.000Z");

function intent(overrides: Partial<CanonicalIntent> = {}): CanonicalIntent {
  return {
    action: "transfer",
    intentId: "itx_1",
    accountId: "acc_1",
    chain: "arbitrum",
    assetId: "USDC.arbitrum",
    amountMinor: "10000000", // 10 USDC
    destination: "0x" + "a1".repeat(20),
    nonce: "nonce_1",
    issuedAt: NOW - 5_000,
    expiresAt: NOW + 300_000,
    ...overrides,
  };
}

function simulation(over: Partial<SimulationResult> = {}): SimulationResult {
  const base = intent();
  return {
    outcome: "clean",
    boundDigest: intentDigest(base),
    provider: "test",
    simulatedAt: new Date(NOW - 5_000).toISOString(),
    warnings: [],
    ...over,
  };
}

function confirmation(over: Partial<UserConfirmation> = {}): UserConfirmation {
  return {
    boundDigest: intentDigest(intent()),
    confirmedAt: new Date(NOW - 2_000).toISOString(),
    ...over,
  };
}

function integrity(over: Partial<AppIntegritySignal> = {}): AppIntegritySignal {
  return {
    platform: "android",
    verdict: "passed",
    requestBound: true,
    boundDigest: intentDigest(intent()),
    verifiedAt: new Date(NOW - 1_000).toISOString(),
    ...over,
  };
}

const EXPECTED = { nonce: "nonce_1", accountId: "acc_1" };

function authorize(over: Partial<Parameters<typeof authorizeForSigning>[0]> = {}) {
  return authorizeForSigning(
    {
      intent: intent(),
      expected: EXPECTED,
      simulation: simulation(),
      integrity: integrity(),
      confirmation: confirmation(),
      aboutToSign: intent(),
      ...over,
    },
    NOW
  );
}

describe("canonicalisation is deterministic and unambiguous", () => {
  it("produces the same digest regardless of key insertion order", () => {
    // JS objects preserve insertion order, so two structurally identical
    // intents built differently would otherwise serialise differently — and
    // client and server would compute different digests for the same money.
    const a: CanonicalIntent = { ...intent() };
    const b: CanonicalIntent = {
      expiresAt: intent().expiresAt,
      issuedAt: intent().issuedAt,
      nonce: intent().nonce,
      destination: intent().destination,
      amountMinor: intent().amountMinor,
      assetId: intent().assetId,
      chain: intent().chain,
      accountId: intent().accountId,
      intentId: intent().intentId,
      action: intent().action,
    };
    expect(intentDigest(a)).toBe(intentDigest(b));
  });

  it("folds EVM address case but never non-EVM case", () => {
    const upper = intent({ destination: "0x" + "A1".repeat(20) });
    expect(sameIntent(intent(), upper)).toBe(true);

    // A Solana address is base58 — case is significant, and folding it would
    // produce a different, wrong address.
    const solA = intent({ chain: "solana", destination: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" });
    const solB = intent({ chain: "solana", destination: "epjfwdd5aufqssqem2qn1xzybapc8g4weggkzwytdt1v" });
    expect(sameIntent(solA, solB)).toBe(false);
  });

  it("gives a different digest to every field that matters", () => {
    const base = intentDigest(intent());
    const variants: Partial<CanonicalIntent>[] = [
      { amountMinor: "10000001" },
      { destination: "0x" + "b2".repeat(20) },
      { chain: "base" },
      { assetId: "USDC.base" },
      { action: "approve" },
      { spender: "0x" + "c3".repeat(20) },
      { calldata: "0xdeadbeef" },
      { nonce: "nonce_2" },
      { accountId: "acc_2" },
    ];
    for (const v of variants) {
      expect(intentDigest(intent(v)), JSON.stringify(v)).not.toBe(base);
    }
  });

  it("does not confuse a set spender with a set calldata", () => {
    // Absent optional fields are emitted empty rather than skipped. Skipping
    // would let these two collide.
    const a = intent({ spender: "0xab", calldata: undefined });
    const b = intent({ spender: undefined, calldata: "0xab" });
    expect(intentDigest(a)).not.toBe(intentDigest(b));
  });

  it("rejects a separator smuggled into a field value", () => {
    // Without this, a value containing the unit separator could shift every
    // later field and forge a digest for a different intent.
    expect(() => canonicalise(intent({ destination: "0xaabb" }))).toThrow(CanonicalisationError);
  });

  it("rejects a non-integer amount", () => {
    // A float has no canonical decimal form; two platforms could serialise
    // 10.10 differently and silently break the binding.
    for (const bad of ["10.5", "1e6", "", "abc"]) {
      expect(() => canonicalise(intent({ amountMinor: bad })), bad).toThrow(CanonicalisationError);
    }
  });

  it("rejects an intent that expires before it is issued", () => {
    expect(() => canonicalise(intent({ issuedAt: NOW, expiresAt: NOW - 1 }))).toThrow();
  });
});

describe("binding verification", () => {
  it("accepts a well-formed live intent", () => {
    const result = verifyBinding(
      intent(),
      { digest: intentDigest(intent()), ...EXPECTED },
      NOW
    );
    expect(result.bound).toBe(true);
  });

  it("reports every failure at once, not just the first", () => {
    // During an incident, "expired" vs "digest mismatch" is the difference
    // between a slow user and an active attack.
    const result = verifyBinding(
      intent({ expiresAt: NOW - 1_000, nonce: "wrong", accountId: "other" }),
      { digest: "0".repeat(64), ...EXPECTED },
      NOW
    );
    expect(result.failures).toEqual(
      expect.arrayContaining(["digest_mismatch", "nonce_mismatch", "account_mismatch", "expired"])
    );
  });

  it("tolerates modest client clock skew", () => {
    // A phone a few seconds fast must not have every authorisation rejected.
    const skewed = intent({ issuedAt: NOW + 30_000, expiresAt: NOW + 300_000 });
    expect(verifyBinding(skewed, { digest: intentDigest(skewed), ...EXPECTED }, NOW).bound).toBe(true);
  });
});

describe("RED TEAM: transaction tampering", () => {
  it("BLOCKS when the signing payload differs from the confirmed intent", () => {
    // The brief's scenario: client approves $10, attacker changes to $10,000.
    // Every other control still points at the original.
    const decision = authorize({
      aboutToSign: intent({ amountMinor: "10000000000" }),
    });
    expect(decision.allowed).toBe(false);
    expect(decision.refusals).toContain("signing_payload_mismatch");
  });

  it("BLOCKS a recipient substitution between simulation and signing", () => {
    // Simulated recipient A, signature request recipient B.
    const decision = authorize({
      aboutToSign: intent({ destination: "0x" + "ff".repeat(20) }),
    });
    expect(decision.allowed).toBe(false);
    expect(decision.refusals).toContain("signing_payload_mismatch");
  });

  it("BLOCKS a transfer quietly rewritten as an approval", () => {
    const decision = authorize({
      aboutToSign: intent({ action: "approve", spender: "0x" + "ee".repeat(20) }),
    });
    expect(decision.allowed).toBe(false);
    expect(decision.refusals).toContain("signing_payload_mismatch");
  });

  it("BLOCKS a chain switch", () => {
    const decision = authorize({ aboutToSign: intent({ chain: "base", assetId: "USDC.base" }) });
    expect(decision.allowed).toBe(false);
  });
});

describe("RED TEAM: token and evidence replay", () => {
  it("BLOCKS a PASSING integrity token bound to a different request", () => {
    // A valid token lifted from a $1 request and attached to a $10,000 one.
    // Worse than no token: it is genuine, and it is about something else.
    const decision = authorize({
      integrity: integrity({ boundDigest: intentDigest(intent({ amountMinor: "1" })) }),
    });
    expect(decision.allowed).toBe(false);
    expect(decision.refusals).toContain("integrity_unbound");
  });

  it("BLOCKS an integrity signal that claims no request binding at all", () => {
    const decision = authorize({ integrity: integrity({ requestBound: false }) });
    expect(decision.allowed).toBe(false);
    expect(decision.refusals).toContain("integrity_unbound");
  });

  it("BLOCKS a simulation of a different transaction", () => {
    const decision = authorize({
      simulation: simulation({ boundDigest: intentDigest(intent({ amountMinor: "1" })) }),
    });
    expect(decision.allowed).toBe(false);
    expect(decision.refusals).toContain("simulation_unbound");
  });

  it("BLOCKS a confirmation the user gave for a different transaction", () => {
    // The bait-and-switch, and indistinguishable from a UI bug — both block.
    const decision = authorize({
      confirmation: confirmation({ boundDigest: intentDigest(intent({ amountMinor: "1" })) }),
    });
    expect(decision.allowed).toBe(false);
    expect(decision.refusals).toContain("confirmation_unbound");
  });

  it("BLOCKS a replayed expired intent", () => {
    const stale = intent({ issuedAt: NOW - 600_000, expiresAt: NOW - 300_000 });
    const decision = authorizeForSigning(
      {
        intent: stale,
        expected: EXPECTED,
        simulation: simulation({ boundDigest: intentDigest(stale) }),
        integrity: integrity({ boundDigest: intentDigest(stale) }),
        confirmation: confirmation({ boundDigest: intentDigest(stale) }),
        aboutToSign: stale,
      },
      NOW
    );
    expect(decision.allowed).toBe(false);
    expect(decision.refusals).toContain("expired");
  });
});

describe("simulation policy", () => {
  it("BLOCKS a known-malicious interaction", () => {
    const decision = authorize({ simulation: simulation({ outcome: "malicious" }) });
    expect(decision.allowed).toBe(false);
    expect(decision.refusals).toContain("simulation_malicious");
  });

  it("BLOCKS a stale simulation", () => {
    // Chain state moves. A simulation from ten minutes ago describes a
    // different world.
    const decision = authorize({
      simulation: simulation({ simulatedAt: new Date(NOW - 600_000).toISOString() }),
    });
    expect(decision.refusals).toContain("simulation_stale");
  });

  it("BLOCKS when no simulation was run at all", () => {
    expect(authorize({ simulation: null }).refusals).toContain("simulation_missing");
  });

  it("WARNS but allows on a non-malicious warning", () => {
    // A simulator that blocks on every warning trains users to route around it.
    const decision = authorize({
      simulation: simulation({ outcome: "warning", warnings: ["Recipient is a new contract"] }),
    });
    expect(decision.allowed).toBe(true);
    expect(decision.warnings).toContain("Recipient is a new contract");
  });

  it("surfaces an unlimited approval as a warning without blocking", () => {
    const decision = authorize({
      simulation: simulation({
        approval: { spender: "0xspender", amountMinor: "-1", unlimited: true },
      }),
    });
    expect(decision.allowed).toBe(true);
    expect(decision.warnings.join(" ")).toMatch(/[Uu]nlimited/);
  });

  it("allows but warns when the simulator was unavailable", () => {
    // Not evidence of danger, and not evidence of safety either.
    const decision = authorize({ simulation: simulation({ outcome: "unavailable" }) });
    expect(decision.allowed).toBe(true);
    expect(decision.warnings.join(" ")).toMatch(/has not been checked/);
  });

  it("NEVER phrases a clean simulation as a safety guarantee", () => {
    // Stating "safe" transfers our uncertainty to the user as false
    // confidence — the thing they point at afterwards.
    const summary = simulationSummary(simulation());
    expect(summary).not.toMatch(/\bsafe\b/i);
    expect(summary).toMatch(/No known issues/);
  });
});

describe("integrity is a signal, not a gate — the deliberate asymmetry", () => {
  it("ALLOWS when no integrity signal exists at all", () => {
    // Hard-gating blocks old hardware, de-Googled Android and enterprise
    // builds — real customers — while an attacker moves to a platform that
    // passes.
    const decision = authorize({ integrity: null });
    expect(decision.allowed).toBe(true);
    expect(decision.warnings.join(" ")).toMatch(/No device integrity signal/);
  });

  it("ALLOWS an unsupported device, weighting it near zero", () => {
    const signal = integrity({ verdict: "unsupported", requestBound: false, boundDigest: undefined });
    expect(authorize({ integrity: signal }).allowed).toBe(true);
    expect(integrityRiskWeight(signal)).toBeLessThan(0.1);
  });

  it("ALLOWS but heavily weights a verification failure that is not a mismatch", () => {
    // Broken Play Services or an enterprise build. High risk, not proof.
    const signal = integrity({ verdict: "failed", boundDigest: undefined, requestBound: false });
    const decision = authorize({ integrity: signal });
    expect(decision.allowed).toBe(true);
    expect(decision.riskWeight).toBeGreaterThanOrEqual(0.5);
  });

  it("scores our OWN missing integration at zero risk", () => {
    // A gap in our build must never add risk to a customer's score.
    expect(integrityRiskWeight(integrity({ verdict: "not_configured" }))).toBe(0);
  });

  it("ALLOWS a degraded device with a warning", () => {
    const decision = authorize({ integrity: integrity({ verdict: "degraded" }) });
    expect(decision.allowed).toBe(true);
    expect(decision.warnings.join(" ")).toMatch(/did not meet full integrity/);
  });
});

describe("Play Integrity payload evaluation", () => {
  const provider = new AndroidPlayIntegrityProvider();
  const digest = intentDigest(intent());
  const expected = { digest, packageName: "com.furlpay.app" };

  const payload = (over: Record<string, unknown> = {}) => ({
    requestDetails: {
      requestPackageName: "com.furlpay.app",
      requestHash: digest,
      timestampMillis: String(NOW - 1_000),
    },
    appIntegrity: { appRecognitionVerdict: "PLAY_RECOGNIZED", packageName: "com.furlpay.app" },
    deviceIntegrity: { deviceRecognitionVerdict: ["MEETS_DEVICE_INTEGRITY"] },
    ...over,
  });

  it("passes a genuine, bound, fresh token", () => {
    const signal = provider.evaluatePayload(payload(), expected, NOW);
    expect(signal.verdict).toBe("passed");
    expect(signal.requestBound).toBe(true);
  });

  it("FAILS a token whose requestHash does not match our own computation", () => {
    // The binding check the platform docs require: recompute independently,
    // then compare. Without it the token can be lifted onto another request.
    const signal = provider.evaluatePayload(
      payload({ requestDetails: { requestPackageName: "com.furlpay.app", requestHash: "0".repeat(64) } }),
      expected,
      NOW
    );
    expect(signal.verdict).toBe("failed");
    expect(signal.requestBound).toBe(false);
    expect(signal.failureReason).toMatch(/requestHash/);
  });

  it("FAILS a token minted for a different package", () => {
    const signal = provider.evaluatePayload(
      payload({
        requestDetails: { requestPackageName: "com.attacker.app", requestHash: digest },
      }),
      expected,
      NOW
    );
    expect(signal.verdict).toBe("failed");
  });

  it("FAILS a stale token", () => {
    const signal = provider.evaluatePayload(
      payload({
        requestDetails: {
          requestPackageName: "com.furlpay.app",
          requestHash: digest,
          timestampMillis: String(NOW - 3_600_000),
        },
      }),
      expected,
      NOW
    );
    expect(signal.verdict).toBe("failed");
    expect(signal.failureReason).toMatch(/old/);
  });

  it("FAILS a device that met NO integrity verdict", () => {
    const signal = provider.evaluatePayload(
      payload({ deviceIntegrity: { deviceRecognitionVerdict: [] } }),
      expected,
      NOW
    );
    expect(signal.verdict).toBe("failed");
  });

  it("DEGRADES rather than fails an emulator", () => {
    // CI, QA and accessibility tooling all run in emulators.
    const signal = provider.evaluatePayload(
      payload({ deviceIntegrity: { deviceRecognitionVerdict: ["MEETS_VIRTUAL_INTEGRITY"] } }),
      expected,
      NOW
    );
    expect(signal.verdict).toBe("degraded");
    expect(signal.failureReason).toMatch(/virtual/);
  });

  it("DEGRADES an app Play does not recognise", () => {
    const signal = provider.evaluatePayload(
      payload({
        appIntegrity: { appRecognitionVerdict: "UNRECOGNIZED_VERSION", packageName: "com.furlpay.app" },
      }),
      expected,
      NOW
    );
    expect(signal.verdict).toBe("degraded");
  });

  it("DEGRADES when screen-capture or overlay apps are active", () => {
    const signal = provider.evaluatePayload(
      payload({
        environmentDetails: { appAccessRiskVerdict: { appsDetected: ["KNOWN_CAPTURING"] } },
      }),
      expected,
      NOW
    );
    expect(signal.verdict).toBe("degraded");
  });

  it("preserves platform evidence rather than flattening it away", () => {
    // "Device integrity failed" and "app is not the Play version" are
    // different problems; an analyst needs to tell them apart.
    const signal = provider.evaluatePayload(payload(), expected, NOW);
    expect(signal.platformDetail?.appRecognitionVerdict).toBe("PLAY_RECOGNIZED");
    expect(signal.platformDetail?.deviceVerdicts).toBe("MEETS_DEVICE_INTEGRITY");
  });
});

describe("providers refuse to fabricate a verdict", () => {
  it("reports not_configured rather than passed when credentials are absent", async () => {
    // The failure this codebase keeps removing: a 'passed' from a function
    // that contacted nobody.
    for (const platform of ["ios", "android"] as const) {
      const signal = await verifyIntegrity({
        platform,
        token: "x".repeat(64),
        expectedDigest: intentDigest(intent()),
      });
      expect(signal.verdict, platform).not.toBe("passed");
      expect(["not_configured", "failed"], platform).toContain(signal.verdict);
    }
  });

  it("reports web as unsupported rather than inventing an equivalent", async () => {
    // Treating a browser signal as equivalent would make the web the obvious
    // path for anyone the mobile controls stopped.
    const signal = await verifyIntegrity({
      platform: "web",
      token: "x",
      expectedDigest: intentDigest(intent()),
    });
    expect(signal.verdict).toBe("unsupported");
  });
});

describe("the happy path still works", () => {
  it("allows a fully bound, simulated, confirmed, attested transaction", () => {
    const decision = authorize();
    expect(decision.allowed).toBe(true);
    expect(decision.refusals).toEqual([]);
    expect(decision.digest).toBe(intentDigest(intent()));
  });

  it("collects every refusal at once when several controls disagree", () => {
    const decision = authorize({
      simulation: null,
      confirmation: null,
      aboutToSign: intent({ amountMinor: "999" }),
    });
    expect(decision.refusals).toEqual(
      expect.arrayContaining(["simulation_missing", "confirmation_missing", "signing_payload_mismatch"])
    );
  });
});
