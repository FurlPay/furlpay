import { PublicKey } from "@solana/web3.js";
import { paymentChain } from "./registry";
import { displayUsdc } from "./money";
import { isSuiAddress } from "./sui";
/** EVM binding is the permanently reserved recipient, not a made-up ERC-20 memo parameter. */
export function paymentUri(chainId: string, recipient: string, units: string, reference: string): string {
  const chain = paymentChain(chainId);
  if (!/^\d+$/.test(units) || BigInt(units) <= 0n) throw new Error("Invalid payment amount");
  if (chain.family === "sui") {
    // Sui has no payment-request URI standard: the QR carries the address, and
    // the page states the exact amount. The address is single-use for this checkout.
    if (!isSuiAddress(recipient)) throw new Error("Invalid recipient");
    return recipient;
  }
  if (chain.family === "solana") {
    new PublicKey(recipient); new PublicKey(reference);
    const params = new URLSearchParams({ amount: displayUsdc(units, 0), "spl-token": chain.token, reference, label: "FurlPay", message: "USDC payment" });
    return `solana:${recipient}?${params}`;
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(recipient) || /^0x0{40}$/i.test(recipient)) throw new Error("Invalid recipient");
  return `ethereum:${chain.token}@${chain.chainId}/transfer?address=${recipient}&uint256=${BigInt(units)}`;
}
