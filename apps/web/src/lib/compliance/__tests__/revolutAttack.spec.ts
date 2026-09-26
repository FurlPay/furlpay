import { describe, expect, it } from "vitest";
import {
  approveAuthorityDisclosure,
  createAuthorityRequest,
  getAuthorityRequest,
  listAuthorityRequests,
  recordAgencyVerification,
  redactAuthorityRequest,
  rejectAuthorityRequest,
  retrieveDisclosurePackage,
  stageDisclosureBundle,
  verifyAuditChain,
} from "../authorityRequest";
import type { UserAccount } from "@/lib/store";

// ---------------------------------------------------------------------------
// THE REVOLUT SCENARIO, END TO END.
//
// September 2026: attackers did not breach the bank. They compromised a
// legitimate government mailbox and sent Emergency Data Requests that looked
// perfect — real domain, real-looking officer, urgent danger to life. Staff
// released customer dossiers. ~680 customers.
//
// This file plays the attacker, then plays the legitimate authority, against the
// real implementation. The attacker must reach nothing. The legitimate path must
// still work, because a gate that blocks everyone is the gate that gets disabled
// during the next real emergency.
//
//     trusted domain  ≠  trusted sender  ≠  authenticated authority
//                     ≠  authorized request  ≠  legitimate disclosure
//
// Every attacker step below is a real capability someone who owns a government
// mailbox actually has. None of them is a guess about implementation detail.
// ---------------------------------------------------------------------------

const VICTIM_EMAIL = "whale@example.com";

const victim: UserAccount = {
  user: {
    id: "usr_revolut_victim",
    name: "Giulia Ferrari",
    email: VICTIM_EMAIL,
    phone: "+393331234567",
    phoneVerified: true,
    safeAddress: "0xfeed00000000000000000000000000000000beef",
    kycStatus: "verified",
    kycTier: 2,
    region: "EEA",
    taxResidency: "IT",
    tier: "Ultra",
    roles: ["user"],
    security: {
      biometricEnabled: true,
      accountLocked: false,
      lastLogin: "2026-09-20T09:00:00Z",
      loginAlerts: true,
      totpEnabled: true,
      totpSecret: "JBSWY3DPEHPK3PXP",
      devices: [
        { name: "iPhone 17 Pro", location: "Milan, Italy", lastActive: "2026-09-26T12:00:00Z", current: true },
      ],
      hardwareKeys: [],
    },
    notifications: { transactions: true, security: true, priceAlerts: false, product: false },
  },
  tokenBalances: [],
  fiatBalances: [],
  transactions: [
    {
      id: "tx_whale_1",
      userId: "usr_revolut_victim",
      amountUsd: 1_250_000,
      timestamp: "2026-09-22T11:00:00Z",
      status: "COMPLETED",
      direction: "OUTGOING",
      category: "payout",
      token: "USDC",
    },
  ],
  tradeLots: [],
  contacts: [],
  paymentCards: [],
  bills: [],
};

/** Everything an attacker holding a real government mailbox can assert. */
const perfectlyFormedRequest = {
  agencyName: "Polizia di Stato — Servizio Polizia Postale",
  agencyCountry: "IT",
  jurisdiction: "Italy",
  // A REAL, legitimate, currently-compromised government address.
  officialEmail: "sezione.milano@poliziadistato.example.gov",
  officerName: "Isp. Marco Bianchi",
  badgeId: "IT-PS-44821",
  docketNumber: "PROC-2026-RM-88431",
  statutoryBasis: "emergency_data_request" as const,
  emergencyDeclaration:
    "Immediate and ongoing threat to life. Subject is believed to be the victim of an " +
    "active kidnapping and the account is being used to move ransom funds. Delay of even " +
    "a few hours risks irreversible harm. Request made under urgent statutory powers.",
  targetType: "email" as const,
  targetIdentifier: VICTIM_EMAIL,
};

/**
 * Anything the system would be TELLING the attacker, in any form.
 *
 * The target email is deliberately excluded. The attacker typed it into the
 * request as the search term, so finding it echoed back in the record is not a
 * disclosure — it is their own query, and a workflow that could not name who a
 * request is about would not be a workflow. Counting it as a leak made three of
 * these tests fail for a reason that is not a defect, which is worse than not
 * checking: it trains the reader to ignore the assertion.
 *
 * Everything else here is something only FurlPay knows.
 */
function leaksVictimData(payload: unknown): string[] {
  const s = JSON.stringify(payload ?? {});
  const markers: Array<[string, string]> = [
    ["name", "Giulia Ferrari"],
    ["phone", "+393331234567"],
    ["wallet", "0xfeed00000000000000000000000000000000beef"],
    ["totp secret", "JBSWY3DPEHPK3PXP"],
    ["transaction id", "tx_whale_1"],
    ["transaction amount", "1250000"],
    ["device location", "Milan, Italy"],
    ["kyc tier", '"kycTier"'],
    ["account status", '"accountStatus"'],
  ];
  return markers.filter(([, v]) => s.includes(v)).map(([k]) => k);
}

const ATTACKER = { id: "officer_compromised", role: "compliance_officer" as const };
const HONEST_A = { id: "officer_alice", role: "compliance_officer" as const };
const HONEST_B = { id: "officer_bob", role: "compliance_officer" as const };

describe("Scenario A — compromised government mailbox", () => {
  it("submitting a perfect request discloses nothing and confirms nothing", async () => {
    // Step 1. The attacker submits. Note what the response must NOT contain: any
    // hint that the target is even a FurlPay customer. Confirming membership is
    // already a disclosure — it tells a stalker their target banks here.
    const req = await createAuthorityRequest(perfectlyFormedRequest);

    expect(req.status).toBe("submitted");
    expect(leaksVictimData(req)).toEqual([]);
    // The record echoes the attacker's OWN assertions back, which is fine — they
    // wrote them. It must not have resolved anything about the victim.
    expect(req).not.toHaveProperty("disclosurePackage");
  });

  it("a request alone can never be redeemed", async () => {
    // Step 2. The attacker tries the disclosure endpoint directly, with the
    // request id they were just handed and a guessed token.
    const req = await createAuthorityRequest(perfectlyFormedRequest);
    await expect(
      retrieveDisclosurePackage(req.id, `dkl_${"0".repeat(64)}`)
    ).rejects.toThrow();
  });

  it("staging cannot be reached without out-of-band verification", async () => {
    // Step 3. The attacker has a compromised OFFICER account too — the worst
    // case. They try to skip straight to staging the bundle.
    const req = await createAuthorityRequest(perfectlyFormedRequest);
    await expect(
      stageDisclosureBundle(
        req.id,
        ATTACKER,
        { categories: ["basic_subscriber", "transaction_records"], justification: "Urgent EDR." },
        victim
      )
    ).rejects.toThrow(/out-of-band/i);
  });

  it("ONE officer who does everything still reaches no data", async () => {
    // Step 4. THE CORE OF THE ATTACK. The attacker controls one compliance
    // officer account and performs every step themselves: self-attests the
    // agency callback, stages the bundle, and reads the response.
    //
    // This is exactly what happened at Revolut, and it is the path that used to
    // work here — the dossier was on the record that staging returned.
    const req = await createAuthorityRequest(perfectlyFormedRequest);

    await recordAgencyVerification(req.id, ATTACKER, {
      method: "agency_switchboard_callback",
      contactNumberUsed: "+39-02-62261",
      officialReference: "DISPATCH-FAKE-001",
      notes: "Called back and confirmed. (Attacker's own attestation.)",
    });

    const staged = await stageDisclosureBundle(
      req.id,
      ATTACKER,
      {
        categories: ["basic_subscriber", "transaction_records", "kyc_summary", "ip_login_history"],
        justification: "Emergency request — imminent risk to life.",
      },
      victim
    );

    // What the attacker actually receives from their own staging call.
    const seen = redactAuthorityRequest(staged);
    expect(leaksVictimData(seen), "staging response leaked victim data").toEqual([]);
    expect(seen.disclosurePackage).toBeUndefined();

    // And from re-reading the record.
    const reread = await getAuthorityRequest(req.id);
    expect(leaksVictimData(redactAuthorityRequest(reread!))).toEqual([]);

    // And from the console list.
    const all = await listAuthorityRequests();
    expect(leaksVictimData(all), "console list leaked victim data").toEqual([]);
  });

  it("the sole officer cannot approve their own staging", async () => {
    // Step 5. The attacker tries to complete the workflow alone to mint a token.
    const req = await createAuthorityRequest(perfectlyFormedRequest);
    await recordAgencyVerification(req.id, ATTACKER, {
      method: "agency_switchboard_callback",
      contactNumberUsed: "+39-02-62261",
      officialReference: "DISPATCH-FAKE-002",
      notes: "Self-attested.",
    });
    await stageDisclosureBundle(
      req.id,
      ATTACKER,
      { categories: ["basic_subscriber"], justification: "Emergency request." },
      victim
    );

    await expect(approveAuthorityDisclosure(req.id, ATTACKER)).rejects.toThrow(/dual-control/i);
  });

  it("a rejected request leaves nothing behind to recover", async () => {
    // Step 6. An honest reviewer refuses. The attacker must not be able to read
    // what was staged, nor re-stage it.
    const req = await createAuthorityRequest(perfectlyFormedRequest);
    await recordAgencyVerification(req.id, HONEST_A, {
      method: "agency_switchboard_callback",
      contactNumberUsed: "+39-02-62261",
      officialReference: "DISPATCH-REAL-1",
      notes: "Called the number from the published directory.",
    });
    await stageDisclosureBundle(
      req.id,
      HONEST_A,
      { categories: ["basic_subscriber", "transaction_records"], justification: "Under review." },
      victim
    );

    const rejected = await rejectAuthorityRequest(req.id, HONEST_B, "Statutory basis not established.");
    expect(rejected.status).toBe("rejected");
    expect(leaksVictimData(redactAuthorityRequest(rejected))).toEqual([]);

    const after = await getAuthorityRequest(req.id);
    expect(after?.disclosurePackage).toBeUndefined();
    await expect(
      stageDisclosureBundle(
        req.id,
        ATTACKER,
        { categories: ["basic_subscriber"], justification: "Trying again after refusal." },
        victim
      )
    ).rejects.toThrow();
  });
});

describe("the legitimate path still works", () => {
  /** Two real officers, a real callback, a real second signature. */
  async function fullyAuthorized(categories: Parameters<typeof stageDisclosureBundle>[2]["categories"]) {
    const req = await createAuthorityRequest(perfectlyFormedRequest);
    await recordAgencyVerification(req.id, HONEST_A, {
      method: "agency_switchboard_callback",
      contactNumberUsed: "+39-06-46861",
      officialReference: "DISPATCH-REAL-77",
      notes: "Number taken from the independent published directory, not the request.",
    });
    await stageDisclosureBundle(
      req.id,
      HONEST_A,
      { categories, justification: "Verified EDR, scope limited to what was requested." },
      victim
    );
    const { rawDisclosureToken } = await approveAuthorityDisclosure(req.id, HONEST_B);
    return { requestId: req.id, token: rawDisclosureToken };
  }

  it("two officers plus a token release exactly the requested scope", async () => {
    const { requestId, token } = await fullyAuthorized(["basic_subscriber", "transaction_records"]);
    const pkg = await retrieveDisclosurePackage(requestId, token);

    expect(pkg.subscriber?.name).toBe("Giulia Ferrari");
    expect(pkg.transactions).toHaveLength(1);
    // NOT requested, therefore NOT present. Scope is a filter, not a suggestion.
    expect(pkg.kycSummary).toBeUndefined();
    expect(pkg.loginHistory).toBeUndefined();
  });

  it("even an authorized package excludes credentials and the wallet", async () => {
    // Minimum necessary. A statutory request for subscriber records is not a
    // request for the customer's second factor or their on-chain identity —
    // the latter would hand an investigator (or anyone who later obtains the
    // package) a permanent blockchain-to-human correlation.
    const { requestId, token } = await fullyAuthorized([
      "basic_subscriber",
      "transaction_records",
      "kyc_summary",
      "ip_login_history",
    ]);
    const pkg = await retrieveDisclosurePackage(requestId, token);
    const s = JSON.stringify(pkg);

    expect(s).not.toContain("JBSWY3DPEHPK3PXP");
    expect(s).not.toContain("0xfeed00000000000000000000000000000000beef");
    expect(s).not.toContain(VICTIM_EMAIL); // masked, not reproduced
    expect(s).not.toContain("totpSecret");
    expect(s).not.toContain("hardwareKeys");
  });

  it("the token dies on first use and takes the dossier with it", async () => {
    const { requestId, token } = await fullyAuthorized(["basic_subscriber"]);
    await retrieveDisclosurePackage(requestId, token);

    await expect(retrieveDisclosurePackage(requestId, token)).rejects.toThrow();
    const after = await getAuthorityRequest(requestId);
    expect(after?.status).toBe("disclosed");
    expect(after?.disclosurePackage).toBeUndefined();
  });

  it("concurrent redemptions release the package at most once", async () => {
    // §20. Two clients racing the same token must not both receive a dossier.
    // A disclosure link travels by email and gets clicked twice; this is not a
    // theoretical interleaving.
    const { requestId, token } = await fullyAuthorized(["basic_subscriber"]);
    const results = await Promise.allSettled([
      retrieveDisclosurePackage(requestId, token),
      retrieveDisclosurePackage(requestId, token),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("a rejection landing mid-redemption is not overtaken by it", async () => {
    // §20: "rejection cannot race disclosure".
    //
    // The redemption lock serialises redemptions against EACH OTHER, but
    // `rejectAuthorityRequest` does not take it — so a refusal can land between
    // the redeemer's first read and its write. Without re-reading inside the
    // lock, the redeemer would then finish from the pre-rejection copy it is
    // still holding and release a dossier an officer had just refused.
    //
    // A mutation study found this: replacing the in-lock re-read with the stale
    // copy left every other test green, because nothing else exercises a state
    // change arriving mid-redemption.
    const { requestId, token } = await fullyAuthorized(["basic_subscriber", "transaction_records"]);

    // INTERLEAVED, not sequenced. Starting the redemption and only then awaiting
    // the rejection lets the redeemer take its first read while the record still
    // says `approved`, and the rejection commit land before the redeemer writes.
    // Rejecting first would be a different, easier test: the redeemer's own
    // opening status check would catch it and the stale-copy path would never
    // execute.
    const redemption = retrieveDisclosurePackage(requestId, token);
    await rejectAuthorityRequest(requestId, HONEST_B, "Withdrawn by the issuing authority.");

    // Whoever wins, the outcome must be consistent: either the redemption
    // completed before the refusal landed, or it failed. What must NEVER happen
    // is a dossier released from a record that is now `rejected`.
    const outcome = await redemption.then(
      (pkg) => ({ released: true as const, pkg }),
      () => ({ released: false as const })
    );

    const after = await getAuthorityRequest(requestId);
    expect(after?.disclosurePackage, "a refused request kept its dossier").toBeUndefined();

    if (outcome.released) {
      // Legal only if the redemption genuinely finished first — in which case
      // the record moved to `disclosed` and the rejection acted on a spent one.
      expect(after?.status).toBe("rejected");
      expect(
        after?.auditChain.some((b) => b.action === "DISCLOSURE_ACCESSED"),
        "a dossier was released but no access was recorded"
      ).toBe(true);
    } else {
      expect(after?.status).toBe("rejected");
    }
  });

  it("the audit chain survives and still verifies", async () => {
    // The payload is destroyed; the RECORD of what happened is not. That is the
    // asymmetry the whole design rests on — an investigation months later must
    // be able to reconstruct who authorized what without the dossier still
    // sitting there.
    const { requestId, token } = await fullyAuthorized(["basic_subscriber"]);
    await retrieveDisclosurePackage(requestId, token);

    const after = await getAuthorityRequest(requestId);
    expect(verifyAuditChain(after!.auditChain)).toBe(true);

    const actions = after!.auditChain.map((b) => b.action);
    expect(actions).toContain("REQUEST_SUBMITTED");
    expect(actions).toContain("AGENCY_OUT_OF_BAND_VERIFIED");
    expect(actions).toContain("DISCLOSURE_STAGED");
    expect(actions).toContain("DISCLOSURE_APPROVED");
    expect(actions).toContain("DISCLOSURE_ACCESSED");
  });

  it("tampering with the audit chain is detectable", async () => {
    const { requestId, token } = await fullyAuthorized(["basic_subscriber"]);
    await retrieveDisclosurePackage(requestId, token);
    const after = await getAuthorityRequest(requestId);

    // Rewrite history: pretend the attacker's staging was someone else's.
    const tampered = structuredClone(after!.auditChain);
    tampered[2].actorId = "someone_else";
    expect(verifyAuditChain(tampered)).toBe(false);
  });
});
