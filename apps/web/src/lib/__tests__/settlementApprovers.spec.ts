import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// FP-SET-09: a second, distinct recovery approver.
// Real route, real breaker state, real step-up claims. Only session
// resolution and the chain probes are replaced.
// ---------------------------------------------------------------------------

type Who = { id: string; email: string; jti: string; guest?: boolean } | null;
let admin: Who = null; // the session requireOpsAdmin accepts
let session: Who = null; // the session requireUser resolves

vi.mock("@/lib/ops/alertSink", () => ({ deliverSecurityAlert: vi.fn().mockResolvedValue({ delivered: false, reason: "not_configured" }) }));
vi.mock("@/lib/ops/respond", async (orig) => {
  const real = await orig<typeof import("@/lib/ops/respond")>();
  const { NextResponse } = await import("next/server");
  return {
    ...real,
    requireOpsAdmin: async () =>
      admin && session && admin.id === session.id
        ? { ok: true, claims: { sub: admin.id, jti: admin.jti }, account: { user: { id: admin.id, email: admin.email } } }
        : { ok: false, res: NextResponse.json({ error: "Forbidden" }, { status: 403 }) },
  };
});
vi.mock("@/lib/authz", async () => {
  const { NextResponse } = await import("next/server");
  return {
    requireUser: async () =>
      session
        ? { ok: true, claims: { sub: session.id, jti: session.jti, guest: session.guest }, account: { user: { id: session.id, email: session.email } } }
        : { ok: false, res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) },
  };
});
vi.mock("@/lib/settlementDetectors", async (orig) => ({
  ...(await orig<typeof import("@/lib/settlementDetectors")>()),
  probeChain: async () => [
    { provider: 0, ok: true, chainId: 42161, head: { number: 10n, hash: `0x${"a".repeat(64)}`, timestamp: BigInt(Math.floor(Date.now() / 1000)) } },
  ],
}));
vi.mock("@/lib/settlementTokenMonitor", async (orig) => ({
  ...(await orig<typeof import("@/lib/settlementTokenMonitor")>()),
  checkNetworkTokens: async () => [],
}));

import { GET, POST } from "@/app/api/ops/settlement-safety/route";
import { recordStepUp } from "@/lib/stepup";
import { readScope, trip, networkScope } from "@/lib/settlementSafety";
import { isRecoveryApproverEmail, recoveryApproverEmails } from "@/lib/settlementApprovers";

const ADMIN = { id: "u-admin", email: "founder@example.com", jti: "j-admin" };
const APPROVER = { id: "u-approver", email: "second@example.com", jti: "j-approver" };
const STRANGER = { id: "u-stranger", email: "someone@example.com", jti: "j-stranger" };
const SCOPE = networkScope("arbitrum");

const post = (body: unknown) =>
  POST(new NextRequest("https://furlpay.com/api/ops/settlement-safety", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
const as = async (who: NonNullable<Who>, stepUp = true) => {
  session = who;
  if (stepUp) await recordStepUp(who.id, who.jti, "passkey");
};

beforeEach(() => {
  (globalThis as unknown as { __furlpayKv?: Map<string, unknown> }).__furlpayKv?.clear();
  admin = ADMIN;
  session = null;
  vi.stubEnv("SETTLEMENT_RECOVERY_APPROVER_EMAILS", "Second@Example.com");
  vi.stubEnv("SETTLEMENT_RECOVERY_MIN_APPROVERS", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("approver list parsing", () => {
  it("canonicalises, de-duplicates and drops malformed entries", () => {
    expect(recoveryApproverEmails({ SETTLEMENT_RECOVERY_APPROVER_EMAILS: " A@x.com, a@X.com ,not-an-email," })).toEqual(["a@x.com"]);
    expect(isRecoveryApproverEmail("A@X.COM", { SETTLEMENT_RECOVERY_APPROVER_EMAILS: "a@x.com" })).toBe(true);
  });
  it("unset, or over the cap, means NO approvers (fail closed)", () => {
    expect(recoveryApproverEmails({})).toEqual([]);
    const six = Array.from({ length: 6 }, (_, i) => `p${i}@x.com`).join(",");
    expect(recoveryApproverEmails({ SETTLEMENT_RECOVERY_APPROVER_EMAILS: six })).toEqual([]);
  });
});

describe("FP-SET-09: critical recovery with an admin and a distinct approver", () => {
  async function haltAndMitigate() {
    await as(ADMIN);
    const halted = await post({ action: "halt", scope: SCOPE, reason: "incident drill for tests" });
    const incidentId = (await halted.json()).data.record.incidentId as string;
    const m = await post({ action: "mitigate", scope: SCOPE, incidentId, notes: "rotated the provider and verified heads" });
    expect(m.status).toBe(200);
    return incidentId;
  }

  it("admin approval + approver approval resumes; neither alone does", async () => {
    const incidentId = await haltAndMitigate();
    await as(ADMIN);
    expect((await post({ action: "approve", scope: SCOPE, incidentId, evidence: "admin reviewed evidence" })).status).toBe(202);
    expect((await readScope(SCOPE)).state).toBe("RECOVERY_PENDING");

    await as(APPROVER);
    const r = await post({ action: "approve", scope: SCOPE, incidentId, evidence: "independent review of probes" });
    expect(r.status).toBe(200);
    expect((await readScope(SCOPE)).state).toBe("NORMAL");
  });

  it("an approver may read state", async () => {
    await trip({ scope: SCOPE, signal: "manual_halt", severity: "critical", evidence: {}, actor: "op" });
    await as(APPROVER, false);
    const res = await GET(new NextRequest("https://furlpay.com/api/ops/settlement-safety"));
    expect(res.status).toBe(200);
  });

  it("an approver cannot halt or mitigate", async () => {
    const incidentId = await haltAndMitigate();
    await as(APPROVER);
    expect((await post({ action: "halt", scope: SCOPE, reason: "approver tries to halt" })).status).toBe(403);
    expect((await post({ action: "mitigate", scope: SCOPE, incidentId, notes: "approver tries to mitigate here" })).status).toBe(403);
  });

  it("an unlisted user and a guest on a listed email are refused", async () => {
    const incidentId = await haltAndMitigate();
    await as(STRANGER);
    expect((await post({ action: "approve", scope: SCOPE, incidentId, evidence: "not on the list" })).status).toBe(403);
    await as({ ...APPROVER, guest: true });
    expect((await post({ action: "approve", scope: SCOPE, incidentId, evidence: "guest session" })).status).toBe(403);
    expect((await readScope(SCOPE)).state).toBe("RECOVERY_PENDING");
  });

  it("an approver still needs a fresh step-up, claimed once", async () => {
    const incidentId = await haltAndMitigate();
    await as(APPROVER, false);
    expect((await post({ action: "approve", scope: SCOPE, incidentId, evidence: "no step-up yet" })).status).toBe(403);
  });

  it("with the approver list unset, a single admin cannot complete critical recovery", async () => {
    vi.stubEnv("SETTLEMENT_RECOVERY_APPROVER_EMAILS", "");
    const incidentId = await haltAndMitigate();
    await as(ADMIN);
    expect((await post({ action: "approve", scope: SCOPE, incidentId, evidence: "admin alone" })).status).toBe(202);
    await as(APPROVER);
    expect((await post({ action: "approve", scope: SCOPE, incidentId, evidence: "now unlisted" })).status).toBe(403);
    expect((await readScope(SCOPE)).state).toBe("RECOVERY_PENDING");
  });
});
