import { describe, it, expect } from "vitest";
import {
  allowedNextStates,
  assertTransition,
  canTransition,
  isTerminal,
  missingEvidence,
  TransitionError,
  TERMINAL_STATES,
  type FlowKind,
  type TxState,
} from "../lifecycle";

// ---------------------------------------------------------------------------
// The lifecycle guard.
//
// The single property these tests exist for: a provider's HTTP 200 cannot
// become COMPLETED. Everything else is a corollary.
// ---------------------------------------------------------------------------

const REF_CHAIN = { chainTxHash: "0x" + "ab".repeat(32) };
const REF_LEDGER = { ledgerTxId: "txn_1" };
const REF_PROVIDER = { providerRef: "prov_1" };
const REF_BANK = { bankRef: "UTR123456789" };

describe("evidence is structural, not a convention", () => {
  it("refuses SETTLED without a ledger entry", () => {
    // "The provider says the money arrived" is not the same statement as "we
    // wrote it down". A SETTLED with no ledger id is money we cannot account
    // for.
    expect(() => assertTransition("onramp", "SETTLEMENT_PENDING", "SETTLED", {})).toThrow(
      /requires ledgerTxId/
    );
    expect(() =>
      assertTransition("onramp", "SETTLEMENT_PENDING", "SETTLED", REF_LEDGER)
    ).not.toThrow();
  });

  it("refuses CRYPTO_PENDING without a transaction hash", () => {
    expect(() => assertTransition("offramp", "QUOTED", "CRYPTO_PENDING", {})).toThrow(
      /requires chainTxHash/
    );
  });

  it("refuses BANK_PENDING without a bank reference", () => {
    // The UTR/RRN is what an operations desk searches on. A payout leg with no
    // reference cannot be traced, disputed or reconciled.
    expect(() =>
      assertTransition("offramp", "PROVIDER_PENDING", "BANK_PENDING", REF_PROVIDER)
    ).toThrow(/requires bankRef/);
  });

  it("treats blank and whitespace references as absent", () => {
    expect(missingEvidence("COMPLETED", { ledgerTxId: "" })).toEqual(["ledgerTxId"]);
    expect(missingEvidence("COMPLETED", { ledgerTxId: "   " })).toEqual(["ledgerTxId"]);
    expect(missingEvidence("COMPLETED", REF_LEDGER)).toEqual([]);
  });
});

describe("off-ramp: a confirmed chain transaction is not a completed withdrawal", () => {
  it("does NOT allow CRYPTO_CONFIRMED -> COMPLETED", () => {
    // The customer asked for rupees. The chain leg only moved crypto to the
    // provider; nobody has been paid yet. This is the arrow whose absence is
    // the entire point of the off-ramp table.
    expect(canTransition("offramp", "CRYPTO_CONFIRMED", "COMPLETED")).toBe(false);
    expect(() =>
      assertTransition("offramp", "CRYPTO_CONFIRMED", "COMPLETED", { ...REF_LEDGER, ...REF_CHAIN })
    ).toThrow(TransitionError);
  });

  it("routes CRYPTO_CONFIRMED through provider and bank legs", () => {
    expect(allowedNextStates("offramp", "CRYPTO_CONFIRMED")).toContain("PROVIDER_PENDING");
    expect(canTransition("offramp", "PROVIDER_PENDING", "BANK_PENDING")).toBe(true);
    expect(canTransition("offramp", "BANK_PENDING", "COMPLETED")).toBe(true);
  });

  it("permits the whole happy path, in order, with evidence at each step", () => {
    const path: [TxState, TxState, Record<string, string>][] = [
      ["CREATED", "QUOTED", {}],
      ["QUOTED", "CRYPTO_PENDING", REF_CHAIN],
      ["CRYPTO_PENDING", "CRYPTO_CONFIRMED", REF_CHAIN],
      ["CRYPTO_CONFIRMED", "PROVIDER_PENDING", REF_PROVIDER],
      ["PROVIDER_PENDING", "BANK_PENDING", REF_BANK],
      ["BANK_PENDING", "COMPLETED", REF_LEDGER],
    ];
    for (const [from, to, refs] of path) {
      expect(() => assertTransition("offramp", from, to, refs), `${from}->${to}`).not.toThrow();
    }
  });
});

describe("on-ramp: crypto is only sent once the fiat is genuinely ours", () => {
  it("does NOT allow PAYMENT_CONFIRMED -> CRYPTO_PENDING", () => {
    // Confirmation and settlement are different events separated by a
    // settlement cycle, and an inbound credit can still be recalled in between.
    // Sending crypto against a confirmation is spending money we may not have.
    expect(canTransition("onramp", "PAYMENT_CONFIRMED", "CRYPTO_PENDING")).toBe(false);
  });

  it("allows the crypto leg only from SETTLED", () => {
    expect(canTransition("onramp", "SETTLED", "CRYPTO_PENDING")).toBe(true);
  });

  it("keeps REVERSED reachable from the confirmed-but-not-settled gap", () => {
    // This is exactly where a recall lands, so the state machine has to model it.
    expect(canTransition("onramp", "PAYMENT_CONFIRMED", "REVERSED")).toBe(true);
    expect(canTransition("onramp", "SETTLEMENT_PENDING", "REVERSED")).toBe(true);
  });
});

describe("crypto deposits are screened before they are credited", () => {
  it("does not credit straight from CRYPTO_CONFIRMED", () => {
    // A deposit from a sanctioned or mixer-adjacent address is confirmed on
    // chain and must still not reach the customer's spendable balance.
    expect(allowedNextStates("crypto_deposit", "CRYPTO_CONFIRMED")).toContain("COMPLIANCE_REVIEW");
    expect(canTransition("crypto_deposit", "CRYPTO_CONFIRMED", "COMPLETED")).toBe(false);
  });
});

describe("terminal states are history", () => {
  it("refuses to move a FAILED transaction anywhere", () => {
    for (const to of ["COMPLETED", "SETTLED", "CRYPTO_PENDING"] as TxState[]) {
      expect(() => assertTransition("onramp", "FAILED", to, REF_LEDGER)).toThrow(/terminal/);
    }
  });

  it("names every terminal state as terminal", () => {
    for (const state of TERMINAL_STATES) expect(isTerminal(state), state).toBe(true);
    for (const state of ["CREATED", "SETTLED", "CRYPTO_PENDING"] as TxState[]) {
      expect(isTerminal(state), state).toBe(false);
    }
  });

  it("still allows a COMPLETED transaction to be reversed or refunded", () => {
    // A correction is a permitted forward transition with its own evidence,
    // not an edit of the original record.
    expect(() => assertTransition("onramp", "COMPLETED", "REFUNDED", REF_LEDGER)).not.toThrow();
    expect(() => assertTransition("offramp", "COMPLETED", "REVERSED", REF_LEDGER)).not.toThrow();
  });

  it("refuses to un-cancel", () => {
    expect(() => assertTransition("onramp", "CANCELLED", "PAYMENT_PENDING", {})).toThrow(/terminal/);
  });
});

describe("review states block progress and never auto-clear", () => {
  it("cannot reach COMPLETED directly from a review", () => {
    for (const flow of ["onramp", "offramp"] as FlowKind[]) {
      expect(canTransition(flow, "COMPLIANCE_REVIEW", "COMPLETED"), flow).toBe(false);
      expect(canTransition(flow, "MANUAL_REVIEW", "COMPLETED"), flow).toBe(false);
    }
  });

  it("is reachable from every in-flight state that can go wrong", () => {
    const inFlight: TxState[] = ["PAYMENT_PENDING", "SETTLEMENT_PENDING", "CRYPTO_PENDING"];
    for (const state of inFlight) {
      const next = allowedNextStates("onramp", state);
      expect(next.includes("MANUAL_REVIEW") || next.includes("COMPLIANCE_REVIEW"), state).toBe(true);
    }
  });
});

describe("table integrity", () => {
  const flows: FlowKind[] = [
    "onramp",
    "offramp",
    "crypto_deposit",
    "crypto_withdrawal",
    "fiat_deposit",
    "fiat_withdrawal",
    "internal_transfer",
    "card_authorization",
    "refund",
    "chargeback",
  ];

  it("gives every flow a CREATED state with somewhere to go", () => {
    for (const flow of flows) {
      expect(allowedNextStates(flow, "CREATED").length, flow).toBeGreaterThan(0);
    }
  });

  it("lets every flow reach a terminal failure without moving money", () => {
    for (const flow of flows) {
      const next = allowedNextStates(flow, "CREATED");
      expect(next.includes("FAILED") || next.includes("CANCELLED"), flow).toBe(true);
    }
  });

  it("never lets a terminal state lead anywhere except a correction", () => {
    const corrections: TxState[] = ["REVERSED", "REFUNDED"];
    for (const flow of flows) {
      for (const state of TERMINAL_STATES) {
        for (const next of allowedNextStates(flow, state)) {
          expect(corrections, `${flow}: ${state} -> ${next}`).toContain(next);
        }
      }
    }
  });
});
