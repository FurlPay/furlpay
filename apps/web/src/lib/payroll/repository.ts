import { sbCount, sbInsertIgnoreDuplicates, sbRpc, sbSelect, sbUpdate, supabaseBackend } from "@/lib/supabase";
import { parseUsdc } from "@/lib/payments/merchant/money";
import { screenAddressRisk } from "@/lib/compliance/addressScreening";
import { configuredRouter, createPayment, routerEnvName } from "@/lib/services/payments";
import { IntegrationNotConfiguredError } from "@/lib/integrations";
import { recoverPayrollSigner, type SignData } from "./signing";
import { lineFee, PAYROLL_BATCH_BPS, PAYROLL_BATCH_MIN_UNITS, PAYROLL_SEAT_UNITS, unitsToUsd } from "./pricing";
import type { Batch, BatchInput, BatchLine, Contractor, ContractorInput, ContractorPatch, PayrollChain } from "./model";

// Saved payroll roster and batches (migration 0042). Payroll stays
// non-custodial: submitting a batch mints one FurlPayRouter payment intent per
// line for the EMPLOYER's wallet to sign. FurlPay never holds the payroll funds,
// so nothing here posts to the ledger or marks anyone paid.
export class PayrollUnavailable extends Error {}
export class PayrollConflict extends Error {}
const CONTRACTOR_COLUMNS = "id,merchant_id,name,email,role,country,payout_chain,payout_address,default_amount_units,tax_status,tax_form,tin_last4,tax_signed_on,tax_expires_on,active,created_at,updated_at";
export function requireStorage() { if (supabaseBackend !== "supabase") throw new PayrollUnavailable("Payroll storage is not configured"); }
const eq = (v: string) => encodeURIComponent(v);

export async function listContractors(owner: string) {
  requireStorage();
  // Explicit columns: the sealed tax blob never leaves the server, even encrypted.
  return sbSelect<Contractor>("payroll_contractors", `select=${CONTRACTOR_COLUMNS}&merchant_id=eq.${eq(owner)}&order=created_at.desc&limit=500`);
}

export async function createContractor(owner: string, input: ContractorInput) {
  requireStorage();
  const now = new Date().toISOString();
  const row: Contractor = {
    id: input.requestId, merchant_id: owner, name: input.name, email: input.email, role: input.role ?? "", country: input.country,
    payout_chain: input.payoutChain, payout_address: input.payoutAddress, default_amount_units: parseUsdc(input.defaultAmount).toString(),
    tax_status: "unsubmitted", active: true, created_at: now, updated_at: now,
  };
  await sbInsertIgnoreDuplicates("payroll_contractors", row);
  const saved = (await sbSelect<Contractor>("payroll_contractors", `select=${CONTRACTOR_COLUMNS}&id=eq.${eq(input.requestId)}&merchant_id=eq.${eq(owner)}&limit=1`))[0];
  if (!saved) throw new PayrollConflict("Request ID already in use");
  return saved;
}

export async function updateContractor(owner: string, input: ContractorPatch) {
  requireStorage();
  // Whitelisted columns only; tax_status is not writable here (no form flow yet).
  const patch: Partial<Contractor> = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) patch.name = input.name;
  if (input.email !== undefined) patch.email = input.email;
  if (input.role !== undefined) patch.role = input.role;
  if (input.country !== undefined) patch.country = input.country;
  if (input.payoutChain !== undefined) patch.payout_chain = input.payoutChain;
  if (input.payoutAddress !== undefined) patch.payout_address = input.payoutAddress;
  if (input.defaultAmount !== undefined) patch.default_amount_units = parseUsdc(input.defaultAmount).toString();
  if (input.active !== undefined) patch.active = input.active;
  const row = (await sbUpdate<Contractor & { tax_sealed?: string }>("payroll_contractors", `id=eq.${eq(input.id)}&merchant_id=eq.${eq(owner)}`, patch))[0];
  if (!row) return null;
  const { tax_sealed: _sealed, ...visible } = row;
  return visible;
}

export async function listBatches(owner: string) {
  requireStorage();
  return sbSelect<Batch>("payroll_batches", `merchant_id=eq.${eq(owner)}&order=created_at.desc&limit=100`);
}

export async function batchDetail(owner: string, id: string) {
  requireStorage();
  const batch = (await sbSelect<Batch>("payroll_batches", `id=eq.${eq(id)}&merchant_id=eq.${eq(owner)}&limit=1`))[0];
  if (!batch) return null;
  const lines = await sbSelect<BatchLine>("payroll_batch_lines", `batch_id=eq.${eq(id)}&order=created_at.asc&limit=100`);
  return { batch, lines };
}

type Screening = BatchLine["screening"];
/** Fail closed: a screening outage blocks the line, it never clears it. */
export async function screenRecipient(address: string, chain: string): Promise<Screening> {
  try { return (await screenAddressRisk(address, chain)).action === "allow" ? "clear" : "blocked"; }
  catch { return "unavailable"; }
}

export async function createBatch(owner: string, input: BatchInput) {
  requireStorage();
  const existing = await batchDetail(owner, input.requestId);
  if (existing) return existing;
  const ids = input.lines.map(l => l.contractorId);
  const roster = await sbSelect<Contractor>("payroll_contractors", `merchant_id=eq.${eq(owner)}&id=in.(${ids.map(eq).join(",")})&limit=100`);
  const byId = new Map(roster.map(c => [c.id, c]));
  const lines = [];
  for (const l of input.lines) {
    const c = byId.get(l.contractorId);
    if (!c) throw new PayrollConflict("A contractor in this batch was not found");
    if (!c.active) throw new PayrollConflict(`${c.name} is inactive`);
    if (c.payout_chain !== input.chain) throw new PayrollConflict(`${c.name} is paid on ${c.payout_chain}, not ${input.chain}`);
    const units = l.amount ? parseUsdc(l.amount) : BigInt(String(c.default_amount_units));
    lines.push({ contractor_id: c.id, name: c.name, recipient: c.payout_address, amount_units: units.toString(), screening: await screenRecipient(c.payout_address, input.chain) });
  }
  const seats = await sbCount("payroll_contractors", `merchant_id=eq.${eq(owner)}&active=eq.true`);
  await sbRpc<Batch>("payroll_batch_create", {
    p_id: input.requestId, p_merchant: owner, p_cycle: input.cycle, p_chain: input.chain, p_lines: lines,
    p_seats: seats, p_batch_bps: PAYROLL_BATCH_BPS, p_batch_min_units: PAYROLL_BATCH_MIN_UNITS.toString(), p_seat_units: PAYROLL_SEAT_UNITS.toString(),
  });
  return batchDetail(owner, input.requestId);
}

export async function cancelBatch(owner: string, id: string) {
  requireStorage();
  const rows = await sbUpdate<Batch>("payroll_batches", `id=eq.${eq(id)}&merchant_id=eq.${eq(owner)}&status=in.(draft,blocked)`, { status: "cancelled" });
  if (!rows[0]) throw new PayrollConflict("Only draft or blocked batches can be cancelled");
  return rows[0];
}

/** Production without a deployed router on the batch's chain cannot produce a signable intent. */
export function routerConfigured(chain: PayrollChain) { return process.env.NODE_ENV !== "production" || Boolean(configuredRouter(chain)); }
/** On-chain execution needs a real router address in every environment (the dev placeholder is not an address). */
export function executionAvailable(chain: PayrollChain) { return /^0x[0-9a-fA-F]{40}$/.test(configuredRouter(chain) ?? ""); }
const routerMissing = (chain: PayrollChain) => new IntegrationNotConfiguredError(`FurlPayRouter on ${chain} (${routerEnvName(chain)})`);

type Issued = Awaited<ReturnType<typeof createPayment>>;
const deadlineOf = (i: Issued) => new Date(Number(i.signData.message.deadline) * 1000).toISOString();

export async function submitBatch(owner: string, id: string, userId: string) {
  requireStorage();
  const pending = (await sbSelect<Batch>("payroll_batches", `select=id,chain&id=eq.${eq(id)}&merchant_id=eq.${eq(owner)}&limit=1`))[0];
  if (!pending) return null;
  if (!routerConfigured(pending.chain)) throw routerMissing(pending.chain);
  // Compare-and-set: exactly one request moves a draft forward.
  const claimed = (await sbUpdate<Batch>("payroll_batches", `id=eq.${eq(id)}&merchant_id=eq.${eq(owner)}&status=eq.draft`, { status: "submitting" }))[0];
  if (!claimed) {
    const current = await batchDetail(owner, id);
    if (!current) return null;
    throw new PayrollConflict(current.batch.status === "blocked" ? "This batch has recipients that did not clear screening" : `This batch is ${current.batch.status}`);
  }
  const lines = await sbSelect<BatchLine>("payroll_batch_lines", `batch_id=eq.${eq(id)}&order=created_at.asc&limit=100`);
  let intents: Issued[];
  try {
    // Build every intent before recording any, so a failure leaves no half-submitted batch.
    intents = await Promise.all(lines.map(l => issue(claimed, l, userId, 0)));
  } catch (e) {
    await sbUpdate<Batch>("payroll_batches", `id=eq.${eq(id)}&status=eq.submitting`, { status: "draft" });
    throw e;
  }
  // The signing payload is persisted with each line: a refresh or a dropped
  // connection resumes from the database instead of losing it.
  await Promise.all(lines.map((l, i) => sbUpdate<BatchLine>("payroll_batch_lines", `id=eq.${eq(l.id)}&batch_id=eq.${eq(id)}`, { payment_id: intents[i].record.id, sign_data: intents[i].signData, sign_deadline: deadlineOf(intents[i]), issue_count: 1 })));
  await sbUpdate<Batch>("payroll_batches", `id=eq.${eq(id)}&status=eq.submitting`, { status: "submitted", submitted_at: new Date().toISOString() });
  return batchDetail(owner, id);
}

function issue(batch: Batch, l: BatchLine, userId: string, n: number) {
  const pay = BigInt(String(l.amount_units));
  const fee = lineFee(pay);
  return createPayment({
    // The fee rides on top: the router debits pay + fee and the contractor receives exactly `pay`.
    amount: unitsToUsd(pay), sourceChain: batch.chain, settlementChain: batch.chain, units: { amount: pay + fee, fee }, recipient: l.recipient, userId,
    metadata: { kind: "payroll", batch: batch.id, cycle: batch.cycle, name: l.name },
    // A re-issue needs a NEW intent (new nonce and deadline), so the key carries the issue number.
    idempotencyKey: n === 0 ? `payroll:${batch.id}:${l.id}` : `payroll:${batch.id}:${l.id}:${n}`,
  });
}

/** Re-issue every unsigned or expired line of a submitted batch whose deadline has passed. */
export async function reissueExpired(owner: string, id: string, userId: string) {
  requireStorage();
  const detail = await batchDetail(owner, id);
  if (!detail) return null;
  if (!routerConfigured(detail.batch.chain)) throw routerMissing(detail.batch.chain);
  if (detail.batch.status !== "submitted") throw new PayrollConflict("Only submitted batches can be re-issued");
  const now = Date.now();
  const stale = detail.lines.filter(l => !l.executed_tx && l.sign_deadline && Date.parse(l.sign_deadline) <= now);
  if (!stale.length) throw new PayrollConflict("No signing request has expired yet");
  const fresh = await Promise.all(stale.map(l => issue(detail.batch, l, userId, l.issue_count)));
  // Compare-and-set on issue_count: two concurrent re-issues cannot both replace a line.
  await Promise.all(stale.map((l, i) => sbUpdate<BatchLine>("payroll_batch_lines", `id=eq.${eq(l.id)}&batch_id=eq.${eq(id)}&issue_count=eq.${l.issue_count}`,
    { payment_id: fresh[i].record.id, sign_data: fresh[i].signData, sign_deadline: deadlineOf(fresh[i]), issue_count: l.issue_count + 1, signature: null, signer: null, signed_at: null })));
  return batchDetail(owner, id);
}

/** Record the employer's signature for one line after verifying it recovers to the signer the router will check. */
export async function recordSignature(owner: string, batchId: string, lineId: string, signature: `0x${string}`) {
  requireStorage();
  const detail = await batchDetail(owner, batchId);
  if (!detail) return null;
  if (detail.batch.status !== "submitted") throw new PayrollConflict("This batch is not awaiting signatures");
  const line = detail.lines.find(l => l.id === lineId);
  if (!line?.sign_data || !line.sign_deadline) throw new PayrollConflict("This line has no signing request");
  if (Date.parse(line.sign_deadline) <= Date.now()) throw new PayrollConflict("This signing request expired; re-issue it");
  let signer: string;
  try { signer = await recoverPayrollSigner(line.sign_data as SignData, signature); }
  catch (e) { throw new PayrollConflict(e instanceof Error ? e.message : "Invalid signature"); }
  const payer = detail.batch.payer_address;
  if (payer && payer.toLowerCase() !== signer.toLowerCase()) throw new PayrollConflict(`Sign with the wallet that signed this batch (${payer})`);
  if (!payer) {
    const set = await sbUpdate<Batch>("payroll_batches", `id=eq.${eq(batchId)}&payer_address=is.null`, { payer_address: signer });
    if (!set[0]) return recordSignature(owner, batchId, lineId, signature); // another line set it first: re-check
  }
  const updated = await sbUpdate<BatchLine>("payroll_batch_lines", `id=eq.${eq(lineId)}&batch_id=eq.${eq(batchId)}&issue_count=eq.${line.issue_count}`,
    { signature, signer, signed_at: new Date().toISOString() });
  if (!updated[0]) throw new PayrollConflict("This signing request was re-issued; sign the new one");
  return updated[0];
}
