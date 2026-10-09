import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex } from "@/lib/evm/rlp";
import {
  estimateGas,
  getBalance,
  getFeeCaps,
  getTransactionCount,
  RpcError,
  sendRawTransaction,
  waitForReceipt,
  type ChainSlug,
} from "@/lib/evm/rpc";
import type { Eip1559Transaction } from "@/lib/evm/transaction";
import { signTransaction } from "@/lib/wallet";

// ---------------------------------------------------------------------------
// USDC sends on Circle Arc, signed by the device key (ARC-P1-005 / P4-001).
//
// Arc is unlike every other chain this app sends on, in three ways that each
// cost money when ignored:
//
//   * USDC IS THE GAS. One balance pays both the amount and the fee. The
//     canonical balance is `eth_getBalance` at 18 decimals; the ERC-20 view at
//     0x3600… is the same money at 6 decimals and truncates. The pre-flight
//     check is therefore amount×10^12 + max fee ≤ native balance, in ONE unit.
//   * THE FEE IS ALREADY DOLLARS. gas × maxFeePerGas is USDC at 18dp. It is
//     shown as USDC directly — never multiplied by an ETH price.
//   * A 20 gwei BASE-FEE FLOOR. A transaction priced below it is dropped
//     without an error; the caps are lifted to at least twice the floor.
//
// The amount moves through the ERC-20 `transfer()` at 6 decimals, value 0 —
// the interface every Arc indexer and the FurlPay merchant verifier credit.
// Nothing here is custodial: the user's key signs, behind the biometric gate.
// ---------------------------------------------------------------------------

export type ArcChain = Extract<ChainSlug, "arc" | "arc-testnet">;

export const ARC_NETWORKS: Record<ArcChain, { chainId: number; name: string; explorerTx: string }> = {
  arc: { chainId: 5042, name: "Arc", explorerTx: "https://explorer.arc.io/tx/" },
  "arc-testnet": { chainId: 5042002, name: "Arc Testnet", explorerTx: "https://explorer.testnet.arc.io/tx/" },
};

/** USDC's ERC-20 interface on Arc (both networks). */
export const ARC_USDC = "0x3600000000000000000000000000000000000000";
/** Arc rejects (silently drops) transactions priced below this base fee. */
export const ARC_MIN_BASE_FEE_WEI = 20_000_000_000n;
/** Native 18dp ↔ ERC-20 6dp. */
const SCALE = 1_000_000_000_000n;
/** A USDC transfer() costs ~45k gas; anything far above that is not a plain transfer. */
const MAX_GAS = 200_000n;

const TRANSFER = bytesToHex(keccak_256(new TextEncoder().encode("transfer(address,uint256)")).slice(0, 4));

export class ArcSendError extends Error {
  constructor(readonly code: "invalid_amount" | "invalid_recipient" | "insufficient_funds" | "gas_out_of_bounds" | "signer_mismatch" | "reverted", message: string) {
    super(message);
    this.name = "ArcSendError";
  }
}

/** "12.5" → 12_500_000n. Refuses more than 6 decimals rather than rounding someone's money. */
export function parseUsdc(input: string): bigint {
  const m = /^(\d{1,12})(?:\.(\d{1,6}))?$/.exec(input.trim());
  if (!m) throw new ArcSendError("invalid_amount", "Enter an amount like 12.50 (at most 6 decimals).");
  const units = BigInt(m[1]) * 1_000_000n + BigInt((m[2] ?? "").padEnd(6, "0") || "0");
  if (units <= 0n) throw new ArcSendError("invalid_amount", "The amount must be more than zero.");
  return units;
}

/** USDC at 18 decimals (native balance, fees) → "1.234567", truncated to 6dp. */
export function formatUsdc18(wei: bigint): string {
  const units = wei / SCALE;
  const whole = units / 1_000_000n;
  const frac = (units % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

/** A fee is usually a fraction of a cent; say so instead of rounding it to "0". */
export function formatFee(wei: bigint): string {
  if (wei === 0n) return "0 USDC";
  if (wei < 10_000_000_000_000n) return "< 0.00001 USDC";
  return `${formatUsdc18(wei)} USDC`;
}

export function encodeUsdcTransfer(to: string, amount: bigint): string {
  const clean = to.replace(/^0x/i, "").toLowerCase();
  return TRANSFER + clean.padStart(64, "0") + amount.toString(16).padStart(64, "0");
}

function checkRecipient(to: string, from: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(to)) throw new ArcSendError("invalid_recipient", "That is not a valid address (0x followed by 40 hex characters).");
  const lower = to.toLowerCase();
  if (/^0x0{40}$/.test(lower)) throw new ArcSendError("invalid_recipient", "Sending to the zero address destroys the funds.");
  if (lower === ARC_USDC) throw new ArcSendError("invalid_recipient", "That is the USDC contract itself, not a wallet. Funds sent there are lost.");
  if (lower === from.toLowerCase()) throw new ArcSendError("invalid_recipient", "That is your own address.");
  return to;
}

export interface PreparedArcSend {
  chain: ArcChain;
  from: string;
  to: string;
  amount: bigint;
  tx: Eip1559Transaction;
  /** The most this can cost in fees, USDC at 18dp. */
  maxFee: bigint;
  /** Native balance read for the check, USDC at 18dp. */
  balance: bigint;
}

/**
 * Everything up to — not including — the signature. Reads only.
 *
 * The balance check happens HERE, before the biometric prompt: a transfer that
 * would revert for lack of funds still burns its gas, and on Arc that gas is
 * the same USDC the user was trying to send.
 */
export async function prepareArcSend(input: { chain: ArcChain; from: string; to: string; amount: string }): Promise<PreparedArcSend> {
  const { chain, from } = input;
  const amount = parseUsdc(input.amount);
  const to = checkRecipient(input.to.trim(), from);
  const data = encodeUsdcTransfer(to, amount);

  const [balance, nonce, caps, gasLimit] = await Promise.all([
    getBalance(chain, from),
    getTransactionCount(chain, from),
    getFeeCaps(chain),
    estimateGas(chain, { from, to: ARC_USDC, data }),
  ]);
  if (gasLimit <= 0n || gasLimit > MAX_GAS) throw new ArcSendError("gas_out_of_bounds", `The network quoted ${gasLimit} gas for a USDC transfer; refusing to sign.`);

  const floorCap = ARC_MIN_BASE_FEE_WEI * 2n;
  const maxFeePerGas = caps.maxFeePerGas > floorCap ? caps.maxFeePerGas : floorCap;
  const maxPriorityFeePerGas = caps.maxPriorityFeePerGas > maxFeePerGas ? maxFeePerGas : caps.maxPriorityFeePerGas;
  const maxFee = gasLimit * maxFeePerGas;

  if (amount * SCALE + maxFee > balance) {
    throw new ArcSendError("insufficient_funds", `You have ${formatUsdc18(balance)} USDC on ${ARC_NETWORKS[chain].name}; sending ${formatUsdc18(amount * SCALE)} needs up to ${formatFee(maxFee)} more for the fee.`);
  }

  return {
    chain, from, to, amount, balance, maxFee,
    tx: { chainId: ARC_NETWORKS[chain].chainId, nonce, maxFeePerGas, maxPriorityFeePerGas, gasLimit, to: ARC_USDC, value: 0n, data },
  };
}

/** Signs (biometric), broadcasts, and waits for the receipt. Arc is final in one block. */
export async function sendArcUsdc(prepared: PreparedArcSend): Promise<{ hash: string; explorerUrl: string }> {
  const signed = await signTransaction(prepared.tx);
  if (signed.from.toLowerCase() !== prepared.from.toLowerCase()) {
    throw new ArcSendError("signer_mismatch", "The wallet on this device is not the address the transfer was prepared for.");
  }
  let hash = signed.hash;
  try {
    const broadcast = await sendRawTransaction(prepared.chain, signed.raw);
    if (broadcast && broadcast.toLowerCase() !== signed.hash.toLowerCase()) hash = broadcast;
  } catch (e) {
    // "already known" means a previous attempt reached the node; follow that hash.
    if (!(e instanceof RpcError && /already known/i.test(e.message))) throw e;
  }
  const receipt = await waitForReceipt(prepared.chain, hash, { timeoutMs: 60_000, intervalMs: 1_500, replacementWatch: { from: prepared.from, nonce: prepared.tx.nonce } });
  if (receipt.status !== "0x1") throw new ArcSendError("reverted", `The transfer was mined but reverted (${hash}). The fee was charged; the amount was not sent.`);
  return { hash, explorerUrl: ARC_NETWORKS[prepared.chain].explorerTx + hash };
}
