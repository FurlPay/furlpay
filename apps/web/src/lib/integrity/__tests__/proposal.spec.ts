import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getProposal,
  loadOwnedProposal,
  prepareProposal,
  updateProposal,
  PROPOSAL_TTL_MS,
} from "../proposal";
import { chainPayloadDigest, type EvmChainPayload } from "../evmPayload";
import { intentDigest } from "../canonical";
import { simulate } from "../simulation";

// ---------------------------------------------------------------------------
// The server's own copy of a transaction.
//
// The whole boundary rests on the server holding the intent. Every alternative
// reduces to the client re-describing the transaction at each step, and a
// description the client repeats is a description the client can change.
// ---------------------------------------------------------------------------

const USDC_ARBITRUM = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";
const ALICE = "0x1111111111111111111111111111111111111111";
const MALLORY = "0x2222222222222222222222222222222222222222";
const SPENDER = "0x3333333333333333333333333333333333333333";
const WALLET = "0x9999999999999999999999999999999999999999";

const DEVICE = "dev_" + "a".repeat(32);
const INSTANCE = "inst_" + "b".repeat(32);
const NOW = Date.parse("2026-09-06T12:00:00.000Z");

function transferCalldata(to: string, amount: bigint): string {
  return (
    "0xa9059cbb" +
    to.replace(/^0x/, "").toLowerCase().padStart(64, "0") +
    amount.toString(16).padStart(64, "0")
  );
}

function payload(over: Partial<EvmChainPayload> = {}): EvmChainPayload {
  return {
    chainId: 42161,
    nonce: 7,
    gasLimit: "120000",
    maxFeePerGas: "50000000",
    maxPriorityFeePerGas: "1000000",
    to: USDC_ARBITRUM,
    value: "0",
    data: transferCalldata(ALICE, 10_000_000n),
    ...over,
  };
}

function input(over: Record<string, unknown> = {}) {
  return {
    userId: "u1",
    walletId: WALLET,
    deviceId: DEVICE,
    appInstanceId: INSTANCE,
    action: "transfer" as const,
    chain: "arbitrum",
    assetId: "USDC.arbitrum",
    amountMinor: "10000000",
    destination: ALICE,
    payload: payload(),
    ...over,
  };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("prepare binds the transaction bytes into the intent", () => {
  it("folds the payload digest into the canonical digest", async () => {
    // Without this the boundary binds a DESCRIPTION while the bytes stay free.
    const r = await prepareProposal(input(), NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.proposal!.intent.chainPayloadDigest).toBe(chainPayloadDigest(r.proposal!.payload));
    expect(r.proposal!.canonicalDigest).toBe(intentDigest(r.proposal!.intent));
  });

  it("produces a different digest for a different transaction", async () => {
    const a = await prepareProposal(input(), NOW);
    const b = await prepareProposal(
      input({ payload: payload({ data: transferCalldata(MALLORY, 10_000_000n) }) , destination: MALLORY}),
      NOW
    );
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.proposal!.canonicalDigest).not.toBe(b.proposal!.canonicalDigest);
    }
  });

  it("issues a SERVER nonce, not one the client chose", async () => {
    // A client-chosen nonce is not anti-replay.
    const a = await prepareProposal(input(), NOW);
    const b = await prepareProposal(input(), NOW);
    if (!a.ok || !b.ok) throw new Error("setup");
    expect(a.proposal!.intent.nonce).not.toBe(b.proposal!.intent.nonce);
    expect(a.proposal!.intent.nonce).toMatch(/^[0-9a-f]{32}$/);
  });

  it("starts at version 1 and status prepared — nothing is authorised yet", async () => {
    const r = await prepareProposal(input(), NOW);
    if (!r.ok) throw new Error("setup");
    expect(r.proposal!.version).toBe(1);
    expect(r.proposal!.status).toBe("prepared");
    expect(r.proposal!.confirmation).toBeNull();
  });
});

describe("THE ATTACK: a lying description is refused at prepare", () => {
  it("BLOCKS a small declared amount next to large calldata", async () => {
    // `amountMinor: "1"` passes every budget; the calldata moves 10 USDC.
    const r = await prepareProposal(input({ amountMinor: "1" }), NOW);
    expect(r.ok).toBe(false);
    expect(r.refusals).toContain("payload_amount_mismatch");
  });

  it("BLOCKS a declared recipient the calldata does not pay", async () => {
    const r = await prepareProposal(input({ destination: MALLORY }), NOW);
    expect(r.refusals).toContain("payload_recipient_mismatch");
  });

  it("BLOCKS a lookalike token contract", async () => {
    const r = await prepareProposal(input({ payload: payload({ to: MALLORY }) }), NOW);
    expect(r.refusals).toContain("payload_token_mismatch");
  });

  it("BLOCKS a chain that is not the intent's settlement domain", async () => {
    const r = await prepareProposal(input({ chain: "base" }), NOW);
    expect(r.refusals).toContain("payload_chain_mismatch");
  });

  it("BLOCKS an approval whose spender the calldata does not grant", async () => {
    const r = await prepareProposal(
      input({
        action: "approve",
        spender: MALLORY,
        amountMinor: "5",
        payload: payload({
          data:
            "0x095ea7b3" +
            SPENDER.slice(2).toLowerCase().padStart(64, "0") +
            (5n).toString(16).padStart(64, "0"),
        }),
      }),
      NOW
    );
    expect(r.refusals).toContain("payload_spender_mismatch");
  });

  it("STORES NOTHING when it refuses", async () => {
    // A refused proposal that lingered would be a digest an attacker could
    // point a later authorization at.
    const r = await prepareProposal(input({ amountMinor: "1" }), NOW);
    expect(r.ok).toBe(false);
    expect(r.proposal).toBeUndefined();
  });

  it("refuses a malformed payload rather than throwing", async () => {
    const r = await prepareProposal(input({ payload: payload({ gasLimit: "0" }) }), NOW);
    expect(r.ok).toBe(false);
    expect(r.refusals).toContain("intent_invalid");
  });
});

describe("versioning is the TOCTOU guard", () => {
  async function prepared() {
    const r = await prepareProposal(input(), NOW);
    if (!r.ok) throw new Error("setup");
    return r.proposal!;
  }

  it("bumps the version on every mutation", async () => {
    const p = await prepared();
    const a = await updateProposal(p, { simulation: null }, NOW);
    const b = await updateProposal(a, { status: "authorized" }, NOW);
    expect(a.version).toBe(2);
    expect(b.version).toBe(3);
  });

  it("persists the bumped version, so a later read sees it", async () => {
    // An authorization freezes the version it was minted under; if the store
    // still held the old one the TOCTOU check would compare stale to stale.
    const p = await prepared();
    await updateProposal(p, { status: "authorized" }, NOW);
    expect((await getProposal(p.intentId))!.version).toBe(2);
  });

  it("never changes the digest or the payload on mutation", async () => {
    // What was authorised must not move. A mutation that could change the
    // payload would make the frozen version meaningless.
    const p = await prepared();
    const after = await updateProposal(p, { status: "authorized" }, NOW);
    expect(after.canonicalDigest).toBe(p.canonicalDigest);
    expect(after.payload).toEqual(p.payload);
    expect(after.intent).toEqual(p.intent);
  });
});

describe("ownership is re-checked on every read", () => {
  async function prepared() {
    const r = await prepareProposal(input(), NOW);
    if (!r.ok) throw new Error("setup");
    return r.proposal!;
  }

  it("loads for the owning user, device and instance", async () => {
    const p = await prepared();
    const loaded = await loadOwnedProposal({
      intentId: p.intentId,
      userId: "u1",
      deviceId: DEVICE,
      appInstanceId: INSTANCE,
      now: NOW,
    });
    expect(loaded.ok).toBe(true);
  });

  it("BLOCKS another user, another device and another instance", async () => {
    // An unguessable id is not an unforgeable one, and an id that leaks into a
    // log or a screenshot must not become an authorisation.
    const p = await prepared();
    const cases = [
      { userId: "u2", deviceId: DEVICE, appInstanceId: INSTANCE },
      { userId: "u1", deviceId: "dev_" + "9".repeat(32), appInstanceId: INSTANCE },
      { userId: "u1", deviceId: DEVICE, appInstanceId: "inst_" + "9".repeat(32) },
    ];
    for (const over of cases) {
      const loaded = await loadOwnedProposal({ intentId: p.intentId, now: NOW, ...over });
      expect(loaded.ok, JSON.stringify(over)).toBe(false);
      if (!loaded.ok) expect(loaded.reason).toBe("not_owned");
    }
  });

  it("BLOCKS an expired proposal", async () => {
    const p = await prepared();
    const loaded = await loadOwnedProposal({
      intentId: p.intentId,
      userId: "u1",
      deviceId: DEVICE,
      appInstanceId: INSTANCE,
      now: NOW + PROPOSAL_TTL_MS + 1_000,
    });
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) expect(loaded.reason).toBe("expired");
  });

  it("BLOCKS a SIGNED proposal — one approval must not become two payments", async () => {
    const p = await prepared();
    await updateProposal(p, { status: "signed" }, NOW);
    const loaded = await loadOwnedProposal({
      intentId: p.intentId,
      userId: "u1",
      deviceId: DEVICE,
      appInstanceId: INSTANCE,
      now: NOW,
    });
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) expect(loaded.reason).toBe("not_pending");
  });

  it("BLOCKS a VOID proposal", async () => {
    const p = await prepared();
    await updateProposal(p, { status: "void" }, NOW);
    const loaded = await loadOwnedProposal({
      intentId: p.intentId,
      userId: "u1",
      deviceId: DEVICE,
      appInstanceId: INSTANCE,
      now: NOW,
    });
    expect(loaded.ok).toBe(false);
  });

  it("BLOCKS an unknown id", async () => {
    const loaded = await loadOwnedProposal({
      intentId: "itx_" + "0".repeat(32),
      userId: "u1",
      deviceId: DEVICE,
      appInstanceId: INSTANCE,
      now: NOW,
    });
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) expect(loaded.reason).toBe("not_found");
  });
});

describe("simulation is honest about having checked nothing", () => {
  it("NEVER returns 'clean' with no provider configured", async () => {
    // A control that reports success without doing the work is worse than no
    // control: it silences the warning that would otherwise be shown.
    const r = await prepareProposal(input(), NOW);
    if (!r.ok) throw new Error("setup");
    const sim = await simulate({
      intent: r.proposal!.intent,
      payload: r.proposal!.payload,
      digest: r.proposal!.canonicalDigest,
      now: NOW,
    });
    expect(sim.outcome).not.toBe("clean");
    expect(sim.boundDigest).toBe(r.proposal!.canonicalDigest);
  });

  it("WARNS on an unlimited approval, and says the check was partial", async () => {
    const approvePayload = payload({
      data:
        "0x095ea7b3" +
        SPENDER.slice(2).toLowerCase().padStart(64, "0") +
        ((1n << 256n) - 1n).toString(16).padStart(64, "0"),
    });
    const r = await prepareProposal(
      input({
        action: "approve",
        spender: SPENDER,
        amountMinor: ((1n << 256n) - 1n).toString(),
        payload: approvePayload,
      }),
      NOW
    );
    if (!r.ok) throw new Error(`setup: ${r.refusals.join(",")}`);

    const sim = await simulate({
      intent: r.proposal!.intent,
      payload: r.proposal!.payload,
      digest: r.proposal!.canonicalDigest,
      now: NOW,
    });
    expect(sim.outcome).toBe("warning");
    expect(sim.approval?.unlimited).toBe(true);
    // Said explicitly, so a warning is never mistaken for a full check.
    expect(sim.warnings.join(" ")).toMatch(/no external simulation provider/i);
  });

  it("treats a near-max allowance as unlimited too", async () => {
    // Some routers request 2^255 specifically so a naive `=== MAX` check reads
    // it as bounded.
    const amount = (1n << 255n) + 1n;
    const r = await prepareProposal(
      input({
        action: "approve",
        spender: SPENDER,
        amountMinor: amount.toString(),
        payload: payload({
          data:
            "0x095ea7b3" +
            SPENDER.slice(2).toLowerCase().padStart(64, "0") +
            amount.toString(16).padStart(64, "0"),
        }),
      }),
      NOW
    );
    if (!r.ok) throw new Error(`setup: ${r.refusals.join(",")}`);
    const sim = await simulate({
      intent: r.proposal!.intent,
      payload: r.proposal!.payload,
      digest: r.proposal!.canonicalDigest,
      now: NOW,
    });
    expect(sim.approval?.unlimited).toBe(true);
  });

  it("reports an approval as moving nothing today", async () => {
    // An approval grants; it does not transfer. Reporting a delta would
    // overstate what happens now and understate what is being granted.
    const r = await prepareProposal(
      input({
        action: "approve",
        spender: SPENDER,
        amountMinor: "5",
        payload: payload({
          data:
            "0x095ea7b3" +
            SPENDER.slice(2).toLowerCase().padStart(64, "0") +
            (5n).toString(16).padStart(64, "0"),
        }),
      }),
      NOW
    );
    if (!r.ok) throw new Error("setup");
    const sim = await simulate({
      intent: r.proposal!.intent,
      payload: r.proposal!.payload,
      digest: r.proposal!.canonicalDigest,
      now: NOW,
    });
    expect(sim.assetChanges).toEqual([]);
  });
});
