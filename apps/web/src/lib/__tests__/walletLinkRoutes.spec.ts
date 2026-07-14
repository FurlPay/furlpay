// ---------------------------------------------------------------------------
// Wallet-link HTTP ROUTE integration matrix — drives the REAL Next.js route
// handlers (not just helpers) with real signed sessions and viem signatures.
// Runs under vitest (node). No Postgres: supabaseBackend="none", so the
// durable-uniqueness path exercises the in-memory fallback; cross-account DB
// races (A/B/C) require staging and are covered separately by migration 0005.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { mnemonicToAccount } from "viem/accounts";
import { POST as challengePOST } from "@/app/api/wallet/link/challenge/route";
import { POST as verifyPOST } from "@/app/api/wallet/link/verify/route";
import { GET as statusGET } from "@/app/api/wallet/link/route";
import { signSession } from "@/lib/session";
import { DEMO_USER_ID, getAccount } from "@/lib/store";
import { recordStepUp } from "@/lib/stepup";

const alice = mnemonicToAccount("test test test test test test test test test test test junk");
const bob = mnemonicToAccount("legal winner thank year wave sausage worth useful legal winner thank yellow");

function on() { process.env.FURLPAY_SELF_CUSTODY_STAGE = "1"; }
function off() { process.env.FURLPAY_SELF_CUSTODY_STAGE = "0"; }

// Returns the token AND its jti, so a test can record a step-up bound to the
// exact session the verify route will read (matches the real auth routes).
async function session(opts: { guest?: boolean } = {}): Promise<{ token: string; jti: string }> {
  const jti = randomUUID();
  const token = await signSession({ sub: DEMO_USER_ID, safe: "0x0", roles: ["user"], jti, ...(opts.guest ? { guest: true } : {}) });
  return { token, jti };
}

async function req(path: string, method: "GET" | "POST", body?: unknown, token?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return new NextRequest(`https://furlpay.com/api/wallet/link${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

async function getChallengeMessage(token: string, address: string): Promise<string> {
  const res = await challengePOST(await req("/challenge", "POST", { address }, token));
  const json = await res.json();
  return json.message as string;
}

// Clear the demo account's link + kv step-up between tests that need isolation.
function clearLink() {
  const acct = getAccount(DEMO_USER_ID);
  if (acct) acct.user.linkedWallet = undefined;
}

describe("wallet-link routes — flag + auth gating", () => {
  beforeEach(() => { on(); clearLink(); });

  it("flag disabled -> 404 even for an authenticated caller", async () => {
    off();
    const { token } = await session();
    const res = await challengePOST(await req("/challenge", "POST", { address: alice.address }, token));
    expect(res.status).toBe(404);
  });

  it("unauthenticated challenge -> 401", async () => {
    const res = await challengePOST(await req("/challenge", "POST", { address: alice.address }));
    expect(res.status).toBe(401);
  });

  it("unauthenticated verify -> 401", async () => {
    const res = await verifyPOST(await req("/verify", "POST", { address: alice.address, signature: "0x" + "11".repeat(65) }));
    expect(res.status).toBe(401);
  });

  it("guest challenge -> 403", async () => {
    const { token } = await session({ guest: true });
    const res = await challengePOST(await req("/challenge", "POST", { address: alice.address }, token));
    expect(res.status).toBe(403);
  });

  it("guest verify -> 403", async () => {
    const { token } = await session({ guest: true });
    const res = await verifyPOST(await req("/verify", "POST", { address: alice.address, signature: "0x" + "11".repeat(65) }, token));
    expect(res.status).toBe(403);
  });
});

describe("wallet-link routes — step-up gate", () => {
  beforeEach(() => { on(); clearLink(); });

  it("missing step-up -> 403 stepup_required", async () => {
    const { token } = await session(); // no recordStepUp
    const msg = await getChallengeMessage(token, alice.address);
    const sig = await alice.signMessage({ message: msg });
    const res = await verifyPOST(await req("/verify", "POST", { address: alice.address, signature: sig }, token));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("stepup_required");
  });

  it("step-up on a DIFFERENT session does NOT authorize this one (stolen-session defense)", async () => {
    const attacker = await session(); // the linking session
    const victim = await session(); // a different session that did a real step-up
    await recordStepUp(DEMO_USER_ID, victim.jti, "otp");
    const msg = await getChallengeMessage(attacker.token, alice.address);
    const sig = await alice.signMessage({ message: msg });
    const res = await verifyPOST(await req("/verify", "POST", { address: alice.address, signature: sig }, attacker.token));
    expect(res.status).toBe(403); // attacker's session has no step-up of its own
  });

  it("fresh step-up on THIS session + valid signature -> link established", async () => {
    const { token, jti } = await session();
    await recordStepUp(DEMO_USER_ID, jti, "otp");
    const msg = await getChallengeMessage(token, alice.address);
    const sig = await alice.signMessage({ message: msg });
    const res = await verifyPOST(await req("/verify", "POST", { address: alice.address, signature: sig }, token));
    expect(res.status).toBe(200);
    expect((await res.json()).linked.address.toLowerCase()).toBe(alice.address.toLowerCase());
  });
});

describe("wallet-link routes — signature + conflict semantics", () => {
  beforeEach(() => { on(); clearLink(); });

  async function link(address: string, signer: typeof alice) {
    const { token, jti } = await session();
    await recordStepUp(DEMO_USER_ID, jti, "otp");
    const msg = await getChallengeMessage(token, address);
    const sig = await signer.signMessage({ message: msg });
    return verifyPOST(await req("/verify", "POST", { address, signature: sig }, token));
  }

  it("wrong signer -> 400", async () => {
    const { token, jti } = await session();
    await recordStepUp(DEMO_USER_ID, jti, "otp");
    const msg = await getChallengeMessage(token, alice.address);
    const sig = await bob.signMessage({ message: msg }); // bob signs alice's challenge
    const res = await verifyPOST(await req("/verify", "POST", { address: alice.address, signature: sig }, token));
    expect(res.status).toBe(400);
  });

  it("malformed signature -> 400", async () => {
    const { token, jti } = await session();
    await recordStepUp(DEMO_USER_ID, jti, "otp");
    await getChallengeMessage(token, alice.address);
    const res = await verifyPOST(await req("/verify", "POST", { address: alice.address, signature: "0xdead" }, token));
    expect(res.status).toBe(400);
  });

  it("same user + same wallet -> idempotent success", async () => {
    expect((await link(alice.address, alice)).status).toBe(200);
    expect((await link(alice.address, alice)).status).toBe(200); // re-link same address
  });

  it("same user + different wallet -> 409", async () => {
    expect((await link(alice.address, alice)).status).toBe(200);
    const res = await link(bob.address, bob); // demo user already linked alice
    expect(res.status).toBe(409);
  });

  it("GET status reflects the established link", async () => {
    await link(alice.address, alice);
    const res = await statusGET(await req("", "GET", undefined, (await session()).token));
    const json = await res.json();
    expect(json.linked.address.toLowerCase()).toBe(alice.address.toLowerCase());
  });
});
