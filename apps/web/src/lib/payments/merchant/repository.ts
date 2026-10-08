import { randomBytes } from "crypto";
import { PublicKey } from "@solana/web3.js";
import { sbInsertIgnoreDuplicates, sbSelect, sbRpc, sbUpdate, supabaseBackend } from "@/lib/supabase";
import { parseUsdc } from "./money";
import { startBlock } from "./rpc";
import type { LinkInput, MerchantIntent, MerchantLink } from "./model";
import { requiredConfirmations, type PaymentChainId } from "./registry";
export class MerchantUnavailable extends Error {}
export function requireStorage() { if(supabaseBackend !== "supabase") throw new MerchantUnavailable("Merchant payment storage is not configured"); }
const eq = (v: string) => encodeURIComponent(v);
export async function listMerchant(owner: string) {
  requireStorage();
  const [links,intents] = await Promise.all([
    sbSelect<MerchantLink>("merchant_payment_links",`merchant_id=eq.${eq(owner)}&order=created_at.desc&limit=500`),
    sbSelect<MerchantIntent>("merchant_payment_intents",`merchant_id=eq.${eq(owner)}&order=created_at.desc&limit=500`),
  ]);
  return { links, intents, limit: 500 };
}
export async function createLink(owner: string, merchantName: string, input: LinkInput) {
  requireStorage();
  const existing = (await sbSelect<MerchantLink>("merchant_payment_links",`id=eq.${eq(input.requestId)}&merchant_id=eq.${eq(owner)}&limit=1`))[0];
  if(existing) return existing;
  if(input.expiresAt && Date.parse(input.expiresAt) <= Date.now()) throw new MerchantUnavailable("Choose an expiration in the future");
  const row: MerchantLink = { id: input.requestId, merchant_id:owner, merchant_name:merchantName.slice(0,120), slug:randomBytes(18).toString("base64url"), title:input.title,description:input.description,amount_units:parseUsdc(input.amount).toString(),processing_bps:75,fee_payer:input.feePayer,chains:input.chains,reusable:input.reusable,active:true,kind:input.kind,reference:input.reference,lines:input.lines,expires_at:input.expiresAt,created_at:new Date().toISOString() };
  await sbInsertIgnoreDuplicates("merchant_payment_links",row);
  const saved = (await sbSelect<MerchantLink>("merchant_payment_links",`id=eq.${eq(input.requestId)}&merchant_id=eq.${eq(owner)}&limit=1`))[0];
  if(!saved) throw new MerchantUnavailable("Request ID already in use");
  return saved;
}
export async function setLinkActive(owner: string, id: string, active: boolean) {
  requireStorage();
  return (await sbUpdate<MerchantLink>("merchant_payment_links",`id=eq.${eq(id)}&merchant_id=eq.${eq(owner)}`,{active}))[0] ?? null;
}
export async function getLink(slug: string) {
  requireStorage();
  return (await sbSelect<MerchantLink>("merchant_payment_links",`slug=eq.${eq(slug)}&limit=1`))[0] ?? null;
}
export async function getIntent(id: string, linkId: string) {
  requireStorage();
  return (await sbSelect<MerchantIntent>("merchant_payment_intents",`id=eq.${eq(id)}&link_id=eq.${eq(linkId)}&limit=1`))[0] ?? null;
}
export async function reserveIntent(slug: string, id: string, chain: PaymentChainId) {
  requireStorage();
  // No reviewed deposit policy → no collection on that chain (never a guessed depth).
  if (requiredConfirmations(chain) === null) throw new MerchantUnavailable("rail_unavailable");
  // Existing environment RPC settings are reused; no client-provided endpoints.
  const block = await startBlock(chain);
  const reference = new PublicKey(randomBytes(32)).toBase58();
  return sbRpc<MerchantIntent>("merchant_checkout_reserve",{p_id:id,p_slug:slug,p_chain:chain,p_reference:reference,p_start_block:block});
}
export async function availableChains(chains: PaymentChainId[], owner: string) {
  requireStorage();
  const rows = await sbSelect<{chain: PaymentChainId}>("merchant_payment_destinations",`select=chain&assigned_intent=is.null&merchant_id=eq.${eq(owner)}&limit=1000`);
  return chains.filter(c=>requiredConfirmations(c)!==null && rows.some(r=>r.chain===c));
}
export async function paymentDetail(owner: string, id: string) {
  requireStorage();
  const intent = (await sbSelect<MerchantIntent>("merchant_payment_intents",`merchant_id=eq.${eq(owner)}&id=eq.${eq(id)}&limit=1`))[0];
  if(!intent) return null;
  const [events,receipts] = await Promise.all([
    sbSelect<{status:string;detail:string;created_at:string}>("merchant_payment_events",`intent_id=eq.${eq(id)}&select=status,detail,created_at&order=created_at.asc&limit=100`),
    sbSelect<{tx_hash:string;amount_units:string;payer:string;block_number:string;block_hash:string;observed_at:string}>("merchant_payment_receipts",`intent_id=eq.${eq(id)}&select=tx_hash,amount_units,payer,block_number,block_hash,observed_at&order=created_at.asc&limit=100`),
  ]);
  return {intent,events,receipts};
}
