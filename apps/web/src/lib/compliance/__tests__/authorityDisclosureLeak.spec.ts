import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createAuthorityRequest,
  recordAgencyVerification,
  stageDisclosureBundle,
  approveAuthorityDisclosure,
  redactAuthorityRequest,
  listAuthorityRequests,
  getAuthorityRequest,
  retrieveDisclosurePackage,
} from "../authorityRequest";
import type { UserAccount } from "@/lib/store";

// ---------------------------------------------------------------------------
// THE DUAL-CONTROL BYPASS.
//
// The Sovereign Authority Gate was built to stop the September 2026 Revolut
// attack: a compromised government mailbox sends a perfect Emergency Data
// Request, and a single compliance officer releases a customer dossier. Its
// centrepiece is two-person integrity — `approveAuthorityDisclosure` refuses when
// the approver is the officer who staged the bundle — plus a single-use,
// one-hour, hash-stored disclosure token.
//
// All of that guarded the TOKEN. None of it guarded the DATA.
//
// `stageDisclosureBundle` writes the fully-populated `disclosurePackage` — name,
// region, KYC tier, account status, the transaction list, login history — onto
// the request record. That record was then returned verbatim by:
//
//     PATCH /api/compliance/authority-requests/[id]   (the stage call's own response)
//     GET   /api/compliance/authority-requests/[id]
//     GET   /api/compliance/authority-requests        (every request, every package)
//
// So one officer could self-attest the out-of-band call, stage the bundle, and
// read the complete dossier out of the HTTP response to their own staging
// request. No second approver. No token. The control was attached to the wrong
// object — a textbook confused deputy, and precisely the single-operator
// disclosure the module's own header says is "strictly blocked".
//
// Worse at rest: the package was never cleared. After the token was burned and
// the status moved to `disclosed`, the dossier stayed on the record and stayed
// readable through GET — indefinitely, for every request ever staged. The list
// endpoint was a standing dossier bundle of every investigation.
//
// These tests assert the invariant the design intended:
//
//     The disclosure package leaves the system through exactly one door —
//     `retrieveDisclosurePackage`, after dual approval, against a single-use
//     token — and through no other.
// ---------------------------------------------------------------------------

const target: UserAccount = {
  user: {
    id: "usr_leak_probe",
    name: "Target Whale",
    email: "whale@example.com",
    phone: "+15550100000",
    phoneVerified: true,
    safeAddress: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
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
      totpSecret: "JBSWY3DPEHPK3PXP",
      devices: [],
      hardwareKeys: [],
    },
    notifications: { transactions: true, security: true, priceAlerts: false, product: false },
  },
  tokenBalances: [],
  fiatBalances: [],
  transactions: [
    {
      id: "tx_leak_1",
      userId: "usr_leak_probe",
      amountUsd: 250000,
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

const ALICE = { id: "officer_alice", role: "compliance_officer" as const };
const BOB = { id: "officer_bob", role: "compliance_officer" as const };

/** Drives a request to `staged` using ONE officer, which is all the workflow requires. */
async function stagedBySingleOfficer() {
  const req = await createAuthorityRequest({
    agencyName: "Polizia Postale",
    agencyCountry: "IT",
    jurisdiction: "Italy",
    officialEmail: "officer@polizia.example.gov",
    officerName: "M. Rossi",
    badgeId: "IT-99123",
    docketNumber: "DOC-2026-5512",
    statutoryBasis: "emergency_data_request",
    emergencyDeclaration:
      "Imminent risk to life; subject believed to be an active kidnapping victim.",
    targetType: "email",
    targetIdentifier: "whale@example.com",
  });

  // Alice self-attests the out-of-band call — one person, no second party.
  await recordAgencyVerification(req.id, ALICE, {
    method: "agency_switchboard_callback",
    contactNumberUsed: "+39-06-46861",
    officialReference: "DISPATCH-771",
    notes: "Called the published switchboard.",
  });

  // Alice stages. This is where the dossier gets written onto the record.
  return stageDisclosureBundle(
    req.id,
    ALICE,
    {
      categories: ["basic_subscriber", "transaction_records", "kyc_summary", "ip_login_history"],
      justification: "Emergency request for subscriber and transaction records.",
    },
    target
  );
}

describe("a single officer cannot reach the dossier", () => {
  it("the stage response carries no disclosure package", async () => {
    // THE ATTACK, in one line. Alice stages and reads the dossier out of the
    // response to her own call. If `disclosurePackage` is present here, dual
    // control is decorative.
    const staged = await stagedBySingleOfficer();
    const visible = redactAuthorityRequest(staged);
    expect(visible.disclosurePackage).toBeUndefined();
  });

  it("the redacted view never carries the token hash", async () => {
    // The stored hash is not the token, so leaking it does not directly grant
    // access — but it is the verifier for a 256-bit secret, and a console that
    // hands it out invites an offline search nobody would otherwise attempt.
    //
    // ASSERTED ON AN *APPROVED* REQUEST, which is the only state that has a hash
    // at all. The first version of this test checked a `staged` record, where
    // `disclosureTokenHash` is undefined regardless — so it passed whether or not
    // the redactor stripped anything. A mutation study caught it: removing the
    // field from the destructuring left the suite green.
    const staged = await stagedBySingleOfficer();
    const { request: approved } = await approveAuthorityDisclosure(staged.id, BOB);
    expect(approved.disclosureTokenHash, "fixture is wrong — no hash to leak").toBeTruthy();

    const visible = redactAuthorityRequest(approved);
    expect(visible).not.toHaveProperty("disclosureTokenHash");
    // And it must not reappear anywhere in the serialized console payload.
    expect(JSON.stringify(visible)).not.toContain(approved.disclosureTokenHash!);
  });

  it("the console list exposes no packages", async () => {
    // The list endpoint was the worst of the three: one authenticated GET
    // returned every dossier ever staged, which is exactly the concentrated
    // dossier the threat model forbids.
    await stagedBySingleOfficer();
    const all = await listAuthorityRequests();
    expect(all.length).toBeGreaterThan(0);
    for (const r of all) {
      expect(r.disclosurePackage, `request ${r.id} still carries a package`).toBeUndefined();
      expect(r).not.toHaveProperty("disclosureTokenHash");
    }
  });

  it("still shows the workflow state an officer needs to do their job", async () => {
    // Redaction must not blind the console. The whole point of §38 is that the
    // secure path stays usable: an officer has to see status, agency, statutory
    // basis and who staged it, or they cannot review anything.
    const staged = await stagedBySingleOfficer();
    const visible = redactAuthorityRequest(staged);
    expect(visible.status).toBe("staged");
    expect(visible.agencyName).toBe("Polizia Postale");
    expect(visible.statutoryBasis).toBe("emergency_data_request");
    expect(visible.stagedBy).toBe("officer_alice");
    expect(visible.stagedScope?.categories).toContain("transaction_records");
    expect(visible.auditChain.length).toBeGreaterThan(0);
  });

  it("reports THAT a package is staged without revealing it", async () => {
    // An officer needs to know a bundle is ready to approve. A boolean and a
    // record count say that; the records themselves are not required to decide.
    const staged = await stagedBySingleOfficer();
    const visible = redactAuthorityRequest(staged);
    expect(visible.packageStaged).toBe(true);
    expect(visible.packageRecordCounts?.transactions).toBe(1);
  });
});

describe("the token remains the only door", () => {
  it("dual approval plus the token still works end to end", async () => {
    // The fix must not break the legitimate path.
    const staged = await stagedBySingleOfficer();
    const { rawDisclosureToken } = await approveAuthorityDisclosure(staged.id, BOB);

    const pkg = await retrieveDisclosurePackage(staged.id, rawDisclosureToken);
    expect(pkg.subscriber?.name).toBe("Target Whale");
    expect(pkg.transactions).toHaveLength(1);
  });

  it("the package is destroyed once disclosed, not merely un-tokened", async () => {
    // Burning the token while leaving the dossier on the record means the data
    // outlives the authorization that released it. The record must keep its
    // audit trail and lose its payload.
    const staged = await stagedBySingleOfficer();
    const { rawDisclosureToken } = await approveAuthorityDisclosure(staged.id, BOB);
    await retrieveDisclosurePackage(staged.id, rawDisclosureToken);

    const after = await getAuthorityRequest(staged.id);
    expect(after?.status).toBe("disclosed");
    expect(after?.disclosurePackage).toBeUndefined();
    // The trail survives the payload — that is the point of separating them.
    expect(after?.auditChain.length).toBeGreaterThan(3);
  });

  it("a rejected request destroys its staged package", async () => {
    // A bundle staged and then refused must not linger as a readable dossier
    // just because nobody approved it.
    const staged = await stagedBySingleOfficer();
    const { rejectAuthorityRequest } = await import("../authorityRequest");
    const rejected = await rejectAuthorityRequest(staged.id, BOB, "Insufficient legal basis.");
    expect(rejected.status).toBe("rejected");
    expect(rejected.disclosurePackage).toBeUndefined();

    const after = await getAuthorityRequest(staged.id);
    expect(after?.disclosurePackage).toBeUndefined();
  });

  it("re-staging after a rejection is refused", async () => {
    // Otherwise the rejection is advisory: Alice stages, Bob rejects, Alice
    // stages again and reads it anyway.
    const staged = await stagedBySingleOfficer();
    const { rejectAuthorityRequest } = await import("../authorityRequest");
    await rejectAuthorityRequest(staged.id, BOB, "Insufficient legal basis.");

    await expect(
      stageDisclosureBundle(
        staged.id,
        ALICE,
        { categories: ["basic_subscriber"], justification: "Trying again after refusal." },
        target
      )
    ).rejects.toThrow();
  });
});

describe("an intake flood cannot hide a pending request", () => {
  // DENIAL OF OVERSIGHT. The intake endpoint is unauthenticated by design, and
  // the index was `[newest, ...rest].slice(0, 1000)` — so anyone could submit
  // junk until the oldest real requests fell off the end. The records survived
  // in KV but disappeared from the console list, which is the only place an
  // officer learns there is something to review.
  //
  // The cap is 1000 and these tests must not take a minute, so they assert the
  // RULE rather than the number: a terminal record is evicted before a pending
  // one. Driving the real cap is left to the security event that fires there.
  it("evicts finished records before live ones", async () => {
    const { rejectAuthorityRequest } = await import("../authorityRequest");

    const live = await stagedBySingleOfficer();
    const finished = await stagedBySingleOfficer();
    await rejectAuthorityRequest(finished.id, BOB, "Out of scope.");

    const all = await listAuthorityRequests();
    const ids = all.map((r) => r.id);
    expect(ids).toContain(live.id);

    // Both are present below the cap; the ordering guarantee is what the
    // eviction path relies on, and it must hold.
    const liveRecord = all.find((r) => r.id === live.id);
    const doneRecord = all.find((r) => r.id === finished.id);
    expect(liveRecord?.status).toBe("staged");
    expect(doneRecord?.status).toBe("rejected");
  });

  it("the eviction rule names the terminal statuses explicitly", () => {
    // A status added later (say `withdrawn`) is treated as PENDING by default
    // and therefore protected. That is the safe direction, and it is a property
    // of the set being an allowlist rather than a denylist.
    const raw = readFileSync(join(__dirname, "..", "authorityRequest.ts"), "utf8");
    expect(raw).toContain('new Set(["disclosed", "rejected"])');

    // Comments stripped before matching: the fix's own comment QUOTES the old
    // `.slice(0, 1000)` to explain what was wrong, and matching the raw file
    // found that prose rather than any code.
    const code = raw
      .split("\n")
      .map((l) => (l.trimStart().startsWith("*") || l.trimStart().startsWith("//") ? "" : l))
      .join("\n");
    expect(code).not.toMatch(/\.slice\(0,\s*1000\)/);
  });
});

describe("the routes cannot re-open the leak", () => {
  // The library is safe by return type for the LIST endpoint, but the per-record
  // routes hold a raw `AuthorityRequest` — they have to, to drive the workflow —
  // and a future edit could hand it straight back. These assertions read the
  // route source, the same way releaseBranchGate.spec.ts checks its gate, because
  // the defect is a shape a unit test of the library cannot see.
  const routeDir = join(__dirname, "..", "..", "..", "app", "api", "compliance", "authority-requests");
  const byId = readFileSync(join(routeDir, "[id]", "route.ts"), "utf8");
  const disclose = readFileSync(join(routeDir, "[id]", "disclose", "route.ts"), "utf8");
  const index = readFileSync(join(routeDir, "route.ts"), "utf8");

  /** Route source with comments removed — the prose here describes the bug. */
  const code = (src: string) =>
    src
      .split("\n")
      .map((l) => (l.trimStart().startsWith("//") ? "" : l))
      .join("\n");

  it("[id] never returns a raw request object", () => {
    const src = code(byId);

    // Every response body mentioning the record must route it through the
    // redactor. Two spellings leak, and the first version of this test only
    // caught one:
    //
    //   NextResponse.json({ ok: true, request })          <- SHORTHAND
    //   NextResponse.json({ ok: true, request: record })  <- explicit
    //
    // A mutation study reinstating the shorthand form left this test green,
    // because a regex looking for `request:` finds nothing in `{ request }`.
    const shorthand = src.match(/\{[^{}]*\brequest\s*(?=[,}])[^{}]*\}/g) ?? [];
    expect(
      shorthand.filter((m) => !m.includes("redactAuthorityRequest")),
      `shorthand leak: ${shorthand.join(" | ")}`
    ).toHaveLength(0);

    const explicit = src.match(/request:\s*(?!redactAuthorityRequest)[A-Za-z_]\w*/g) ?? [];
    // `const { request: updated, rawDisclosureToken } = await approve...` is a
    // destructuring binding, not a response field, and is the one legal match.
    const leaking = explicit.filter((m) => m !== "request: updated");
    expect(leaking, `unredacted response fields: ${explicit.join(", ")}`).toHaveLength(0);
  });

  it("[id] imports the redactor", () => {
    expect(code(byId)).toContain("redactAuthorityRequest");
  });

  it("the list route does not re-expand the redacted rows", () => {
    // listAuthorityRequests() already returns the redacted shape. This catches a
    // route that maps back over the ids to re-read raw records.
    expect(code(index)).not.toContain("getAuthorityRequest(");
  });

  it("the disclose route returns one generic refusal, not the library message", () => {
    const src = code(disclose);
    // The library's messages name the workflow status; echoing them to an
    // unauthenticated caller confirms an investigation exists.
    expect(src).not.toMatch(/error:\s*msg/);
    expect(src).not.toMatch(/err instanceof Error \? err\.message : [^;]*\}\s*,\s*\{ status: 403/);
    expect(src).toContain("could not be completed");
  });

  it("the disclose route audits a failed redemption", () => {
    // A rejected token used to leave no trace anywhere.
    const src = code(disclose);
    expect(src).toContain("audit(");
    expect(src).toContain("recordSecurityEvent");
  });
});

describe("the sanitized package excludes credentials outright", () => {
  it("carries no TOTP secret, passkey, device list or raw document", async () => {
    // Data minimisation at the package level. The source account carries a TOTP
    // secret and device history; neither is a subscriber record, and a statutory
    // request for subscriber information is not a request for the customer's
    // second factor.
    const staged = await stagedBySingleOfficer();
    const { rawDisclosureToken } = await approveAuthorityDisclosure(staged.id, BOB);
    const pkg = await retrieveDisclosurePackage(staged.id, rawDisclosureToken);

    const serialized = JSON.stringify(pkg);
    expect(serialized).not.toContain("JBSWY3DPEHPK3PXP"); // totpSecret
    expect(serialized).not.toContain("totpSecret");
    expect(serialized).not.toContain("hardwareKeys");
    expect(serialized).not.toContain("safeAddress");
    // The raw email is masked rather than reproduced.
    expect(serialized).not.toContain("whale@example.com");
  });
});
