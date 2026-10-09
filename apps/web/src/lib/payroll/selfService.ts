import { createHash, randomBytes } from "node:crypto";
import { verifyMessage } from "viem";
import { z } from "zod";
import { sbInsertIgnoreDuplicates, sbSelect, sbUpdate } from "@/lib/supabase";
import { screenAddressRisk } from "@/lib/compliance/addressScreening";
import { parseUsdc } from "@/lib/payments/merchant/money";
import { CONTRACTOR_COLUMNS, PayrollConflict, requireStorage } from "./repository";
import { payoutAddressMessage } from "./addressMessage";
import { contractorSchema, type Contractor } from "./model";

// Contractor self-service (migration 0044).
//
//   employer: invite(contractor)        -> single-use link, valid 7 days (only its sha256 is stored)
//   contractor: accept(token)           -> must be signed in as the roster email; links the account
//   contractor: setPayoutAddress(sig)   -> the new address signs a message naming the contractor and
//                                          chain (EIP-191), is screened, and becomes employer-immutable
//
// The invite token travels in the URL fragment (#t=…), so it never reaches
// server logs or Referer headers; the client POSTs it.
const INVITE_TTL_MS = 7 * 86_400_000;
const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
const eq = (v: string) => encodeURIComponent(v);
type Row = Contractor & { invite_token_hash: string | null; invite_expires_at: string | null; linked_user_id: string | null; address_proof: string | null };

export async function createInvite(owner: string, contractorId: string) {
  requireStorage();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();
  // Only unlinked, active contractors can be invited; re-inviting replaces the previous token.
  const [row] = await sbUpdate<Row>("payroll_contractors", `id=eq.${eq(contractorId)}&merchant_id=eq.${eq(owner)}&linked_user_id=is.null&active=eq.true`,
    { invite_token_hash: sha256(token), invite_expires_at: expiresAt });
  if (!row) throw new PayrollConflict("Only an active contractor who has not joined yet can be invited");
  return { token, expiresAt, email: row.email };
}

async function byToken(token: string): Promise<Row> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new PayrollConflict("This invite link is not valid");
  const row = (await sbSelect<Row>("payroll_contractors", `invite_token_hash=eq.${sha256(token)}&limit=1`))[0];
  if (!row || !row.invite_expires_at || Date.parse(row.invite_expires_at) <= Date.now()) throw new PayrollConflict("This invite has expired or was replaced; ask for a new one");
  if (row.linked_user_id) throw new PayrollConflict("This invite was already used");
  return row;
}

/** What the invite page may show before acceptance: no employer data beyond the role, nothing about other people. */
export async function previewInvite(token: string, user: { email: string }) {
  const row = await byToken(token);
  return { name: row.name, role: row.role, chain: row.payout_chain, emailMatches: row.email.toLowerCase() === user.email.toLowerCase(), invitedEmail: maskEmail(row.email) };
}

export async function acceptInvite(token: string, user: { id: string; email: string }) {
  requireStorage();
  const row = await byToken(token);
  if (row.email.toLowerCase() !== user.email.toLowerCase()) throw new PayrollConflict(`Sign in as ${maskEmail(row.email)} to accept this invite`);
  // Compare-and-set on the token: one acceptance, and a replaced token is dead.
  const [linked] = await sbUpdate<Row>("payroll_contractors", `id=eq.${eq(row.id)}&invite_token_hash=eq.${sha256(token)}&linked_user_id=is.null`,
    { linked_user_id: user.id, linked_at: new Date().toISOString(), invite_token_hash: null, invite_expires_at: null });
  if (!linked) throw new PayrollConflict("This invite was already used");
  return { contractorId: linked.id };
}

export async function myContractorProfiles(userId: string) {
  requireStorage();
  return sbSelect<Pick<Contractor, "id" | "name" | "role" | "country" | "payout_chain" | "payout_address" | "address_verified_at" | "active" | "tax_status">>("payroll_contractors",
    `select=id,name,role,country,payout_chain,payout_address,address_verified_at,active,tax_status&linked_user_id=eq.${eq(userId)}&order=created_at.desc&limit=50`);
}

export const payoutAddressSchema = z.object({
  contractorId: z.string().uuid(),
  payoutAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "Enter a 0x wallet address").refine(a => !/^0x0{40}$/.test(a), "The zero address cannot receive pay"),
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/, "Signature must be 65 bytes"),
}).strict();

export async function setPayoutAddress(userId: string, input: z.infer<typeof payoutAddressSchema>) {
  requireStorage();
  const row = (await sbSelect<Row>("payroll_contractors", `id=eq.${eq(input.contractorId)}&linked_user_id=eq.${eq(userId)}&limit=1`))[0];
  if (!row) return null;
  const message = payoutAddressMessage(row.id, row.payout_chain, input.payoutAddress);
  let proven = false;
  try { proven = await verifyMessage({ address: input.payoutAddress as `0x${string}`, message, signature: input.signature as `0x${string}` }); } catch { proven = false; }
  if (!proven) throw new PayrollConflict("The signature was not made by this address for this contractor");
  // Fail closed: a flagged address, or a screening outage, keeps the current address.
  let risk: Awaited<ReturnType<typeof screenAddressRisk>>;
  try { risk = await screenAddressRisk(input.payoutAddress, row.payout_chain); } catch { throw new PayrollConflict("Address screening is unavailable; try again later"); }
  if (risk.action !== "allow") throw new PayrollConflict("This address cannot receive payroll. Contact support if you think this is wrong.");
  const [updated] = await sbUpdate<Row>("payroll_contractors", `id=eq.${eq(row.id)}&linked_user_id=eq.${eq(userId)}`,
    { payout_address: input.payoutAddress, address_proof: input.signature, address_verified_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  return updated ? { id: updated.id, payoutAddress: updated.payout_address, chain: updated.payout_chain, verifiedAt: updated.address_verified_at } : null;
}

function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  return `${local.slice(0, 2)}${"•".repeat(Math.max(1, local.length - 2))}@${domain}`;
}

// --- CSV roster import -------------------------------------------------------
// Header: name,email,country,payoutChain,payoutAddress,defaultAmount[,role]
// Every row is validated with the same schema as the form; one roster entry per
// email (unique index), so a re-uploaded file adds nothing twice.
const HEADER = ["name", "email", "country", "payoutChain", "payoutAddress", "defaultAmount"];
export function parseRosterCsv(csv: string): { rows: z.infer<typeof contractorSchema>[]; errors: { line: number; error: string }[] } {
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return { rows: [], errors: [{ line: 1, error: "Add a header row and at least one contractor" }] };
  if (lines.length > 501) return { rows: [], errors: [{ line: 1, error: "At most 500 contractors per file" }] };
  const header = splitCsvLine(lines[0]).map(h => h.trim());
  const missing = HEADER.filter(h => !header.includes(h));
  if (missing.length) return { rows: [], errors: [{ line: 1, error: `Missing column(s): ${missing.join(", ")}` }] };
  const rows: z.infer<typeof contractorSchema>[] = []; const errors: { line: number; error: string }[] = [];
  for (const [i, line] of lines.slice(1).entries()) {
    const cells = splitCsvLine(line);
    const get = (k: string) => (cells[header.indexOf(k)] ?? "").trim();
    const parsed = contractorSchema.safeParse({
      requestId: crypto.randomUUID(), name: get("name"), email: get("email"), country: get("country").toUpperCase(),
      payoutChain: get("payoutChain").toLowerCase(), payoutAddress: get("payoutAddress"), defaultAmount: get("defaultAmount"),
      ...(header.includes("role") && get("role") ? { role: get("role") } : {}),
    });
    if (parsed.success) rows.push(parsed.data); else errors.push({ line: i + 2, error: parsed.error.issues.map(x => `${x.path.join(".")}: ${x.message}`).join("; ") });
  }
  return { rows, errors };
}

/** RFC 4180 quoting ("a, b" and "" escapes); no multi-line fields. */
function splitCsvLine(line: string): string[] {
  const out: string[] = []; let cur = ""; let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') quoted = false; else cur += ch; }
    else if (ch === '"') quoted = true; else if (ch === ",") { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur);
  return out;
}

export async function importRoster(owner: string, csv: string) {
  requireStorage();
  const { rows, errors } = parseRosterCsv(csv);
  if (errors.length) return { imported: 0, skipped: 0, errors };
  const now = new Date().toISOString();
  const existing = new Set((await sbSelect<{ email: string }>("payroll_contractors", `select=email&merchant_id=eq.${eq(owner)}&limit=5000`)).map(r => r.email.toLowerCase()));
  const fresh = rows.filter((r, i) => !existing.has(r.email.toLowerCase()) && rows.findIndex(x => x.email.toLowerCase() === r.email.toLowerCase()) === i);
  if (fresh.length) {
    await sbInsertIgnoreDuplicates("payroll_contractors", fresh.map(r => ({
      id: r.requestId, merchant_id: owner, name: r.name, email: r.email, role: r.role ?? "", country: r.country, payout_chain: r.payoutChain,
      payout_address: r.payoutAddress, default_amount_units: parseUsdc(r.defaultAmount).toString(), tax_status: "unsubmitted", active: true, created_at: now, updated_at: now,
    })));
  }
  const saved = await sbSelect<Contractor>("payroll_contractors", `select=${CONTRACTOR_COLUMNS}&merchant_id=eq.${eq(owner)}&id=in.(${fresh.map(r => r.requestId).join(",") || "00000000-0000-0000-0000-000000000000"})&limit=500`);
  return { imported: saved.length, skipped: rows.length - saved.length, errors: [] as { line: number; error: string }[] };
}
