import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { NETWORKS, units } from "./networks";
import { networkIdSchema } from "./network-contract";
import { nodeRead, verifyNetwork } from "./network-reader";
import type { NetworkSearchResult } from "./search-contract";

export const searchInput = z.object({ chain: networkIdSchema, q: z.string().trim().min(32).max(88) }).superRefine(({ chain, q }, ctx) => {
  let valid = false;
  if (chain !== "solana") valid = /^0x(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/.test(q);
  else {
    try { valid = new PublicKey(q).toBase58() === q; } catch { /* Could be a signature. */ }
    if (!valid) valid = /^[1-9A-HJ-NP-Za-km-z]{87,88}$/.test(q);
  }
  if (!valid) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a complete address or transaction hash for the selected network.", path: ["q"] });
});
const quantity = z.string().regex(/^0x[0-9a-f]+$/i);
const hash = z.string().regex(/^0x[0-9a-f]{64}$/i);
const address = z.string().regex(/^0x[0-9a-f]{40}$/i);

export async function searchNetwork(input: z.infer<typeof searchInput>): Promise<NetworkSearchResult> {
  const { chain, q } = searchInput.parse(input);
  const network = NETWORKS.find((n) => n.id === chain)!;
  const signal = AbortSignal.timeout(8000);
  await verifyNetwork(network, signal);
  const kind = chain === "solana" ? (q.length > 44 ? "tx" : "address") : q.length === 66 ? "tx" : "address";
  const fields: NetworkSearchResult["fields"] = [];
  let found = true;
  if (chain === "solana") {
    if (kind === "address") {
      const value = z.object({ context: z.object({ slot: z.number().int().safe() }), value: z.number().int().nonnegative() }).parse(await nodeRead(network, "getBalance", [q, { commitment: "confirmed" }], signal));
      // Above 2^53 lamports (~9M SOL) the JSON number has already lost precision: say so rather than fail or overstate it.
      const exact = Number.isSafeInteger(value.value);
      fields.push({ label: exact ? "SOL balance (confirmed)" : "SOL balance (confirmed, approximate)", value: `${exact ? "" : "≈ "}${units(BigInt(value.value).toString(), 9)}` }, { label: "Context slot", value: String(value.context.slot) });
    } else {
      const result = z.object({ value: z.array(z.object({ slot: z.number().int().safe(), err: z.unknown(), confirmationStatus: z.enum(["processed", "confirmed", "finalized"]).nullable() }).nullable()).length(1) }).parse(await nodeRead(network, "getSignatureStatuses", [[q], { searchTransactionHistory: true }], signal));
      const tx = result.value[0]; found = tx !== null;
      if (tx) fields.push({ label: "Slot", value: String(tx.slot) }, { label: "Commitment", value: tx.confirmationStatus ?? "Unknown" }, { label: "Execution", value: tx.err === null ? "Succeeded" : "Failed" });
    }
  } else if (kind === "address") {
    const tip = z.object({ number: quantity, hash }).parse(await nodeRead(network, "eth_getBlockByNumber", ["latest", false], signal));
    const at = { blockHash: tip.hash, requireCanonical: true };
    const [balance, usdc] = await Promise.all([
      nodeRead(network, "eth_getBalance", [q, at], signal),
      nodeRead(network, "eth_call", [{ to: network.token, data: `0x70a08231${q.slice(2).padStart(64, "0")}` }, at], signal),
    ]);
    fields.push({ label: `${chain === "polygon" ? "POL" : "ETH"} balance`, value: units(BigInt(quantity.parse(balance)).toString(), 18) }, { label: "Native USDC balance", value: units(BigInt(hash.parse(usdc)).toString()) }, { label: "Block", value: BigInt(tip.number).toString() }, { label: "Block hash", value: tip.hash });
  } else {
    const receipt = z.object({ transactionHash: hash, blockNumber: quantity, blockHash: hash, from: address, to: address.nullable(), status: z.enum(["0x0", "0x1"]) }).nullable().parse(await nodeRead(network, "eth_getTransactionReceipt", [q], signal));
    found = receipt !== null;
    if (receipt) {
      if (receipt.transactionHash.toLowerCase() !== q.toLowerCase()) throw new Error("Wrong transaction returned");
      fields.push({ label: "Execution", value: receipt.status === "0x1" ? "Succeeded" : "Failed" }, { label: "Block", value: BigInt(receipt.blockNumber).toString() }, { label: "Block hash", value: receipt.blockHash }, { label: "From", value: receipt.from }, { label: "To", value: receipt.to ?? "Contract creation" });
    }
  }
  return { chain, query: q, kind, checkedAt: new Date().toISOString(), found, fields };
}
