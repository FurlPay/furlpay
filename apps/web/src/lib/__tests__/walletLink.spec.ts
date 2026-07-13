// ---------------------------------------------------------------------------
// Wallet-linking security matrix (Phase 1 hardening).
//
// STATUS: CI-READY, NOT EXECUTED in the dev environment where it was authored —
// this Next.js app has no test runner installed (no jest/vitest) and Supabase
// was not connected. To run: add vitest + tsconfig path resolution, then
// `vitest run src/lib/__tests__/walletLink.spec.ts`. The DB-uniqueness race
// case additionally requires a live Postgres with migration 0005 applied.
//
// It exercises the REAL lib functions (walletLink, stepup, linkedWalletStore).
// kv falls back to an in-memory map when Redis is unset, so verifyLink runs.
// Signatures are produced with viem — the same algorithm the server recovers.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { mnemonicToAccount } from "viem/accounts";
import { mintChallenge, verifyLink } from "@/lib/walletLink";
import { recordStepUp, recentStepUp } from "@/lib/stepup";

const alice = mnemonicToAccount("test test test test test test test test test test test junk");
const USER_A = "11111111-1111-1111-1111-111111111111";

async function sign(message: string) {
  return alice.signMessage({ message });
}

describe("verifyLink — signature + binding + replay", () => {
  it("accepts a valid signature over the minted challenge", async () => {
    const c = await mintChallenge(USER_A, alice.address);
    if ("error" in c) throw new Error(c.error);
    const sig = await sign(c.message);
    const r = await verifyLink(USER_A, alice.address, sig);
    expect(r.ok).toBe(true);
  });

  it("rejects a wrong signer", async () => {
    const c = await mintChallenge(USER_A, alice.address);
    if ("error" in c) throw new Error(c.error);
    const bob = mnemonicToAccount("legal winner thank year wave sausage worth useful legal winner thank yellow");
    const sig = await bob.signMessage({ message: c.message });
    const r = await verifyLink(USER_A, alice.address, sig);
    expect(r.ok).toBe(false);
  });

  it("rejects a claimed address that differs from the challenge", async () => {
    await mintChallenge(USER_A, alice.address);
    const other = "0x0000000000000000000000000000000000000009";
    const r = await verifyLink(USER_A, other, "0x" + "11".repeat(65));
    expect(r.ok).toBe(false);
  });

  it("rejects a malformed signature", async () => {
    await mintChallenge(USER_A, alice.address);
    const r = await verifyLink(USER_A, alice.address, "0xdead");
    expect(r.ok).toBe(false);
  });

  it("sequential replay: the same challenge cannot verify twice", async () => {
    const c = await mintChallenge(USER_A, alice.address);
    if ("error" in c) throw new Error(c.error);
    const sig = await sign(c.message);
    const first = await verifyLink(USER_A, alice.address, sig);
    const second = await verifyLink(USER_A, alice.address, sig);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false); // no_challenge / already used
  });

  it("concurrent replay: exactly one of N parallel verifies succeeds", async () => {
    const c = await mintChallenge(USER_A, alice.address);
    if ("error" in c) throw new Error(c.error);
    const sig = await sign(c.message);
    const results = await Promise.all(Array.from({ length: 8 }, () => verifyLink(USER_A, alice.address, sig)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it("no challenge minted -> verify fails", async () => {
    const sig = await sign("unrelated");
    const r = await verifyLink("22222222-2222-2222-2222-222222222222", alice.address, sig);
    expect(r.ok).toBe(false);
  });
});

describe("stepup", () => {
  beforeEach(() => {
    /* kv in-memory persists across tests; use distinct users */
  });
  it("recentStepUp is false with no record", async () => {
    expect(await recentStepUp("no-stepup-user")).toBe(false);
  });
  it("recentStepUp is true right after recordStepUp", async () => {
    await recordStepUp("su-user", "otp");
    expect(await recentStepUp("su-user")).toBe(true);
  });
  it("recentStepUp is false beyond the window", async () => {
    await recordStepUp("su-user-2", "passkey");
    expect(await recentStepUp("su-user-2", -1)).toBe(false); // zero-age window
  });
});

// NOTE: cross-account uniqueness under real concurrency is enforced by the
// Postgres UNIQUE constraint + link_wallet() unique_violation handler
// (migration 0005). That path requires a live database and is verified in
// staging, not here (supabaseBackend === "none" in unit tests exercises only
// the single-instance in-memory fallback in linkedWalletStore).
