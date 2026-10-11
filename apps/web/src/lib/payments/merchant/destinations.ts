import { verifyMessage } from "viem";
import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { sbInsert, sbSelect } from "@/lib/supabase";
import { paymentChain, requiredConfirmations, type PaymentChainId } from "./registry";
import { isSuiAddress, verifySuiPersonalMessage } from "./sui";
import { requireStorage } from "./repository";
import { registrationMessage } from "./destinationMessage";

// Registering collection addresses (merchant_payment_destinations, 0040).
//
// A destination is live the moment it is inserted: the next checkout can hand
// it to a customer. An address nobody controls would receive real USDC and lose
// it, so registration requires PROOF OF CONTROL: the address itself signs a
// message naming the merchant, chain, address and custody reference (EIP-191
// for EVM, Ed25519 for Solana — the same primitives as lib/payouts/ownership).
// The custody provider that holds the key produces that signature. FurlPay
// never generates, derives or stores keys for collection addresses, so there is
// deliberately no "generate N addresses" path.
export { registrationMessage };

export async function provesControl(chain: PaymentChainId, address: string, message: string, signature: string): Promise<boolean> {
  try {
    if (chain === "sui") return verifySuiPersonalMessage(address, message, signature);
    if (chain === "solana") return nacl.sign.detached.verify(new TextEncoder().encode(message), bs58.decode(signature), new PublicKey(address).toBytes());
    if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) return false;
    return await verifyMessage({ address: address as `0x${string}`, message, signature: signature as `0x${string}` });
  } catch { return false; }
}

export class DestinationRejected extends Error {}

export async function registerDestination(input: { merchantId: string; chain: PaymentChainId; address: string; custodyReference: string; signature: string }) {
  requireStorage();
  if (requiredConfirmations(input.chain) === null) throw new DestinationRejected(`${input.chain} has no reviewed deposit policy; it is not collected`);
  const family = paymentChain(input.chain).family;
  const valid = family === "sui" ? isSuiAddress(input.address)
    : family === "solana" ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(input.address)
    : /^0x[0-9a-fA-F]{40}$/.test(input.address) && !/^0x0{40}$/i.test(input.address);
  if (!valid) throw new DestinationRejected(`Not a valid ${input.chain} address`);
  const message = registrationMessage(input.merchantId, input.chain, input.address, input.custodyReference);
  if (!(await provesControl(input.chain, input.address, message, input.signature))) throw new DestinationRejected("The signature does not prove control of this address for this registration");
  const taken = await sbSelect<{ id: string }>("merchant_payment_destinations", `select=id&chain=eq.${input.chain}&address=${family === "evm" ? "ilike" : "eq"}.${encodeURIComponent(input.address)}&limit=1`);
  if (taken[0]) throw new DestinationRejected("This address is already registered");
  const [row] = await sbInsert("merchant_payment_destinations", {
    merchant_id: input.merchantId, chain: input.chain, address: input.address,
    // The custody reference is the provider's wallet ID, kept verbatim for operations to look it up.
    // The approving admin is recorded by requireRole("admin")'s mutation audit.
    custody_reference: input.custodyReference, approved_at: new Date().toISOString(),
  });
  return row;
}

export async function destinationInventory() {
  requireStorage();
  const rows = await sbSelect<{ merchant_id: string; chain: string; assigned_intent: string | null }>("merchant_payment_destinations", "select=merchant_id,chain,assigned_intent&limit=10000");
  const out = new Map<string, { merchantId: string; chain: string; free: number; used: number }>();
  for (const r of rows) {
    const k = `${r.merchant_id}:${r.chain}`;
    const v = out.get(k) ?? { merchantId: r.merchant_id, chain: r.chain, free: 0, used: 0 };
    if (r.assigned_intent) v.used++; else v.free++;
    out.set(k, v);
  }
  return [...out.values()];
}
