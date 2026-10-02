// ---------------------------------------------------------------------------
// Bank-account verification, provider-agnostic.
//
// NO PARTNER IS SELECTED. This file is the seam a micro-deposit / account-
// validation partner plugs into; `activeVerifier()` returns null until one is
// wired, and every caller treats null as "cannot verify" — the add-account
// route refuses before reading any account number, and an unverified account
// can never receive a payout. `stubVerifier` exists so the interface has a
// compile-checked implementation; it refuses every call and is never returned
// by `activeVerifier()`. It does not pretend to verify anything.
//
// THE FLOW a real partner implements:
//   1. initiateMicroDeposit  → two small deposits sent; partner returns refId
//   2. the user reads the two amounts on their bank statement
//   3. confirmMicroDeposit   → amounts checked, holder name compared with KYC
//   4. getVerificationStatus → for partners that resolve asynchronously
// ---------------------------------------------------------------------------

/** Lifecycle of a bank account FurlPay may pay out to. */
export type BeneficiaryStatus =
  | "pending" //               added, verification not started
  | "micro_deposit_sent" //    test deposits initiated
  | "micro_deposit_failed" //  deposits bounced: the account does not exist / cannot receive
  | "awaiting_confirmation" // deposits landed; the user must confirm the amounts
  | "verified" //              amounts confirmed AND holder name matched KYC
  | "suspended" //             name mismatch or ops hold — a person decides
  | "removed"; //              soft-deleted by the user

/** The fields a verifier needs. Never the stored record, which holds ciphertext. */
export interface VerifiableAccount {
  beneficiaryId: string;
  accountHolderName: string;
  accountNumber: string;
  bankCode: string | null;
  country: string;
  currency: string;
}

export interface BeneficiaryVerifier {
  readonly id: string;
  /** Initiate micro-deposit verification. Returns the partner's reference. */
  initiateMicroDeposit(account: VerifiableAccount): Promise<{ refId: string }>;
  /** Confirm the micro-deposit amounts (minor units) the user received. */
  confirmMicroDeposit(
    refId: string,
    amounts: [number, number]
  ): Promise<{ verified: boolean; nameMatch?: boolean; reason?: string }>;
  /** Check a verification the partner resolves asynchronously. */
  getVerificationStatus(refId: string): Promise<BeneficiaryStatus>;
}

export class VerifierNotConfigured extends Error {
  constructor() {
    super("No bank-account verification partner is configured.");
    this.name = "VerifierNotConfigured";
  }
}

const refuse = async (): Promise<never> => {
  throw new VerifierNotConfigured();
};

/** Compile-checked placeholder. Refuses every call; never returned by activeVerifier(). */
export const stubVerifier: BeneficiaryVerifier = {
  id: "none",
  initiateMicroDeposit: refuse,
  confirmMicroDeposit: refuse,
  getVerificationStatus: refuse,
};

/** The configured verifier, or null. Null today: no partner is integrated. */
export function activeVerifier(): BeneficiaryVerifier | null {
  return null;
}
