import { describe, expect, it } from "vitest";
import {
  actorFrom,
  approveRoleGrant,
  effectiveRoles,
  hasActiveGrant,
  listRoleGrants,
  rejectRoleGrant,
  requestRoleGrant,
  revokeRoleGrant,
} from "../roleGrants";

// ---------------------------------------------------------------------------
// FP-ROLE-001 — making dual control satisfiable without making it meaningless.
//
// The authority gate refuses a disclosure unless the approver differs from the
// stager. Exactly one seeded account could hold `compliance_officer` and no code
// path granted it to anyone else, so that condition could never be met and every
// statutory disclosure was blocked. Failing closed is correct; a control that
// makes the legitimate workflow impossible is what gets switched off during a
// real emergency.
//
// The fix is a second officer that ONE admin cannot create alone. Every test
// below is a way that could go wrong — and the dangerous direction is always the
// same: one identity ending up on both sides of a two-person control.
// ---------------------------------------------------------------------------

let n = 0;
const uniq = () => `${Date.now()}_${n++}`;

/** Distinct admins, each with their own session. */
const admin = (id: string, jti = `jti_${id}_${uniq()}`) =>
  actorFrom({ sub: id, jti, auth_time: Math.floor(Date.now() / 1000) });

const SUBJECT = () => `usr_officer_${uniq()}`;

async function pendingGrant(subject = SUBJECT(), requester = "adm_alice") {
  const r = await requestRoleGrant({
    subjectUserId: subject,
    role: "compliance_officer",
    reason: "Second officer required so statutory disclosures can be dual-approved.",
    requestedBy: admin(requester),
  });
  if (!r.ok) throw new Error(`fixture failed: ${r.reason}`);
  return r.value;
}

describe("one identity cannot provision a privileged role alone", () => {
  it("refuses an approver who is the requester", async () => {
    // THE PRIMARY BYPASS. Without this, a single compromised admin mints a
    // colleague, then uses the two accounts to satisfy the disclosure gate.
    const requester = admin("adm_alice");
    const r = await requestRoleGrant({
      subjectUserId: SUBJECT(),
      role: "compliance_officer",
      reason: "Adding a second officer for dual control.",
      requestedBy: requester,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const approved = await approveRoleGrant(r.value.id, admin("adm_alice"));
    expect(approved.ok).toBe(false);
    if (!approved.ok) expect(approved.reason).toMatch(/must differ from the requester/i);
  });

  it("refuses an approver who is the recipient", async () => {
    // Otherwise the promotion is self-service with one extra step: an admin asks
    // for a colleague to be promoted, and the colleague waves it through.
    const subject = SUBJECT();
    const g = await pendingGrant(subject, "adm_alice");
    const approved = await approveRoleGrant(g.id, admin(subject));
    expect(approved.ok).toBe(false);
    if (!approved.ok) expect(approved.reason).toMatch(/cannot approve their own/i);
  });

  it("refuses two halves signed by the SAME SESSION", async () => {
    // §6: two accounts are not two humans. Code cannot see the human, but it can
    // see that both signatures came from one browser — the cheapest form of the
    // bypass. Two distinct user ids cannot share a jti, so this only fires when
    // one session is driving both.
    const shared = `jti_shared_${uniq()}`;
    const r = await requestRoleGrant({
      subjectUserId: SUBJECT(),
      role: "compliance_officer",
      reason: "Requesting a second compliance officer for the disclosure gate.",
      requestedBy: admin("adm_alice", shared),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const approved = await approveRoleGrant(r.value.id, admin("adm_bob", shared));
    expect(approved.ok).toBe(false);
    if (!approved.ok) expect(approved.reason).toMatch(/same session/i);
  });

  it("refuses a request for your own account", async () => {
    // Self-promotion must not even reach the approval step: it would leave one
    // signature between an identity and the customer dossier.
    const r = await requestRoleGrant({
      subjectUserId: "adm_alice",
      role: "compliance_officer",
      reason: "I would like to be able to approve disclosures myself.",
      requestedBy: admin("adm_alice"),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/your own account/i);
  });

  it("requires a substantive reason", async () => {
    // The reason is the audit trail's only account of WHY someone can now read
    // customer dossiers. An empty string makes the record useless.
    const r = await requestRoleGrant({
      subjectUserId: SUBJECT(),
      role: "compliance_officer",
      reason: "ok",
      requestedBy: admin("adm_alice"),
    });
    expect(r.ok).toBe(false);
  });
});

describe("the legitimate path works", () => {
  it("two distinct admins in distinct sessions activate the role", async () => {
    const subject = SUBJECT();
    const g = await pendingGrant(subject, "adm_alice");
    expect(g.status).toBe("pending");
    expect(await hasActiveGrant(subject, "compliance_officer")).toBe(false);

    const approved = await approveRoleGrant(g.id, admin("adm_bob"));
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    expect(approved.value.status).toBe("active");
    expect(approved.value.approvedBy?.userId).toBe("adm_bob");
    expect(approved.value.requestedBy.userId).toBe("adm_alice");

    expect(await hasActiveGrant(subject, "compliance_officer")).toBe(true);
  });

  it("records both signatures on the grant", async () => {
    // The grant IS the evidence. An investigation asking "who could read this
    // dossier, and who let them" is answered from this record alone.
    const subject = SUBJECT();
    const g = await pendingGrant(subject, "adm_alice");
    const approved = await approveRoleGrant(g.id, admin("adm_bob"));
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;

    expect(approved.value.requestedBy.at).toBeTruthy();
    expect(approved.value.approvedBy?.at).toBeTruthy();
    expect(approved.value.reason.length).toBeGreaterThan(9);
    // Session hashes differ, which is what the dual-control check compared.
    expect(approved.value.approvedBy?.sessionHash).not.toBe(approved.value.requestedBy.sessionHash);
  });

  it("never stores a raw session identifier", async () => {
    // The grant log is read by humans. A live `jti` sitting in it is a credential
    // in a report, so only a truncated hash is kept — enough to prove two
    // sessions differed, useless for replaying either.
    const jti = `jti_secret_${uniq()}`;
    const r = await requestRoleGrant({
      subjectUserId: SUBJECT(),
      role: "compliance_officer",
      reason: "Second officer for the disclosure workflow.",
      requestedBy: admin("adm_alice", jti),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(JSON.stringify(r.value)).not.toContain(jti);
  });
});

describe("revocation is real", () => {
  it("stops authorizing immediately", async () => {
    // The property `effectiveRoles` exists for. If authz read `user.roles`, a
    // revoked officer would keep access until every replica of their account row
    // caught up.
    const subject = SUBJECT();
    const g = await pendingGrant(subject, "adm_alice");
    await approveRoleGrant(g.id, admin("adm_bob"));
    expect(await hasActiveGrant(subject, "compliance_officer")).toBe(true);

    const revoked = await revokeRoleGrant(g.id, admin("adm_bob"), "Left the compliance team.");
    expect(revoked.ok).toBe(true);
    expect(await hasActiveGrant(subject, "compliance_officer")).toBe(false);
  });

  it("needs only ONE actor, unlike granting", async () => {
    // Asymmetry on purpose: gaining privilege needs two people, losing it must
    // not, or incident response waits for a second signature while a compromised
    // officer still holds the role.
    const subject = SUBJECT();
    const g = await pendingGrant(subject, "adm_alice");
    await approveRoleGrant(g.id, admin("adm_bob"));
    const revoked = await revokeRoleGrant(g.id, admin("adm_alice"), "Compromise suspected.");
    expect(revoked.ok).toBe(true);
  });

  it("a revoked grant cannot be re-approved back to life", async () => {
    const subject = SUBJECT();
    const g = await pendingGrant(subject, "adm_alice");
    await approveRoleGrant(g.id, admin("adm_bob"));
    await revokeRoleGrant(g.id, admin("adm_bob"), "Offboarded.");

    const again = await approveRoleGrant(g.id, admin("adm_carol"));
    expect(again.ok).toBe(false);
    expect(await hasActiveGrant(subject, "compliance_officer")).toBe(false);
  });

  it("a rejected grant never becomes active", async () => {
    const subject = SUBJECT();
    const g = await pendingGrant(subject, "adm_alice");
    const rejected = await rejectRoleGrant(g.id, admin("adm_bob"), "Not required for this role.");
    expect(rejected.ok).toBe(true);
    expect(await hasActiveGrant(subject, "compliance_officer")).toBe(false);

    const approved = await approveRoleGrant(g.id, admin("adm_carol"));
    expect(approved.ok).toBe(false);
  });
});

describe("concurrency and duplication", () => {
  it("a duplicate request is refused while one is outstanding", async () => {
    // Two pending grants for the same person could be approved separately by two
    // different admins, turning one two-person decision into two one-person ones.
    const subject = SUBJECT();
    await pendingGrant(subject, "adm_alice");
    const second = await requestRoleGrant({
      subjectUserId: subject,
      role: "compliance_officer",
      reason: "Duplicate request for the same subject and role.",
      requestedBy: admin("adm_carol"),
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toMatch(/already has an active or pending/i);
  });

  it("concurrent requests for the same subject produce exactly one grant", async () => {
    // The set-if-absent slot claim is what decides this. Without it both callers
    // read "no existing grant" and both write one.
    const subject = SUBJECT();
    const results = await Promise.all(
      ["adm_a", "adm_b", "adm_c"].map((who) =>
        requestRoleGrant({
          subjectUserId: subject,
          role: "compliance_officer",
          reason: "Racing requests for the same subject and role.",
          requestedBy: admin(who),
        })
      )
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it("concurrent approvals activate once and record one approver", async () => {
    const subject = SUBJECT();
    const g = await pendingGrant(subject, "adm_alice");
    const results = await Promise.all([
      approveRoleGrant(g.id, admin("adm_bob")),
      approveRoleGrant(g.id, admin("adm_carol")),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);

    const all = await listRoleGrants();
    const stored = all.find((x) => x.id === g.id);
    expect(stored?.status).toBe("active");
    expect(stored?.approvedBy?.userId).toBeTruthy();
  });

  it("re-granting after revocation goes through the full workflow again", async () => {
    // Revocation frees the slot so a legitimate re-grant is possible — but it
    // must be a NEW two-person decision, not a resurrection of the old one.
    const subject = SUBJECT();
    const first = await pendingGrant(subject, "adm_alice");
    await approveRoleGrant(first.id, admin("adm_bob"));
    await revokeRoleGrant(first.id, admin("adm_bob"), "Temporary offboarding.");

    const second = await requestRoleGrant({
      subjectUserId: subject,
      role: "compliance_officer",
      reason: "Rejoined the compliance team after leave.",
      requestedBy: admin("adm_alice"),
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.id).not.toBe(first.id);
    expect(await hasActiveGrant(subject, "compliance_officer")).toBe(false);
  });
});

describe("effectiveRoles is the authority, not the account field", () => {
  const account = (id: string, email: string, roles: ("user" | "compliance_officer" | "admin")[]) =>
    ({ user: { id, email, roles } }) as Parameters<typeof effectiveRoles>[0];

  it("drops a seeded privileged role with no grant behind it", async () => {
    // THE STALE-ROLE PROPERTY. A row that says `compliance_officer` — restored
    // from a backup, copied from a fixture, written by an old migration — does
    // not authorize anything on its own.
    const roles = await effectiveRoles(
      account(`usr_stale_${uniq()}`, "stale@example.com", ["user", "compliance_officer"])
    );
    expect(roles).toContain("user");
    expect(roles).not.toContain("compliance_officer");
  });

  it("keeps a granted role", async () => {
    const subject = SUBJECT();
    const g = await pendingGrant(subject, "adm_alice");
    await approveRoleGrant(g.id, admin("adm_bob"));

    const roles = await effectiveRoles(account(subject, "officer@example.com", ["user"]));
    // Granted even though the seed never carried it — that is the point of
    // provisioning a second officer.
    expect(roles).toContain("compliance_officer");
  });

  it("drops it again the moment the grant is revoked", async () => {
    const subject = SUBJECT();
    const g = await pendingGrant(subject, "adm_alice");
    await approveRoleGrant(g.id, admin("adm_bob"));
    await revokeRoleGrant(g.id, admin("adm_bob"), "Offboarded.");

    const roles = await effectiveRoles(account(subject, "officer@example.com", ["user"]));
    expect(roles).not.toContain("compliance_officer");
  });

  it("never strips non-grantable roles", async () => {
    // `admin` is pinned by configuration in requireRole, and `user` is not a
    // privilege. Routing either through the grant store would lock everyone out
    // of a system with an empty store.
    const roles = await effectiveRoles(
      account(`usr_admin_${uniq()}`, "someone@example.com", ["user", "admin"])
    );
    expect(roles).toContain("user");
    expect(roles).toContain("admin");
  });

  it("grandfathers the bootstrap founder so the store can be empty", async () => {
    // Chicken-and-egg: with no grants nobody is an officer, so nobody can be the
    // second signature that creates the first one. The configured founder is the
    // seed of trust that breaks it — the same address requireRole already pins
    // admin to, so this widens nothing.
    const bootstrap = (process.env.FURLPAY_ADMIN_EMAIL ?? "ashutosh@furlpay.app").toLowerCase();
    const roles = await effectiveRoles(
      account("usr_founder", bootstrap, ["user", "compliance_officer", "admin"])
    );
    expect(roles).toContain("compliance_officer");
  });

  it("matches the bootstrap address case-insensitively", async () => {
    // Email comparison is case-insensitive everywhere else in this codebase; a
    // founder who signs in as Ashutosh@… must not silently lose the role.
    const bootstrap = (process.env.FURLPAY_ADMIN_EMAIL ?? "ashutosh@furlpay.app").toUpperCase();
    const roles = await effectiveRoles(account("usr_founder", bootstrap, ["user", "compliance_officer"]));
    expect(roles).toContain("compliance_officer");
  });
});
