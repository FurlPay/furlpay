import { createHmac } from "crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { findOrCreateUserByIdentity, getAccount } from "@/lib/store";

// ---------------------------------------------------------------------------
// N1 — a KYC result can only land on the account the server started it for.
//
// Drives the REAL /api/compliance/verify route, the REAL Persona and Sumsub
// webhook routes (real signature checks), the REAL binding store (KV, memory
// backend under test) and the REAL account store / setKycStatus. Doubled:
//   · requireUser — S.caller is the authenticated user;
//   · the identity provider — records what reference it was given and returns
//     a fresh session id, standing in for Persona's / Sumsub's API;
//   · rate limiting and email — irrelevant edges.
// ---------------------------------------------------------------------------

const S = vi.hoisted(() => ({
  caller: "" as string,
  providerName: "persona" as "persona" | "sumsub",
  started: [] as { userId: string; referenceId: string }[],
  seq: 0,
}));

vi.mock("@/lib/authz", async () => {
  const store = await import("@/lib/store");
  const { NextResponse } = await import("next/server");
  return {
    requireUser: vi.fn(async () => {
      const account = S.caller ? store.getAccount(S.caller) : undefined;
      return account
        ? { ok: true, account, claims: { sub: account.user.id } }
        : { ok: false, res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
    }),
  };
});

vi.mock("@/lib/compliance/providers/factory", () => ({
  getIdentityProvider: vi.fn(async () => ({
    name: S.providerName,
    startVerification: vi.fn(async (userId: string, config: { referenceId: string }) => {
      S.started.push({ userId, referenceId: config.referenceId });
      const sessionId = `${S.providerName === "persona" ? "inq" : "app"}_${++S.seq}`;
      return { sessionId, sessionUrl: `https://example.test/${sessionId}`, provider: S.providerName, expiresAt: 0, status: "pending" };
    }),
  })),
}));

vi.mock("@/lib/rateLimit", () => ({ rateLimitOr429: vi.fn(async () => null) }));
vi.mock("@/lib/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email")>()),
  sendEmail: vi.fn(async () => undefined),
}));

import { POST as startVerify } from "@/app/api/compliance/verify/route";
import { POST as personaWebhook } from "@/app/api/webhooks/persona/route";
import { POST as sumsubWebhook } from "@/app/api/webhooks/sumsub/route";
import { bindKycSession, resolveKycSession } from "@/lib/compliance/kycBinding";

const PERSONA_SECRET = "persona-test-secret";
const SUMSUB_SECRET = "sumsub-test-secret";
process.env.PERSONA_WEBHOOK_SECRET = PERSONA_SECRET;
process.env.SUMSUB_WEBHOOK_SECRET = SUMSUB_SECRET;

let n = 0;
function newUser(): string {
  const { account } = findOrCreateUserByIdentity({ email: `kyc-bind-${Date.now()}-${n++}@example.test` });
  account.user.kycStatus = "unverified";
  account.user.kycTier = 0;
  return account.user.id;
}
const kycOf = (id: string) => getAccount(id)!.user.kycStatus;

async function start(caller: string, body: Record<string, unknown>) {
  S.caller = caller;
  const res = await startVerify(
    new NextRequest("http://localhost/api/compliance/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );
  return { status: res.status, json: (await res.json()) as { sessionId?: string; error?: string } };
}

function personaCompleted(inquiryId: string, referenceId: string, eventId = `evt_${++S.seq}`) {
  const body = JSON.stringify({
    id: eventId,
    eventType: "inquiry.completed",
    payload: { data: { id: inquiryId, attributes: { status: "completed", referenceId } } },
  });
  const sig = createHmac("sha256", PERSONA_SECRET).update(body).digest("hex");
  return personaWebhook(
    new Request("http://localhost/api/webhooks/persona", { method: "POST", headers: { "persona-signature": `v1=${sig}` }, body })
  );
}

function sumsubReviewed(applicantId: string, externalUserId: string) {
  const body = JSON.stringify({
    type: "applicantReviewed",
    applicantId,
    externalUserId,
    correlationId: `corr_${++S.seq}`,
    reviewResult: { reviewAnswer: "GREEN" },
  });
  const digest = createHmac("sha256", SUMSUB_SECRET).update(body).digest("hex");
  return sumsubWebhook(
    new Request("http://localhost/api/webhooks/sumsub", {
      method: "POST",
      headers: { "x-payload-digest": digest, "x-payload-digest-alg": "HMAC_SHA256_HEX" },
      body,
    })
  );
}

beforeEach(() => {
  S.started = [];
  S.providerName = "persona";
});

describe("N1 · /api/compliance/verify derives the reference server-side", () => {
  it("gives the authenticated user a session referenced to their OWN id", async () => {
    const alice = newUser();
    const r = await start(alice, { country: "US" });
    expect(r.status).toBe(200);
    expect(S.started).toEqual([{ userId: alice, referenceId: alice }]);
    await expect(resolveKycSession("persona", r.json.sessionId, alice)).resolves.toEqual({ ok: true, userId: alice });
  });

  it("IGNORES a client-supplied referenceId naming another user", async () => {
    const alice = newUser();
    const victim = newUser();
    const r = await start(alice, { country: "US", referenceId: victim });
    expect(r.status).toBe(200);
    expect(S.started).toEqual([{ userId: alice, referenceId: alice }]);
    // The session is bound to the caller, not to the id they supplied.
    await expect(resolveKycSession("persona", r.json.sessionId, null)).resolves.toEqual({ ok: true, userId: alice });
  });

  it("rejects an unauthenticated caller before any provider session is created", async () => {
    const r = await start("", { country: "US" });
    expect(r.status).toBe(401);
    expect(S.started).toHaveLength(0);
  });
});

describe("N1 · Persona webhook applies results only through the binding", () => {
  it("a completed inquiry verifies the user it was started for", async () => {
    const alice = newUser();
    const { json } = await start(alice, { country: "US" });
    const res = await personaCompleted(json.sessionId!, alice);
    expect(res.status).toBe(200);
    expect(kycOf(alice)).toBe("verified");
  });

  it("an inquiry this server never created (e.g. the embedded web flow with a chosen reference-id) changes nothing", async () => {
    const victim = newUser();
    const res = await personaCompleted("inq_created_in_a_browser", victim);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { refused?: string }).refused).toBe("unbound_session");
    expect(kycOf(victim)).toBe("unverified");
  });

  it("one user's inquiry relabelled with another user's reference cannot move either account", async () => {
    const alice = newUser();
    const victim = newUser();
    const { json } = await start(alice, { country: "US" });
    const res = await personaCompleted(json.sessionId!, victim);
    expect(((await res.json()) as { refused?: string }).refused).toBe("reference_mismatch");
    expect(kycOf(victim)).toBe("unverified");
    expect(kycOf(alice)).toBe("unverified");
  });

  it("an event with no inquiry id fails closed", async () => {
    await expect(resolveKycSession("persona", undefined, "anyone")).resolves.toEqual({
      ok: false,
      reason: "missing_session_id",
    });
  });

  it("a forged signature is still rejected before the binding is consulted", async () => {
    const alice = newUser();
    await bindKycSession("persona", "inq_signed_check", alice);
    const body = JSON.stringify({ id: "evt_forged", eventType: "inquiry.completed", payload: { data: { id: "inq_signed_check", attributes: { status: "completed" } } } });
    const res = await personaWebhook(
      new Request("http://localhost/api/webhooks/persona", { method: "POST", headers: { "persona-signature": "v1=00" }, body })
    );
    expect(res.status).toBe(401);
    expect(kycOf(alice)).toBe("unverified");
  });
});

describe("N1 · Sumsub webhook applies results only through the binding", () => {
  it("a GREEN review verifies the user the applicant was created for", async () => {
    S.providerName = "sumsub";
    const bob = newUser();
    const { json } = await start(bob, { country: "US" });
    const res = await sumsubReviewed(json.sessionId!, bob);
    expect(res.status).toBe(200);
    expect(kycOf(bob)).toBe("verified");
  });

  it("an unbound applicant carrying another user's externalUserId changes nothing", async () => {
    const victim = newUser();
    const res = await sumsubReviewed("app_not_ours", victim);
    expect(((await res.json()) as { refused?: string }).refused).toBe("unbound_session");
    expect(kycOf(victim)).toBe("unverified");
  });

  it("a bound applicant whose externalUserId disagrees with its binding is refused", async () => {
    S.providerName = "sumsub";
    const bob = newUser();
    const victim = newUser();
    const { json } = await start(bob, { country: "US" });
    const res = await sumsubReviewed(json.sessionId!, victim);
    expect(((await res.json()) as { refused?: string }).refused).toBe("reference_mismatch");
    expect(kycOf(victim)).toBe("unverified");
    expect(kycOf(bob)).toBe("unverified");
  });
});
