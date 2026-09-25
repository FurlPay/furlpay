import { describe, it, expect } from "vitest";
import { chainPayloadDigest, verifyPayloadMatchesIntent, type EvmChainPayload } from "../evmPayload";
import type { CanonicalIntent } from "../canonical";
import { ARC_USDC_ERC20, toErc20Units } from "@/lib/chains/arc";
import { deploymentForAsset } from "@/lib/assets/stablecoins";

// ---------------------------------------------------------------------------
// Arc through the payload verifier — the load-bearing check behind
// /api/transactions/prepare.
//
// WHY ARC NEEDS ITS OWN FILE. Every other chain FurlPay supports shares one
// assumption that the verifier encodes structurally:
//
//     the native coin is NOT a token, and any token has a contract address.
//
// On Ethereum, Arbitrum, Base and Polygon that is simply true — ETH and POL have
// no ERC-20 deployment in the registry, so "empty calldata" and "a token
// transfer" are disjoint cases and can be told apart by whether the intent's
// asset resolves to a deployment.
//
// ON ARC IT IS FALSE. USDC *is* the native coin AND has an ERC-20 interface at
// 0x3600…0000, so one asset is movable two ways, at two precisions:
//
//     native  — 18 decimals, data "0x", amount in `value`
//     ERC-20  —  6 decimals, data transfer(...), amount in calldata
//
// Both move the same USDC. `USDC.arc` is therefore registered ONCE, at the
// canonical 18 decimals (lib/money/money.ts), which means the ERC-20 path needs
// a 10^12 conversion at the boundary and the native path needs none.
//
// These tests pin both paths, and the conversion between them, because the
// failure mode on the ERC-20 side is not a refusal — it is a number that is
// wrong by a factor of a trillion in whichever direction the conversion was
// forgotten.
// ---------------------------------------------------------------------------

const ARC_CHAIN_ID = 5042;
const ALICE = "0x1111111111111111111111111111111111111111";
const MALLORY = "0x2222222222222222222222222222222222222222";

/** $100. 18dp on the native interface, 6dp through ERC-20. */
const HUNDRED_NATIVE = 100_000_000_000_000_000_000n; // 1e20
const HUNDRED_ERC20 = 100_000_000n; // 1e8

function transferCalldata(to: string, amountMinor: bigint): string {
  return (
    "0xa9059cbb" +
    to.replace(/^0x/, "").toLowerCase().padStart(64, "0") +
    amountMinor.toString(16).padStart(64, "0")
  );
}

function arcNativePayload(over: Partial<EvmChainPayload> = {}): EvmChainPayload {
  return {
    chainId: ARC_CHAIN_ID,
    nonce: 3,
    gasLimit: "65000",
    // At or above Arc's 20 Gwei floor. Below it the chain drops the transaction
    // with no receipt, so a payload quoting less is not merely underpriced.
    maxFeePerGas: "20000000000",
    maxPriorityFeePerGas: "1000000000",
    to: ALICE,
    value: HUNDRED_NATIVE.toString(),
    data: "0x",
    ...over,
  };
}

function arcErc20Payload(over: Partial<EvmChainPayload> = {}): EvmChainPayload {
  return {
    chainId: ARC_CHAIN_ID,
    nonce: 3,
    gasLimit: "120000",
    maxFeePerGas: "20000000000",
    maxPriorityFeePerGas: "1000000000",
    to: ARC_USDC_ERC20.toLowerCase(),
    value: "0",
    data: transferCalldata(ALICE, HUNDRED_ERC20),
    ...over,
  };
}

function arcIntent(p: EvmChainPayload, over: Partial<CanonicalIntent> = {}): CanonicalIntent {
  return {
    action: "transfer",
    intentId: "itx_" + "a".repeat(32),
    accountId: "0x9999999999999999999999999999999999999999",
    chain: "arc",
    assetId: "USDC.arc",
    // CANONICAL 18dp, because that is how USDC.arc is registered. The ERC-20
    // path has to convert; the intent never carries a 6dp Arc amount.
    amountMinor: HUNDRED_NATIVE.toString(),
    destination: ALICE,
    chainPayloadDigest: chainPayloadDigest(p),
    nonce: "b".repeat(32),
    issuedAt: 1_757_000_000_000,
    expiresAt: 1_757_000_600_000,
    ...over,
  };
}

describe("Arc native transfers — the native coin IS the asset", () => {
  it("accepts a native Arc USDC transfer whose value matches the 18dp intent", () => {
    const p = arcNativePayload();
    const result = verifyPayloadMatchesIntent(arcIntent(p), p);
    expect(result.refusals).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("REFUSES a native transfer to the wrong recipient", () => {
    // The substitution that matters most: correct amount, attacker's address.
    const p = arcNativePayload({ to: MALLORY });
    const intent = arcIntent(p, { destination: ALICE });
    expect(verifyPayloadMatchesIntent(intent, p).refusals).toContain("payload_recipient_mismatch");
  });

  it("REFUSES a native transfer whose value disagrees with the intent", () => {
    const p = arcNativePayload({ value: (HUNDRED_NATIVE * 2n).toString() });
    expect(verifyPayloadMatchesIntent(arcIntent(p), p).refusals).toContain(
      "payload_amount_mismatch"
    );
  });

  it("REFUSES a 6dp amount presented as a native value — the 10^12 trap", () => {
    // The whole hazard in one case. A payload sending 1e8 wei against an intent
    // for $100 is paying 0.0000000001 USDC. It must not pass, and the reason it
    // does not is that the intent carries the canonical 18dp figure so the
    // comparison is like-for-like.
    const p = arcNativePayload({ value: HUNDRED_ERC20.toString() });
    const intent = arcIntent(p, { amountMinor: HUNDRED_NATIVE.toString() });
    expect(verifyPayloadMatchesIntent(intent, p).refusals).toContain("payload_amount_mismatch");
  });

  it("REFUSES an Arc payload against a non-Arc intent chain", () => {
    // chainId 5042 with `chain: "arbitrum"` would settle a different asset on a
    // different network to an address that may belong to someone else.
    const p = arcNativePayload();
    const intent = arcIntent(p, { chain: "arbitrum", assetId: "USDC.arbitrum" });
    expect(verifyPayloadMatchesIntent(intent, p).refusals).toContain("payload_chain_mismatch");
  });

  it("REFUSES an Arc intent carried by a payload for another chain", () => {
    // The mirror image, and the one a copy-pasted payload produces.
    const p = arcNativePayload({ chainId: 42161 });
    expect(verifyPayloadMatchesIntent(arcIntent(p), p).refusals).toContain(
      "payload_chain_mismatch"
    );
  });
});

describe("Arc ERC-20 transfers — same asset, 6 decimals", () => {
  it("accepts a transfer through the ERC-20 interface, converting 18dp -> 6dp", () => {
    // The conversion is the point. The intent says 1e20 (18dp); the calldata
    // says 1e8 (6dp); they describe the SAME $100 and must be accepted as equal.
    const p = arcErc20Payload();
    const result = verifyPayloadMatchesIntent(arcIntent(p), p);
    expect(result.refusals).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("holds the conversion these tests rely on", () => {
    expect(toErc20Units(HUNDRED_NATIVE)).toBe(HUNDRED_ERC20);
  });

  it("REFUSES an ERC-20 transfer addressed to a lookalike token", () => {
    // Arc's USDC interface is at a fixed precompile-shaped address. Anything
    // else is a different contract, however well-formed the transfer looks.
    const p = arcErc20Payload({ to: MALLORY });
    expect(verifyPayloadMatchesIntent(arcIntent(p), p).refusals).toContain(
      "payload_token_mismatch"
    );
  });

  it("REFUSES an ERC-20 amount that is the UNCONVERTED 18dp figure", () => {
    // The forgotten-conversion bug in its most dangerous direction: calldata
    // moving 1e20 base units through a 6-decimal interface is 100 TRILLION USDC,
    // not 100. If this were accepted the payer would be debited to the limit of
    // their balance and allowance.
    const p = arcErc20Payload({ data: transferCalldata(ALICE, HUNDRED_NATIVE) });
    expect(verifyPayloadMatchesIntent(arcIntent(p), p).refusals).toContain(
      "payload_amount_mismatch"
    );
  });

  it("REFUSES an ERC-20 transfer to the wrong recipient", () => {
    const p = arcErc20Payload({ data: transferCalldata(MALLORY, HUNDRED_ERC20) });
    expect(verifyPayloadMatchesIntent(arcIntent(p), p).refusals).toContain(
      "payload_recipient_mismatch"
    );
  });

  it("REFUSES an ERC-20 transfer that also sends native value", () => {
    // On Arc this is not a curiosity: native value IS USDC, so a token transfer
    // carrying value moves USDC twice while the intent describes one movement.
    const p = arcErc20Payload({ value: HUNDRED_NATIVE.toString() });
    expect(verifyPayloadMatchesIntent(arcIntent(p), p).refusals).toContain(
      "payload_native_value_unexpected"
    );
  });

  it("REFUSES an intent amount that cannot be expressed in 6 decimals", () => {
    // An 18dp intent carrying sub-1e-6 dust cannot be moved exactly through the
    // ERC-20 interface. Truncating would move LESS than the intent authorised
    // and report success, so it is refused rather than rounded.
    const dusty = HUNDRED_NATIVE + 662_379_335_864n;
    const p = arcErc20Payload({ data: transferCalldata(ALICE, toErc20Units(dusty)) });
    const intent = arcIntent(p, { amountMinor: dusty.toString() });
    expect(verifyPayloadMatchesIntent(intent, p).refusals).toContain("payload_amount_mismatch");
  });
});

describe("the registry entry must not change Arc's behaviour", () => {
  it("accepts a native Arc transfer even though USDC.arc now HAS a deployment", () => {
    // THE REGRESSION THIS EXISTS TO PREVENT, and it is not hypothetical.
    //
    // The generic native-transfer rule is "the asset must be the chain's native
    // coin, which has no token deployment". Before `USDC.arc` was added to
    // lib/assets/stablecoins.ts, native Arc transfers passed that rule only
    // because the lookup returned nothing — an accident, not a decision.
    //
    // Adding the registry entry is correct and was always going to happen. On the
    // old code it would have started refusing every native Arc payment with
    // payload_token_mismatch, on a chain where a plain native send is the
    // ordinary way to pay. Arc's own branch is what makes the entry safe.
    const deployment = deploymentForAsset("USDC.arc");
    expect(deployment, "USDC.arc must be registered").toBeDefined();
    expect(deployment!.contractAddress.toLowerCase()).toBe(ARC_USDC_ERC20.toLowerCase());

    const p = arcNativePayload();
    expect(verifyPayloadMatchesIntent(arcIntent(p), p).refusals).toEqual([]);
  });

  it("agrees with lib/chains/arc.ts about the interface address", () => {
    // Two sources naming the same contract. If they ever diverge, one of them is
    // pointing at something that is not Arc's USDC.
    expect(deploymentForAsset("USDC.arc")!.contractAddress.toLowerCase()).toBe(
      ARC_USDC_ERC20.toLowerCase()
    );
  });
});

describe("other chains are unaffected", () => {
  it("still refuses empty calldata for a token asset off Arc", () => {
    // The rule Arc is the exception to. On Arbitrum, USDC cannot move with empty
    // calldata, and that must keep being refused.
    const p: EvmChainPayload = {
      chainId: 42161,
      nonce: 1,
      gasLimit: "65000",
      maxFeePerGas: "50000000",
      maxPriorityFeePerGas: "1000000",
      to: ALICE,
      value: "10000000",
      data: "0x",
    };
    const intent: CanonicalIntent = {
      action: "transfer",
      intentId: "itx_" + "c".repeat(32),
      accountId: "0x9999999999999999999999999999999999999999",
      chain: "arbitrum",
      assetId: "USDC.arbitrum",
      amountMinor: "10000000",
      destination: ALICE,
      chainPayloadDigest: chainPayloadDigest(p),
      nonce: "d".repeat(32),
      issuedAt: 1_757_000_000_000,
      expiresAt: 1_757_000_600_000,
    };
    expect(verifyPayloadMatchesIntent(intent, p).refusals).toContain("payload_token_mismatch");
  });
});
