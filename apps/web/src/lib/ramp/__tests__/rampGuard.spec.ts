import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { rampGuard, STEP_UP_THRESHOLD_USD, type RampAuth } from "@/lib/ramp/rampGuard";
import { recordStepUp } from "@/lib/stepup";
import type { User } from "@/lib/store";

// The flow-type split decided 2026-10-02: hosted checkouts (provider KYC,
// provider holds the money) skip FurlPay identity tiers; server-initiated
// transfers (FurlPay funds them) keep KYC and require a session step-up at
// $5,000+. Embargo, velocity and the destination check apply to both.

const WALLET = "0x52908400098527886E0F7030069857D2E4169EE7";

function user(kycTier: 0 | 1 | 2 | 3): User {
  return { id: `u_${randomUUID()}`, kycTier } as User;
}
const userAuth = (u: User, jti = randomUUID()): RampAuth => ({ type: "user", user: u, jti });
const partnerAuth: RampAuth = { type: "partner", partnerId: `p_${randomUUID()}`, keyId: "k1", partnerName: "Shop" };

const req = (country?: string) =>
  new NextRequest("http://localhost/api/onramp/session", {
    method: "POST",
    headers: country ? { "x-vercel-ip-country": country } : {},
  });

async function status(r: Awaited<ReturnType<typeof rampGuard>>) {
  return r.pass ? { pass: true, flags: r.meta.flags } : { pass: false, status: r.response.status, body: await r.response.json() };
}

describe("hosted flows: the provider runs KYC", () => {
  it("an unverified user reaches the hosted checkout", async () => {
    const r = await rampGuard({ req: req(), auth: userAuth(user(0)), direction: "onramp", flowType: "hosted", amountUsd: 50, destinationAddress: WALLET, chain: "base" });
    expect(await status(r)).toEqual({ pass: true, flags: [] });
  });

  it("a partner key reaches the hosted checkout", async () => {
    const r = await rampGuard({ req: req(), auth: partnerAuth, direction: "onramp", flowType: "hosted", amountUsd: 50 });
    expect(r.pass).toBe(true);
  });

  it("$5,000+ is flagged for the provider's enhanced checks, not blocked", async () => {
    const r = await rampGuard({ req: req(), auth: userAuth(user(0)), direction: "onramp", flowType: "hosted", amountUsd: STEP_UP_THRESHOLD_USD });
    expect(await status(r)).toEqual({ pass: true, flags: ["provider_enhanced_verification"] });
  });
});

describe("server-initiated flows: FurlPay funds it, FurlPay checks", () => {
  it("on-ramp needs Tier 1, off-ramp needs Tier 2", async () => {
    const on = await status(await rampGuard({ req: req(), auth: userAuth(user(0)), direction: "onramp", flowType: "server-initiated", amountUsd: 50 }));
    expect(on).toMatchObject({ pass: false, status: 403, body: { error: "kyc_required", requiredTier: 1 } });
    const off = await status(await rampGuard({ req: req(), auth: userAuth(user(1)), direction: "offramp", flowType: "server-initiated", amountUsd: 50 }));
    expect(off).toMatchObject({ pass: false, status: 403, body: { error: "kyc_required", requiredTier: 2 } });
  });

  it("a partner key cannot drive a transfer FurlPay funds", async () => {
    const r = await status(await rampGuard({ req: req(), auth: partnerAuth, direction: "offramp", flowType: "server-initiated", amountUsd: 50 }));
    expect(r).toMatchObject({ pass: false, status: 403, body: { error: "user_required" } });
  });

  it("$5,000+ needs a step-up on THIS session", async () => {
    const u = user(3);
    const jti = randomUUID();
    const input = { req: req(), direction: "offramp" as const, flowType: "server-initiated" as const, amountUsd: STEP_UP_THRESHOLD_USD };

    const before = await status(await rampGuard({ ...input, auth: userAuth(u, jti) }));
    expect(before).toMatchObject({ pass: false, status: 401, body: { error: "step_up_required", action: { type: "step_up" } } });

    // A step-up completed on another session does not count.
    await recordStepUp(u.id, randomUUID(), "otp");
    expect((await rampGuard({ ...input, auth: userAuth(u, jti) })).pass).toBe(false);

    await recordStepUp(u.id, jti, "otp");
    expect((await rampGuard({ ...input, auth: userAuth(u, jti) })).pass).toBe(true);
  });
});

describe("checks that apply to every flow", () => {
  it("embargoed countries are refused, hosted or not", async () => {
    for (const flowType of ["hosted", "server-initiated"] as const) {
      const r = await status(await rampGuard({ req: req("IR"), auth: userAuth(user(3)), direction: "onramp", flowType, amountUsd: 50 }));
      expect(r).toMatchObject({ pass: false, status: 451, body: { error: "region_blocked" } });
    }
  });

  it("a client-typed cf-ipcountry is not trusted", async () => {
    const r = new NextRequest("http://localhost/x", { method: "POST", headers: { "cf-ipcountry": "IR" } });
    const res = await rampGuard({ req: r, auth: userAuth(user(0)), direction: "onramp", flowType: "hosted", amountUsd: 50 });
    expect(res.pass).toBe(true);
  });
});
