import { getAddress, recoverTypedDataAddress } from "viem";

// Off-chain check of a payroll authorization, matching FurlPayRouter._execute:
// the EIP-712 digest over Payment(paymentId, recipient, amount, fee, nonce,
// deadline) must recover to the payer. OpenZeppelin's ECDSA.recover also
// rejects malleable signatures (s in the upper half of the curve order) and
// v other than 27/28; a signature it would revert on is refused here, so a
// stored signature is one the router can actually execute.
export type SignData = {
  domain: { name: string; version: string; chainId: number; verifyingContract: string };
  types: { Payment: { name: string; type: string }[] };
  primaryType: "Payment";
  message: { paymentId: string; recipient: string; amount: string; fee: string; nonce: string; deadline: number };
};
const HALF_N = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n;

export function assertRouterSignature(signature: string): asserts signature is `0x${string}` {
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new Error("Signature must be 65 bytes");
  const s = BigInt("0x" + signature.slice(66, 130));
  const v = parseInt(signature.slice(130, 132), 16);
  if (s > HALF_N) throw new Error("Non-canonical signature (high s) — the router would reject it");
  if (v !== 27 && v !== 28) throw new Error("Signature v must be 27 or 28");
}

export async function recoverPayrollSigner(data: SignData, signature: string): Promise<string> {
  assertRouterSignature(signature);
  if (!/^0x[0-9a-fA-F]{40}$/.test(data.domain.verifyingContract)) throw new Error("FurlPayRouter is not deployed for this environment");
  const signer = await recoverTypedDataAddress({
    domain: { ...data.domain, verifyingContract: getAddress(data.domain.verifyingContract) },
    types: data.types,
    primaryType: "Payment",
    message: {
      paymentId: data.message.paymentId,
      recipient: getAddress(data.message.recipient),
      amount: BigInt(data.message.amount),
      fee: BigInt(data.message.fee),
      nonce: data.message.nonce as `0x${string}`,
      deadline: BigInt(data.message.deadline),
    },
    signature,
  });
  return signer;
}
