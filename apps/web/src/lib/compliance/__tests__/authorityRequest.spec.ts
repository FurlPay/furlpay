import { describe, expect, it } from "vitest";
import {
  createAuthorityRequest,
  recordAgencyVerification,
  stageDisclosureBundle,
  approveAuthorityDisclosure,
  retrieveDisclosurePackage,
  verifyAuditChain,
  generateSanitizedDisclosurePackage,
} from "../authorityRequest";
import type { UserAccount } from "@/lib/store";

const mockAccount: UserAccount = {
  user: {
    id: "usr_target_revolut_test",
    name: "Target Whale",
    email: "whale@example.com",
    phone: "+15550199999",
    phoneVerified: true,
    safeAddress: "0x1234567890123456789012345678901234567890",
    kycStatus: "verified",
    kycTier: 2,
    region: "EEA",
    taxResidency: "IT",
    tier: "Pro",
    roles: ["user"],
    security: {
      biometricEnabled: true,
      accountLocked: false,
      lastLogin: "2026-09-20T10:00:00Z",
      loginAlerts: true,
      totpEnabled: true,
      totpSecret: "JBSWY3DPEHPK3PXP", // HIGHLY SENSITIVE SECRET
      devices: [
        {
          name: "iPhone 15 Pro",
          location: "Milan, Italy",
          lastActive: "2026-09-26T12:00:00Z",
          current: true,
        },
      ],
      hardwareKeys: [],
    },
    notifications: {
      transactions: true,
      security: true,
      priceAlerts: false,
      product: false,
    },
  },
  tokenBalances: [],
  fiatBalances: [],
  transactions: [
    {
      id: "tx_1001",
      userId: "usr_target_revolut_test",
      amountUsd: 50000,
      timestamp: "2026-09-21T14:30:00Z",
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

describe("Sovereign Authority Gate (LERS) — Anti-Revolut EDR Attack Defense", () => {
  it("creates a submitted request with genesis audit block", async () => {
    const req = await createAuthorityRequest({
      agencyName: "Guardia di Finanza (Compromised Impersonation Test)",
      agencyCountry: "IT",
      jurisdiction: "Lombardy",
      officialEmail: "ufficio.antifrode@gdf.it",
      officerName: "Capitano Rossi",
      badgeId: "IT-GDF-9982",
      docketNumber: "PROC-2026-8812",
      statutoryBasis: "emergency_data_request",
      emergencyDeclaration: "Immediate danger to life reported",
      targetType: "email",
      targetIdentifier: "whale@example.com",
    });

    expect(req.id).toMatch(/^req_/);
    expect(req.status).toBe("submitted");
    expect(req.auditChain.length).toBe(1);
    expect(req.auditChain[0].action).toBe("REQUEST_SUBMITTED");
    expect(verifyAuditChain(req.auditChain)).toBe(true);
  });

  it("strictly REFUSES staging before out-of-band verification is recorded", async () => {
    const req = await createAuthorityRequest({
      agencyName: "Italian Judicial Police",
      agencyCountry: "IT",
      jurisdiction: "Rome",
      officialEmail: "police@it-judicial.gov",
      officerName: "Officer Bianchi",
      badgeId: "IT-8821",
      docketNumber: "DOC-2026-11",
      statutoryBasis: "emergency_data_request",
      emergencyDeclaration: "Affirmation of imminent danger to life in Rome dispatch",
      targetType: "email",
      targetIdentifier: "whale@example.com",
    });

    await expect(
      stageDisclosureBundle(
        req.id,
        { id: "officer_alice", role: "compliance_officer" },
        {
          categories: ["basic_subscriber"],
          justification: "EDR citation",
        },
        mockAccount
      )
    ).rejects.toThrow("Request must complete out-of-band agency verification before staging disclosure.");
  });

  it("enforces mandatory directory callback information during out-of-band verification", async () => {
    const req = await createAuthorityRequest({
      agencyName: "National Crime Agency",
      agencyCountry: "GB",
      jurisdiction: "London",
      officialEmail: "intel@nca.gov.uk",
      officerName: "DI Miller",
      badgeId: "NCA-4421",
      docketNumber: "WAR-2026-90",
      statutoryBasis: "court_order",
      targetType: "email",
      targetIdentifier: "whale@example.com",
    });

    // Attempting verification without an independent contact number fails
    await expect(
      recordAgencyVerification(
        req.id,
        { id: "verifier_charlie", role: "compliance_officer" },
        {
          method: "agency_switchboard_callback",
          contactNumberUsed: "",
          officialReference: "REF-001",
          notes: "Attempted email only",
        }
      )
    ).rejects.toThrow("Independent out-of-band contact directory verification is mandatory.");

    // Valid out-of-band verification succeeds
    const verified = await recordAgencyVerification(
      req.id,
      { id: "verifier_charlie", role: "compliance_officer" },
      {
        method: "agency_switchboard_callback",
        contactNumberUsed: "+44 20 7979 0000 (UK Gov Registry Switchboard)",
        officialReference: "NCA-DISPATCH-9912",
        notes: "Called switchboard operator, confirmed badge and warrant docket directly.",
      }
    );

    expect(verified.status).toBe("agency_verified");
    expect(verified.auditChain.length).toBe(2);
    expect(verifyAuditChain(verified.auditChain)).toBe(true);
  });

  it("enforces strict data minimization: never leaks raw KYC files, passwords, or TOTP secrets", () => {
    const pkg = generateSanitizedDisclosurePackage(
      "req_test_min",
      mockAccount,
      {
        categories: ["basic_subscriber", "kyc_summary", "transaction_records", "ip_login_history"],
        justification: "Subpoena response",
      }
    );

    // Basic subscriber has masked email
    expect(pkg.subscriber).toBeDefined();
    expect(pkg.subscriber?.emailMasked).toBe("wh***@example.com");

    // KYC summary contains status/tier/country only — NO raw files
    expect(pkg.kycSummary).toBeDefined();
    expect(pkg.kycSummary?.verified).toBe(true);
    expect(pkg.kycSummary?.country).toBe("IT");
    expect((pkg.kycSummary as any).passportImage).toBeUndefined();
    expect((pkg.kycSummary as any).selfie).toBeUndefined();

    // Absolute zero credential or secret leakage
    const serialized = JSON.stringify(pkg);
    expect(serialized).not.toContain("JBSWY3DPEHPK3PXP"); // totpSecret never present
    expect(serialized).not.toContain("0x1234567890123456789012345678901234567890"); // raw safeAddress not in basic subscriber

    // Transactions are sanitized to non-internal representation
    expect(pkg.transactions?.length).toBe(1);
    expect(pkg.transactions![0].amountUsd).toBe(50000);
  });

  it("strictly BLOCKS dual-control violation when stager === approver", async () => {
    const req = await createAuthorityRequest({
      agencyName: "Federal Police",
      agencyCountry: "DE",
      jurisdiction: "Berlin",
      officialEmail: "bka@bka.bund.de",
      officerName: "Insp. Mueller",
      badgeId: "BKA-5501",
      docketNumber: "DE-2026-441",
      statutoryBasis: "search_warrant",
      targetType: "email",
      targetIdentifier: "whale@example.com",
    });

    await recordAgencyVerification(
      req.id,
      { id: "officer_alice", role: "compliance_officer" },
      {
        method: "agency_switchboard_callback",
        contactNumberUsed: "+49 30 186660",
        officialReference: "BKA-REF-10",
        notes: "Verified with BKA central dispatch",
      }
    );

    await stageDisclosureBundle(
      req.id,
      { id: "officer_alice", role: "compliance_officer" },
      {
        categories: ["basic_subscriber"],
        justification: "Court order warrant execution",
      },
      mockAccount
    );

    // OFFICER ALICE CANNOT APPROVE HER OWN STAGED BUNDLE (Two-Person Integrity)
    await expect(
      approveAuthorityDisclosure(req.id, { id: "officer_alice", role: "compliance_officer" })
    ).rejects.toThrow("Dual-control invariant violation");
  });

  it("completes legitimate two-person approval and single-use token redemption", async () => {
    const req = await createAuthorityRequest({
      agencyName: "Federal Bureau of Investigation",
      agencyCountry: "US",
      jurisdiction: "SDNY",
      officialEmail: "special_agent@fbi.gov",
      officerName: "SA John Davis",
      badgeId: "FBI-8902",
      docketNumber: "SDNY-2026-CR-991",
      statutoryBasis: "court_order",
      targetType: "email",
      targetIdentifier: "whale@example.com",
    });

    await recordAgencyVerification(
      req.id,
      { id: "officer_alice", role: "compliance_officer" },
      {
        method: "agency_switchboard_callback",
        contactNumberUsed: "+1 212-384-1000 (SDNY Field Office)",
        officialReference: "SDNY-EDR-VERIF-99",
        notes: "Direct callback to Field Supervisor",
      }
    );

    await stageDisclosureBundle(
      req.id,
      { id: "officer_alice", role: "compliance_officer" },
      {
        categories: ["basic_subscriber", "transaction_records"],
        justification: "Grand jury subpoena scope",
      },
      mockAccount
    );

    // Officer Bob approves (Two-Person Integrity satisfied)
    const { request: approved, rawDisclosureToken } = await approveAuthorityDisclosure(req.id, {
      id: "officer_bob",
      role: "admin",
    });

    expect(approved.status).toBe("approved");
    expect(approved.stagedBy).toBe("officer_alice");
    expect(approved.approvedBy).toBe("officer_bob");
    expect(rawDisclosureToken).toMatch(/^dkl_/);

    // Retrieve disclosure package with token
    const pkg = await retrieveDisclosurePackage(req.id, rawDisclosureToken);
    expect(pkg.subscriber?.name).toBe("Target Whale");

    // Single-use enforcement: immediate subsequent redemption MUST fail
    await expect(retrieveDisclosurePackage(req.id, rawDisclosureToken)).rejects.toThrow(
      "Package not in approved state"
    );

    // Tampered token fails
    await expect(retrieveDisclosurePackage(req.id, "dkl_invalidtokenhex")).rejects.toThrow();

    // Verify cryptographic audit block chain
    expect(verifyAuditChain(approved.auditChain)).toBe(true);
  });

  it("detects cryptographic tampering in the audit chain", async () => {
    const req = await createAuthorityRequest({
      agencyName: "Europol",
      agencyCountry: "NL",
      jurisdiction: "The Hague",
      officialEmail: "operations@europol.europa.eu",
      officerName: "Officer Van Der Meer",
      badgeId: "EUR-102",
      docketNumber: "EUR-2026-44",
      statutoryBasis: "mutual_legal_assistance_treaty",
      targetType: "email",
      targetIdentifier: "whale@example.com",
    });

    expect(verifyAuditChain(req.auditChain)).toBe(true);

    // Tamper with actorId in the block
    const tampered = JSON.parse(JSON.stringify(req.auditChain));
    tampered[0].actorId = "malicious_actor";

    expect(verifyAuditChain(tampered)).toBe(false);

    // Tamper with payload hash
    const tamperedPayload = JSON.parse(JSON.stringify(req.auditChain));
    tamperedPayload[0].payloadHash = "0".repeat(64);
    expect(verifyAuditChain(tamperedPayload)).toBe(false);
  });
});
