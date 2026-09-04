import { requiredConfirmations } from "@furlpay/gateway";
import type { FacilitatorClient, FacilitatorRequest, SettleResult, VerifyResult, SupportedKind } from "@furlpay/gateway";

// ---------------------------------------------------------------------------
// A DETERMINISTIC TEST RAIL. This is not a blockchain.
//
// READ THIS BEFORE USING IT FOR ANYTHING. It settles nothing. No money moves.
// It exists so the CONTROL PLANE — identity, policy, budget reservation,
// payment intent, ledger, audit, revocation — can be demonstrated end to end
// without a funded wallet.
//
// THE ONE THING IT MUST NEVER DO is emit something that looks like a Solana
// signature. A base58 blob of the right length in a receipt is indistinguishable
// from a real one to every downstream reader — a log, a CSV export, an
// accountant — and that is how a demo becomes a false financial record.
//
// So every reference it produces is prefixed `TESTRAIL-`, which is not valid
// base58 and cannot be mistaken for chain evidence by anything, including a
// careless human.
//
// The real rail is @furlpay/solana-rpc plus a real facilitator. Point
// FURLPAY_FACILITATOR at one and this file is not loaded.
// ---------------------------------------------------------------------------

export interface TestRailOptions {
  network: string;
  /** Force verification to fail, for the rejection path. */
  rejectAll?: boolean;
  /** Simulate an RPC that never answers — the PAYMENT_UNKNOWN case. */
  settleTimesOut?: boolean;
}

export class TestPaymentRail implements FacilitatorClient {
  private readonly opts: TestRailOptions;
  private seq = 0;
  /** Signatures already settled, so a replayed payload is visibly a replay. */
  readonly settled = new Set<string>();

  constructor(opts: TestRailOptions) {
    this.opts = opts;
  }

  async verify(req: FacilitatorRequest): Promise<VerifyResult> {
    const payer = payerOf(req);
    if (this.opts.rejectAll) {
      return { isValid: false, payer, invalidReason: "test_rail_rejected", invalidMessage: "The test rail was configured to reject this payment." };
    }
    if (!payer) {
      return { isValid: false, invalidReason: "no_payer", invalidMessage: "Payment payload carried no payer." };
    }
    return { isValid: true, payer };
  }

  async settle(req: FacilitatorRequest): Promise<SettleResult> {
    const payer = payerOf(req);

    if (this.opts.settleTimesOut) {
      // Deliberately a THROW, not `{ success: false }`. A timeout is not
      // evidence of failure — it is the absence of evidence — and the gateway
      // must treat the two differently. Returning success:false here would
      // teach the demo the exact lie this system exists to prevent.
      throw new Error("ETIMEDOUT: facilitator did not respond");
    }

    // Not base58. Nothing downstream can mistake this for chain evidence.
    const reference = `TESTRAIL-${String(++this.seq).padStart(6, "0")}`;
    this.settled.add(reference);

    // The gateway scales required confirmations with the amount, and refuses
    // a settlement that reports fewer. This rail settles instantly and
    // deterministically, so it genuinely has as many as are asked for — read
    // from the gateway's own function rather than hardcoded, so the two can
    // never disagree about what "confirmed" means for a given amount.
    const amount = amountOf(req) ?? "0";
    const needed = requiredConfirmations(amount);
    return {
      success: true,
      transaction: reference,
      network: this.opts.network,
      payer,
      amount,
      confirmations: needed,
      requiredConfirmations: needed,
    };
  }

  async supported(): Promise<SupportedKind[]> {
    return [{ x402Version: 1, scheme: "exact", network: this.opts.network }];
  }
}

function payerOf(req: FacilitatorRequest): string | undefined {
  const p = req.paymentPayload as { payload?: { authorization?: { from?: string } } } | undefined;
  return p?.payload?.authorization?.from;
}

function amountOf(req: FacilitatorRequest): string | undefined {
  const p = req.paymentPayload as { payload?: { authorization?: { value?: string } } } | undefined;
  return p?.payload?.authorization?.value;
}
