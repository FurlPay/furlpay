import { beforeEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";

const h = vi.hoisted(() => ({ sbSelect: vi.fn(), sbUpdate: vi.fn(), createPayment: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ sbSelect: h.sbSelect, sbUpdate: h.sbUpdate, sbRpc: vi.fn(), sbCount: vi.fn(), sbInsertIgnoreDuplicates: vi.fn(), supabaseBackend: "supabase" }));
vi.mock("@/lib/compliance/addressScreening", () => ({ screenAddressRisk: vi.fn() }));
vi.mock("@/lib/services/payments", () => ({ createPayment: h.createPayment }));

import { assertRouterSignature, recoverPayrollSigner, type SignData } from "../signing";
import { recordSignature, reissueExpired } from "../repository";

// Hardhat's well-known test key #0 — never funded on any real network.
const employer = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const other = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const OWNER = "11111111-1111-4111-8111-111111111111", BATCH = "22222222-2222-4222-8222-222222222222", LINE = "44444444-4444-4444-8444-444444444444";
const data = (deadline = Math.floor(Date.now() / 1000) + 600): SignData => ({
  domain: { name: "FurlPayRouter", version: "1", chainId: 42161, verifyingContract: "0x" + "1".repeat(40) },
  types: { Payment: [{ name: "paymentId", type: "string" }, { name: "recipient", type: "address" }, { name: "amount", type: "uint256" }, { name: "fee", type: "uint256" }, { name: "nonce", type: "bytes32" }, { name: "deadline", type: "uint256" }] },
  primaryType: "Payment",
  message: { paymentId: "pay_1", recipient: "0x" + "ab".repeat(20), amount: "2500000000", fee: "12500000", nonce: "0x" + "cd".repeat(32), deadline },
});
const sign = (d: SignData, who = employer) => who.signTypedData({
  domain: { ...d.domain, verifyingContract: d.domain.verifyingContract as `0x${string}` }, types: d.types, primaryType: "Payment",
  message: { ...d.message, recipient: d.message.recipient as `0x${string}`, nonce: d.message.nonce as `0x${string}`, amount: BigInt(d.message.amount), fee: BigInt(d.message.fee), deadline: BigInt(d.message.deadline) },
});

describe("router-compatible signature check", () => {
  it("recovers the employer from a real EIP-712 signature", async () => {
    const d = data();
    expect((await recoverPayrollSigner(d, await sign(d))).toLowerCase()).toBe(employer.address.toLowerCase());
  });
  it("recovers someone else when any signed field differs", async () => {
    const d = data();
    const sig = await sign(d);
    const tampered = { ...d, message: { ...d.message, amount: "2500000001" } };
    expect((await recoverPayrollSigner(tampered, sig)).toLowerCase()).not.toBe(employer.address.toLowerCase());
  });
  it("refuses malleable (high-s) and v=0/1 signatures the router would revert on", async () => {
    const sig = await sign(data());
    const n = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
    const s = BigInt("0x" + sig.slice(66, 130));
    const high = sig.slice(0, 66) + (n - s).toString(16).padStart(64, "0") + (sig.endsWith("1b") ? "1c" : "1b");
    expect(() => assertRouterSignature(high)).toThrow("high s");
    expect(() => assertRouterSignature(sig.slice(0, 130) + "00")).toThrow("27 or 28");
  });
  it("refuses to verify against the undeployed-router placeholder", async () => {
    const d = data(); const sig = await sign(d);
    await expect(recoverPayrollSigner({ ...d, domain: { ...d.domain, verifyingContract: "0xFurlPayRouterPendingDeployment" } }, sig)).rejects.toThrow("not deployed");
  });
});

describe("recordSignature / reissueExpired", () => {
  const batch = (over = {}) => ({ id: BATCH, merchant_id: OWNER, cycle: "2026-10", chain: "arbitrum", status: "submitted", payer_address: null, ...over });
  const line = (over = {}) => ({ id: LINE, batch_id: BATCH, name: "Ada", recipient: "0x" + "ab".repeat(20), amount_units: 2500000000, screening: "clear", payment_id: "pay_1", sign_data: data(), sign_deadline: new Date(Date.now() + 600_000).toISOString(), issue_count: 1, signature: null, signer: null, signed_at: null, ...over });
  const rows = (b: object, l: object) => h.sbSelect.mockImplementation(async (t: string) => t === "payroll_batch_lines" ? [l] : [b]);
  beforeEach(() => { for (const f of Object.values(h)) f.mockReset(); h.sbUpdate.mockImplementation(async (_t: string, _q: string, patch: object) => [patch]); });

  it("stores a verified signature, pins the batch to that wallet, and CAS-guards on the issue", async () => {
    rows(batch(), line());
    await recordSignature(OWNER, BATCH, LINE, await sign(data()));
    expect(h.sbUpdate).toHaveBeenCalledWith("payroll_batches", expect.stringContaining("payer_address=is.null"), { payer_address: employer.address });
    expect(h.sbUpdate).toHaveBeenCalledWith("payroll_batch_lines", expect.stringContaining("issue_count=eq.1"), expect.objectContaining({ signer: employer.address }));
  });
  it("refuses a second wallet once the batch has a payer", async () => {
    const d = data(); rows(batch({ payer_address: employer.address }), line({ sign_data: d }));
    await expect(recordSignature(OWNER, BATCH, LINE, await sign(d, other))).rejects.toThrow("Sign with the wallet");
  });
  it("refuses expired requests and draft batches", async () => {
    rows(batch(), line({ sign_deadline: new Date(Date.now() - 1000).toISOString() }));
    await expect(recordSignature(OWNER, BATCH, LINE, await sign(data()))).rejects.toThrow("expired");
    rows(batch({ status: "draft" }), line());
    await expect(recordSignature(OWNER, BATCH, LINE, await sign(data()))).rejects.toThrow("not awaiting");
  });
  it("re-issues only expired lines with a new idempotency key and clears their signature", async () => {
    rows(batch(), line({ sign_deadline: new Date(Date.now() - 1000).toISOString(), signature: "0x" + "1".repeat(130), signer: employer.address, signed_at: "x" }));
    h.createPayment.mockResolvedValue({ record: { id: "pay_2" }, signData: { message: { deadline: 1_900_000_000 } } });
    await reissueExpired(OWNER, BATCH, OWNER);
    expect(h.createPayment).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: `payroll:${BATCH}:${LINE}:1` }));
    expect(h.sbUpdate).toHaveBeenCalledWith("payroll_batch_lines", expect.stringContaining("issue_count=eq.1"), expect.objectContaining({ payment_id: "pay_2", issue_count: 2, signature: null, signer: null }));
  });
  it("re-issues nothing while every request is still valid", async () => {
    rows(batch(), line());
    await expect(reissueExpired(OWNER, BATCH, OWNER)).rejects.toThrow("No signing request has expired");
    expect(h.createPayment).not.toHaveBeenCalled();
  });
});
