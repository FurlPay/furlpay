import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";
import { sbSelect, sbUpdate } from "@/lib/supabase";
import { requireStorage, PayrollConflict } from "./repository";
import type { Contractor } from "./model";

// Recording a W-9 / W-8BEN the employer HOLDS. This is not an e-signature
// system: IRS rules for electronic W-9s require the PAYEE to sign under
// penalties of perjury inside the requester's system (Instructions for the
// Requester of Form W-9; Announcement 98-27). Here the employer attests that a
// payee-signed form is on file and records what 1099 reporting needs from it.
//
// The TIN, legal name and address are sealed with AES-256-GCM under
// FURLPAY_TAX_ENCRYPTION_KEY, bound to `tax:<contractor id>` (same v1 format as
// lib/ramp/partnerConfig). Only the TIN's last four characters are stored in
// the clear. Nothing here decrypts for an API response.
//
// W-8BEN validity: from signing through the last day of the third succeeding
// calendar year (signed 2026 → valid through 2029-12-31), unless circumstances
// change. A W-9 does not expire.
export class TaxKeyUnavailable extends Error {}
function key(): Buffer {
  const raw = (process.env.FURLPAY_TAX_ENCRYPTION_KEY ?? "").trim();
  const k = raw ? Buffer.from(raw, "base64") : Buffer.alloc(0);
  if (k.length !== 32) throw new TaxKeyUnavailable("FURLPAY_TAX_ENCRYPTION_KEY is not configured");
  return k;
}
export function sealTax(plain: string, contractorId: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  c.setAAD(Buffer.from(`tax:${contractorId}`, "utf8"));
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return "v1:" + Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}
/** For an authorized export (e.g. 1099 preparation); never called by an API response. */
export function openTax(sealed: string, contractorId: string): string {
  if (!sealed.startsWith("v1:")) throw new Error("Unknown sealed format");
  const buf = Buffer.from(sealed.slice(3), "base64");
  const d = createDecipheriv("aes-256-gcm", key(), buf.subarray(0, 12));
  d.setAAD(Buffer.from(`tax:${contractorId}`, "utf8"));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(d => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)), "Invalid date");
const address = z.object({ line1: z.string().trim().min(1).max(120), line2: z.string().trim().max(120).optional(), city: z.string().trim().min(1).max(80), region: z.string().trim().max(80).optional(), postalCode: z.string().trim().max(20).optional(), country: z.string().regex(/^[A-Z]{2}$/) }).strict();
const common = { legalName: z.string().trim().min(1).max(160), address, signedOn: isoDate, attestation: z.literal(true, { errorMap: () => ({ message: "Confirm you hold the form signed by the payee" }) }) };
export const taxFormSchema = z.discriminatedUnion("form", [
  z.object({ form: z.literal("w9"), tinType: z.enum(["ssn", "ein", "itin"]), tin: z.string().trim().transform(v => v.replace(/[\s-]/g, "")).pipe(z.string().regex(/^\d{9}$/, "A US TIN has 9 digits")), ...common }).strict(),
  z.object({ form: z.literal("w8ben"), tinType: z.enum(["foreign", "itin", "none"]), tin: z.string().trim().max(40).optional(), taxResidence: z.string().regex(/^[A-Z]{2}$/), ...common }).strict(),
]).superRefine((v, ctx) => {
  if (v.form === "w8ben" && (v.tinType === "none" ? Boolean(v.tin) : !(v.tin && /^[0-9A-Za-z-]{4,40}$/.test(v.tin))))
    ctx.addIssue({ code: "custom", path: ["tin"], message: "Enter the TIN shown on the form, or choose none" });
});
export type TaxFormInput = z.infer<typeof taxFormSchema>;

export function w8benExpiry(signedOn: string): string { return `${Number(signedOn.slice(0, 4)) + 3}-12-31`; }

export async function recordTaxForm(owner: string, contractorId: string, input: TaxFormInput, actor: string, today = new Date()) {
  requireStorage();
  const c = (await sbSelect<Contractor>("payroll_contractors", `id=eq.${encodeURIComponent(contractorId)}&merchant_id=eq.${encodeURIComponent(owner)}&limit=1`))[0];
  if (!c) return null;
  const signed = Date.parse(`${input.signedOn}T00:00:00Z`);
  if (signed > today.getTime()) throw new PayrollConflict("The signature date cannot be in the future");
  // W-9 is for US persons and W-8BEN for foreign individuals; the roster country must agree.
  if (input.form === "w9" && c.country !== "US") throw new PayrollConflict(`${c.name} is recorded in ${c.country}; a W-9 is for US persons`);
  if (input.form === "w8ben" && (c.country === "US" || input.taxResidence === "US")) throw new PayrollConflict("A W-8BEN is for non-US persons; use a W-9");
  const expires = input.form === "w8ben" ? w8benExpiry(input.signedOn) : null;
  if (expires && Date.parse(`${expires}T23:59:59Z`) < today.getTime()) throw new PayrollConflict(`A W-8BEN signed ${input.signedOn} expired on ${expires}; collect a new one`);
  const tin = input.tin ?? "";
  const sealed = sealTax(JSON.stringify({ legalName: input.legalName, address: input.address, tinType: input.tinType, tin, ...(input.form === "w8ben" ? { taxResidence: input.taxResidence } : {}) }), c.id);
  const patch = {
    tax_status: input.form === "w9" ? "w9_signed" as const : "w8ben_signed" as const, tax_form: input.form, tax_sealed: sealed,
    tin_last4: tin.length >= 4 ? tin.slice(-4) : null, tax_signed_on: input.signedOn, tax_expires_on: expires,
    tax_recorded_by: actor, tax_recorded_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
  const [row] = await sbUpdate<Contractor & typeof patch>("payroll_contractors", `id=eq.${encodeURIComponent(c.id)}&merchant_id=eq.${encodeURIComponent(owner)}`, patch);
  return row ? publicTax(row) : null;
}

/** What a response may show: form, status, dates and last 4. Never the sealed blob or the TIN. */
export function publicTax(c: { tax_status: string; tax_form?: string | null; tin_last4?: string | null; tax_signed_on?: string | null; tax_expires_on?: string | null }) {
  return { taxStatus: c.tax_status, form: c.tax_form ?? null, tinLast4: c.tin_last4 ?? null, signedOn: c.tax_signed_on ?? null, expiresOn: c.tax_expires_on ?? null };
}
