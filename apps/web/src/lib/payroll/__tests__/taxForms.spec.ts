import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";

const h = vi.hoisted(() => ({ sbSelect: vi.fn(), sbUpdate: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ ...h, sbRpc: vi.fn(), sbCount: vi.fn(), sbInsertIgnoreDuplicates: vi.fn(), supabaseBackend: "supabase" }));
vi.mock("@/lib/compliance/addressScreening", () => ({ screenAddressRisk: vi.fn() }));
vi.mock("@/lib/services/payments", () => ({ createPayment: vi.fn() , configuredRouter: (c: string) => process.env[`FURLPAY_ROUTER_ADDRESS_${c.toUpperCase()}`] || (c === "arbitrum" ? process.env.FURLPAY_ROUTER_ADDRESS : "") || null, routerEnvName: (c: string) => `FURLPAY_ROUTER_ADDRESS_${c.toUpperCase()}` }));

import { openTax, recordTaxForm, sealTax, taxFormSchema, TaxKeyUnavailable, w8benExpiry } from "../taxForms";

const OWNER = "11111111-1111-4111-8111-111111111111", C = "33333333-3333-4333-8333-333333333333";
const addr = { line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };
const w9 = { form: "w9", tinType: "ssn", tin: "123-45-6789", legalName: "Ada Lovelace", address: addr, signedOn: "2026-09-01", attestation: true } as const;
const w8 = { form: "w8ben", tinType: "foreign", tin: "DE123456789", taxResidence: "DE", legalName: "Ada Lovelace", address: { ...addr, country: "DE" }, signedOn: "2026-09-01", attestation: true } as const;
const today = new Date("2026-10-09T12:00:00Z");
const contractor = (country: string) => ({ id: C, merchant_id: OWNER, name: "Ada", country, tax_status: "unsubmitted" });

beforeEach(() => {
  vi.stubEnv("FURLPAY_TAX_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  h.sbSelect.mockReset(); h.sbUpdate.mockReset().mockImplementation(async (_t: string, _q: string, patch: object) => [patch]);
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("tax form intake", () => {
  it("seals the TIN, name and address and exposes only the last four", async () => {
    h.sbSelect.mockResolvedValue([contractor("US")]);
    const out = await recordTaxForm(OWNER, C, taxFormSchema.parse(w9), "employer", today);
    expect(out).toEqual({ taxStatus: "w9_signed", form: "w9", tinLast4: "6789", signedOn: "2026-09-01", expiresOn: null });
    const patch = h.sbUpdate.mock.calls[0][2];
    expect(JSON.stringify(patch)).not.toContain("123456789");
    expect(JSON.stringify(patch)).not.toContain("Lovelace");
    expect(JSON.parse(openTax(patch.tax_sealed, C))).toMatchObject({ tin: "123456789", legalName: "Ada Lovelace", tinType: "ssn" });
  });
  it("binds the ciphertext to the contractor", () => {
    const sealed = sealTax("secret", C);
    expect(() => openTax(sealed, "44444444-4444-4444-8444-444444444444")).toThrow();
  });
  it("fails closed without a 32-byte key", () => {
    vi.stubEnv("FURLPAY_TAX_ENCRYPTION_KEY", "");
    expect(() => sealTax("x", C)).toThrow(TaxKeyUnavailable);
    vi.stubEnv("FURLPAY_TAX_ENCRYPTION_KEY", Buffer.alloc(16).toString("base64"));
    expect(() => sealTax("x", C)).toThrow(TaxKeyUnavailable);
  });
  it("matches the form to the person: W-9 for US, W-8BEN otherwise", async () => {
    h.sbSelect.mockResolvedValue([contractor("DE")]);
    await expect(recordTaxForm(OWNER, C, taxFormSchema.parse(w9), "e", today)).rejects.toThrow("W-9 is for US persons");
    h.sbSelect.mockResolvedValue([contractor("US")]);
    await expect(recordTaxForm(OWNER, C, taxFormSchema.parse(w8), "e", today)).rejects.toThrow("non-US");
  });
  it("tracks W-8BEN expiry: last day of the third succeeding calendar year", async () => {
    expect(w8benExpiry("2026-09-01")).toBe("2029-12-31");
    h.sbSelect.mockResolvedValue([contractor("DE")]);
    expect((await recordTaxForm(OWNER, C, taxFormSchema.parse(w8), "e", today))?.expiresOn).toBe("2029-12-31");
    await expect(recordTaxForm(OWNER, C, taxFormSchema.parse({ ...w8, signedOn: "2022-05-01" }), "e", today)).rejects.toThrow("expired on 2025-12-31");
  });
  it("validates inputs and requires the employer's attestation", () => {
    expect(taxFormSchema.safeParse({ ...w9, tin: "12345678" }).success).toBe(false);
    expect(taxFormSchema.safeParse({ ...w9, attestation: false }).success).toBe(false);
    expect(taxFormSchema.safeParse({ ...w8, tinType: "none" }).success).toBe(false);
    expect(taxFormSchema.safeParse({ ...w8, tinType: "none", tin: undefined }).success).toBe(true);
    expect(taxFormSchema.safeParse({ ...w9, tax_status: "exempt" }).success).toBe(false);
  });
  it("refuses future signature dates and other employers' contractors", async () => {
    h.sbSelect.mockResolvedValue([contractor("US")]);
    await expect(recordTaxForm(OWNER, C, taxFormSchema.parse({ ...w9, signedOn: "2026-12-01" }), "e", today)).rejects.toThrow("future");
    h.sbSelect.mockResolvedValue([]);
    expect(await recordTaxForm(OWNER, C, taxFormSchema.parse(w9), "e", today)).toBeNull();
    expect(h.sbSelect.mock.calls.at(-1)?.[1]).toContain(`merchant_id=eq.${OWNER}`);
  });
});
