import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";

const h = vi.hoisted(() => ({ sbSelect: vi.fn(), sbUpdate: vi.fn(), sbInsertIgnoreDuplicates: vi.fn(), screen: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ ...h, sbRpc: vi.fn(), sbCount: vi.fn(), supabaseBackend: "supabase" }));
vi.mock("@/lib/compliance/addressScreening", () => ({ screenAddressRisk: h.screen }));
vi.mock("@/lib/services/payments", () => ({ createPayment: vi.fn(), configuredRouter: () => null, routerEnvName: (c: string) => c }));

import { acceptInvite, createInvite, parseRosterCsv, previewInvite, setPayoutAddress } from "../selfService";
import { updateContractor } from "../repository";
import { payoutAddressMessage } from "../addressMessage";

// Hardhat development key #1 — public, never funded.
const wallet = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const OWNER = "11111111-1111-4111-8111-111111111111", C = "33333333-3333-4333-8333-333333333333", USER = "55555555-5555-4555-8555-555555555555";
const row = (over = {}) => ({ id: C, merchant_id: OWNER, name: "Ada", email: "Ada@Example.com", role: "", country: "DE", payout_chain: "base", payout_address: "0x" + "ab".repeat(20), active: true, invite_token_hash: null, invite_expires_at: null, linked_user_id: null, ...over });
const sha = (t: string) => createHash("sha256").update(t).digest("hex");

beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset();
  h.sbUpdate.mockImplementation(async (_t: string, _q: string, p: object) => [{ ...row(), ...p }]);
  h.screen.mockResolvedValue({ action: "allow", categories: [] });
});

describe("contractor invites", () => {
  it("stores only the token's hash, scoped to the employer's unlinked, active contractor", async () => {
    const out = await createInvite(OWNER, C);
    expect(out.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [, q, patch] = h.sbUpdate.mock.calls[0];
    expect(q).toContain(`merchant_id=eq.${OWNER}`); expect(q).toContain("linked_user_id=is.null"); expect(q).toContain("active=eq.true");
    expect(patch.invite_token_hash).toBe(sha(out.token));
    expect(JSON.stringify(patch)).not.toContain(out.token);
  });
  it("accepts only for the roster email (case-insensitive) and only once", async () => {
    const token = "a".repeat(43);
    h.sbSelect.mockResolvedValue([row({ invite_token_hash: sha(token), invite_expires_at: new Date(Date.now() + 60_000).toISOString() })]);
    await expect(acceptInvite(token, { id: USER, email: "mallory@example.com" })).rejects.toThrow("Sign in as");
    expect(await previewInvite(token, { email: "mallory@example.com" })).toMatchObject({ emailMatches: false, invitedEmail: "Ad•@Example.com" });
    await acceptInvite(token, { id: USER, email: "ada@example.com" });
    const [, q, patch] = h.sbUpdate.mock.calls[0];
    expect(q).toContain(`invite_token_hash=eq.${sha(token)}`); expect(q).toContain("linked_user_id=is.null");
    expect(patch).toMatchObject({ linked_user_id: USER, invite_token_hash: null });
    h.sbUpdate.mockResolvedValue([]);
    await expect(acceptInvite(token, { id: USER, email: "ada@example.com" })).rejects.toThrow("already used");
  });
  it("refuses expired, used and malformed tokens", async () => {
    const token = "b".repeat(43);
    h.sbSelect.mockResolvedValue([row({ invite_token_hash: sha(token), invite_expires_at: new Date(Date.now() - 1).toISOString() })]);
    await expect(previewInvite(token, { email: "ada@example.com" })).rejects.toThrow("expired");
    h.sbSelect.mockResolvedValue([row({ invite_token_hash: sha(token), invite_expires_at: new Date(Date.now() + 60_000).toISOString(), linked_user_id: USER })]);
    await expect(previewInvite(token, { email: "ada@example.com" })).rejects.toThrow("already used");
    await expect(previewInvite("../../x", { email: "ada@example.com" })).rejects.toThrow("not valid");
  });
});

describe("wallet-proven payout addresses", () => {
  const linked = () => h.sbSelect.mockResolvedValue([row({ linked_user_id: USER })]);
  it("sets the address only when that address signed this contractor's message, then screens it", async () => {
    linked();
    const signature = await wallet.signMessage({ message: payoutAddressMessage(C, "base", wallet.address) });
    const out = await setPayoutAddress(USER, { contractorId: C, payoutAddress: wallet.address, signature });
    expect(out?.payoutAddress).toBe(wallet.address);
    expect(h.sbUpdate.mock.calls[0][1]).toContain(`linked_user_id=eq.${USER}`);
    expect(h.screen).toHaveBeenCalledWith(wallet.address, "base");
  });
  it("rejects a signature for another contractor, chain or address", async () => {
    linked();
    for (const msg of [payoutAddressMessage("44444444-4444-4444-8444-444444444444", "base", wallet.address), payoutAddressMessage(C, "arbitrum", wallet.address)]) {
      const signature = await wallet.signMessage({ message: msg });
      await expect(setPayoutAddress(USER, { contractorId: C, payoutAddress: wallet.address, signature })).rejects.toThrow("not made by this address");
    }
    const sig = await wallet.signMessage({ message: payoutAddressMessage(C, "base", wallet.address) });
    await expect(setPayoutAddress(USER, { contractorId: C, payoutAddress: "0x" + "cd".repeat(20), signature: sig })).rejects.toThrow("not made by this address");
    expect(h.sbUpdate).not.toHaveBeenCalled();
  });
  it("fails closed when screening flags the address or is down", async () => {
    linked();
    const signature = await wallet.signMessage({ message: payoutAddressMessage(C, "base", wallet.address) });
    h.screen.mockResolvedValueOnce({ action: "block", categories: ["sanctions"] });
    await expect(setPayoutAddress(USER, { contractorId: C, payoutAddress: wallet.address, signature })).rejects.toThrow("cannot receive payroll");
    h.screen.mockRejectedValueOnce(new Error("down"));
    await expect(setPayoutAddress(USER, { contractorId: C, payoutAddress: wallet.address, signature })).rejects.toThrow("screening is unavailable");
    expect(h.sbUpdate).not.toHaveBeenCalled();
  });
  it("returns nothing for a contractor the user is not linked to", async () => {
    h.sbSelect.mockResolvedValue([]);
    const signature = await wallet.signMessage({ message: payoutAddressMessage(C, "base", wallet.address) });
    expect(await setPayoutAddress(USER, { contractorId: C, payoutAddress: wallet.address, signature })).toBeNull();
  });
  it("stops the employer from changing a linked contractor's address, chain or email", async () => {
    h.sbSelect.mockResolvedValue([{ linked_user_id: USER, address_verified_at: null }]);
    for (const p of [{ payoutAddress: "0x" + "cd".repeat(20) }, { payoutChain: "arbitrum" as const }, { email: "x@y.co" }]) {
      await expect(updateContractor(OWNER, { id: C, ...p })).rejects.toThrow("manages their own");
    }
    h.sbSelect.mockResolvedValue([{ linked_user_id: USER, address_verified_at: null }]);
    await expect(updateContractor(OWNER, { id: C, name: "Ada L" })).resolves.toBeTruthy();
  });
});

describe("CSV roster import", () => {
  const header = "name,email,country,payoutChain,payoutAddress,defaultAmount,role";
  it("parses quoted cells and validates every row with the form schema", () => {
    const out = parseRosterCsv(`${header}\n"Lovelace, Ada",ada@example.com,de,BASE,0x${"ab".repeat(20)},2500,"Eng ""lead"""`);
    expect(out.errors).toEqual([]);
    expect(out.rows[0]).toMatchObject({ name: "Lovelace, Ada", country: "DE", payoutChain: "base", defaultAmount: "2500", role: 'Eng "lead"' });
  });
  it("reports every bad row by line number", () => {
    const out = parseRosterCsv(`${header}\nA,not-an-email,DE,base,0x${"ab".repeat(20)},1,\nB,b@x.co,DE,solana,0x${"ab".repeat(20)},1,\nC,c@x.co,DE,base,0x${"0".repeat(40)},1,`);
    expect(out.errors.map(e => e.line)).toEqual([2, 3, 4]);
  });
  it("refuses files without the required columns", () => {
    expect(parseRosterCsv("name,email\nA,a@x.co").errors[0].error).toContain("Missing column");
  });
});
