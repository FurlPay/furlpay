import * as SecureStore from "expo-secure-store";
import { base58 } from "@scure/base";
import { authorizeMoneyMove } from "../money/authorize";
import { deriveSolanaKey } from "./wallet";
import {
  buildTransferCheckedInstruction,
  buildCreateAtaInstruction,
  getAssociatedTokenAddress,
  tokenProgramForMint,
  FURL_MINT,
  FURL_DECIMALS,
  TOKEN_2022_PROGRAM_ID,
  type TransactionInstruction,
} from "./spl";
import {
  getLatestBlockhash,
  getAccountInfo,
  getTokenAccountBalance,
  sendRawTransaction,
  confirmTransaction,
  RpcError,
  TransactionError,
} from "./rpc";
import { furlToBaseUnits, checkSufficientBalance } from "./amount";

// ---------------------------------------------------------------------------
// Sending SPL tokens from the device wallet.
//
// ORDER OF OPERATIONS, AND WHY IT IS THIS ORDER:
//   1. validate the recipient           — before anything costs anything
//   2. check the sender's balance       — a failure here is free; on-chain it is not
//   3. biometric gate                   — the user's approval IS the key read
//   4. derive the key, use it, zero it  — the key exists for as few lines as possible
//   5. submit, then confirm             — and never report "sent" before both
//
// THE RECIPIENT IS A WALLET, NOT A TOKEN ACCOUNT. Callers pass an owner address;
// this module derives the ATA. Accepting a token account as the recipient is a
// common integration bug — it usually works, right up until someone passes a
// wallet and the tokens land somewhere unspendable.
//
// TRANSFERCHECKED, ALWAYS. It carries the mint and the decimals, so the runtime
// rejects a wrong-mint or wrong-scale transfer instead of settling it. Bare
// `Transfer` moves whatever number it is handed.
// ---------------------------------------------------------------------------

const MNEMONIC_KEY = "furlpay.wallet.mnemonic";
const SECURE_OPTS: SecureStore.SecureStoreOptions = {
  requireAuthentication: true,
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

/** Rent for one token account. The sender pays it when creating the recipient's. */
export const ATA_RENT_LAMPORTS = 2_039_280;

export class TransferError extends Error {
  readonly reason:
    | "invalid_recipient"
    | "invalid_amount"
    | "insufficient_balance"
    | "no_wallet"
    | "cancelled"
    | "rpc"
    | "not_confirmed";
  constructor(reason: TransferError["reason"], message: string) {
    super(message);
    this.name = "TransferError";
    this.reason = reason;
  }
}

/** A Solana address is 32 bytes of base58 — decoded, not pattern-matched. */
export function isValidRecipient(address: string): boolean {
  try {
    return base58.decode(address).length === 32;
  } catch {
    return false;
  }
}

export interface TransferPlan {
  mint: string;
  tokenProgramId: string;
  decimals: number;
  senderOwner: string;
  senderAta: string;
  recipientOwner: string;
  recipientAta: string;
  amountBaseUnits: bigint;
  /** True when the recipient has no token account and one must be created. */
  needsAtaCreation: boolean;
  /** Lamports the sender pays in rent, if an ATA is created. */
  rentLamports: number;
  instructions: TransactionInstruction[];
}

/**
 * Build the transfer plan WITHOUT touching the key.
 *
 * Separated from execution so the UI can show the user exactly what will happen
 * — including whether they are about to pay rent for the recipient's account —
 * before the biometric prompt. An approval for an unseen action is not consent.
 */
export async function planSplTransfer(params: {
  mint: string;
  senderOwner: string;
  recipient: string;
  amountBaseUnits: bigint;
  decimals: number;
  tokenProgramId?: string;
  rpcUrl: string;
}): Promise<TransferPlan> {
  const { mint, senderOwner, recipient, amountBaseUnits, decimals, rpcUrl } = params;
  const tokenProgramId = params.tokenProgramId ?? tokenProgramForMint(mint);

  if (!isValidRecipient(recipient)) {
    throw new TransferError("invalid_recipient", "That is not a valid Solana address.");
  }
  if (!isValidRecipient(senderOwner)) {
    throw new TransferError("invalid_recipient", "Sender address is not a valid Solana address.");
  }
  if (recipient === senderOwner) {
    throw new TransferError("invalid_recipient", "Sender and recipient are the same account.");
  }
  if (amountBaseUnits <= 0n) {
    throw new TransferError("invalid_amount", "Amount must be greater than zero.");
  }

  const senderAta = getAssociatedTokenAddress(senderOwner, mint, tokenProgramId);
  const recipientAta = getAssociatedTokenAddress(recipient, mint, tokenProgramId);

  // Balance first: refusing here costs nothing, whereas an under-funded
  // transaction costs a fee and fails after the user has already approved it.
  let held: bigint;
  try {
    held = BigInt((await getTokenAccountBalance(rpcUrl, senderAta)).amount);
  } catch (e) {
    if (e instanceof RpcError && /could not find|not found/i.test(e.message)) {
      throw new TransferError("insufficient_balance", "This account holds none of that token.");
    }
    throw e;
  }

  const sufficient = checkSufficientBalance(held, amountBaseUnits);
  if (!sufficient.ok) {
    throw new TransferError("insufficient_balance", sufficient.detail);
  }

  // An absent recipient ATA is a normal first payment, not an error.
  const recipientAccount = await getAccountInfo(rpcUrl, recipientAta);
  const needsAtaCreation = recipientAccount === null;

  const instructions: TransactionInstruction[] = [];
  if (needsAtaCreation) {
    instructions.push(
      buildCreateAtaInstruction({
        payer: senderOwner,
        owner: recipient,
        mint,
        tokenProgramId,
        idempotent: true,
      }),
    );
  }
  instructions.push(
    buildTransferCheckedInstruction({
      sourceAta: senderAta,
      mint,
      destinationAta: recipientAta,
      owner: senderOwner,
      amount: amountBaseUnits,
      decimals,
      tokenProgramId,
    }),
  );

  return {
    mint,
    tokenProgramId,
    decimals,
    senderOwner,
    senderAta,
    recipientOwner: recipient,
    recipientAta,
    amountBaseUnits,
    needsAtaCreation,
    rentLamports: needsAtaCreation ? ATA_RENT_LAMPORTS : 0,
    instructions,
  };
}

/**
 * Execute a planned transfer.
 *
 * NOTE ON TRANSACTION SERIALIZATION. Signing requires the serialized v0/legacy
 * message bytes. That serializer is not implemented here yet — see
 * `serializeTransaction` below — so this function throws rather than pretending
 * to send. A stub that returned a fake signature would be indistinguishable
 * from a successful payment to every caller, which is exactly the class of
 * fabrication this codebase removes on sight.
 */
export async function executeTransferPlan(
  plan: TransferPlan,
  params: { rpcUrl: string; accountIndex?: number; amountLabel?: string },
): Promise<{ signature: string }> {
  // authorizeMoneyMove, NOT confirmWithBiometrics.
  //
  // `confirmWithBiometrics` returns true outright when the user has switched
  // "Biometric approvals" off in Settings — a reasonable default for an action
  // inside an already-unlocked app, and completely wrong for one that moves
  // money: a settings toggle would become a bypass. `authorizeMoneyMove` runs
  // the risk engine and proves device ownership through a control that has no
  // preference escape hatch. lib/money/__tests__/authBoundary.test.ts enforces
  // this repo-wide and caught this exact mistake here.
  const auth = await authorizeMoneyMove({
    action: "send_funds",
    // The USD value is unknown: FURL has no market price (no pool, no route),
    // so there is nothing honest to convert with. 0 means the amount-scaled
    // rules cannot fire; the action-class rules for `send_funds` still do.
    amountUsd: 0,
    reason: `Send ${params.amountLabel ?? `${plan.amountBaseUnits} base units`} to ${plan.recipientOwner.slice(0, 8)}…`,
    // A recipient with no token account has provably never received this token
    // from anyone, so they cannot be a known beneficiary. Stated as a signal
    // rather than left undefined, because the engine treats `undefined` as "no
    // signal" and this is a real one.
    signals: plan.needsAtaCreation ? { knownBeneficiary: false } : {},
  });
  if (!auth.ok) {
    throw new TransferError(
      auth.kind === "declined" || auth.kind === "auth_failed" ? "cancelled" : "rpc",
      auth.message,
    );
  }

  const mnemonic = await SecureStore.getItemAsync(MNEMONIC_KEY, SECURE_OPTS);
  if (!mnemonic) throw new TransferError("no_wallet", "No wallet on this device.");

  const { blockhash } = await getLatestBlockhash(params.rpcUrl);
  const key = deriveSolanaKey(mnemonic, params.accountIndex ?? 0);
  try {
    if (key.address !== plan.senderOwner) {
      throw new TransferError(
        "invalid_recipient",
        `Account ${params.accountIndex ?? 0} is ${key.address}, but the plan was built for ${plan.senderOwner}.`,
      );
    }

    const serialized = serializeTransaction(plan, blockhash, key);
    const signature = await sendRawTransaction(params.rpcUrl, serialized);

    const confirmed = await confirmTransaction(params.rpcUrl, signature, "confirmed");
    if (!confirmed) {
      // Submitted but unconfirmed. It may still land, so this is explicitly
      // NOT reported as a failure — the signature is returned so the caller can
      // keep checking.
      throw new TransferError(
        "not_confirmed",
        `Submitted but not confirmed yet. Signature: ${signature}`,
      );
    }
    return { signature };
  } finally {
    // The key exists for the length of this block and no longer.
    key.secret.fill(0);
  }
}

/**
 * NOT IMPLEMENTED — legacy/v0 message serialization.
 *
 * Producing signable bytes means building the full Solana message: the header
 * (signature counts and readonly counts), the deduplicated account-key list in
 * its required order (writable-signers, readonly-signers, writable, readonly),
 * the recent blockhash, and each instruction re-encoded with account INDEXES
 * rather than addresses — then compact-u16 lengths throughout.
 *
 * That is a meaningful piece of work with exact ordering rules, and getting the
 * account ordering wrong produces a transaction the runtime rejects, or worse,
 * one that marks the wrong account writable. It is deliberately left unbuilt
 * rather than approximated: everything above it (planning, validation, balance
 * checks, instruction encoding) is verified against the SDK's own output and is
 * useful today, and this throws so no caller can mistake a stub for a send.
 */
export function serializeTransaction(
  _plan: TransferPlan,
  _blockhash: string,
  _key: { secret: Uint8Array; publicKey: Uint8Array; address: string },
): Uint8Array {
  throw new TransferError(
    "rpc",
    "Transaction serialization is not implemented yet. The transfer was NOT sent. " +
      "Instruction construction, ATA derivation, balance checks and confirmation are " +
      "complete and tested; message serialization (account ordering + compact-u16) is the " +
      "remaining piece.",
  );
}

/** Send any SPL token. See executeTransferPlan for the current limitation. */
export async function sendSplToken(params: {
  mint: string;
  recipient: string;
  amount: bigint;
  tokenProgramId?: string;
  decimals: number;
  rpcUrl: string;
  accountIndex?: number;
  senderOwner: string;
}): Promise<{ signature: string }> {
  const plan = await planSplTransfer({
    mint: params.mint,
    senderOwner: params.senderOwner,
    recipient: params.recipient,
    amountBaseUnits: params.amount,
    decimals: params.decimals,
    tokenProgramId: params.tokenProgramId,
    rpcUrl: params.rpcUrl,
  });
  return executeTransferPlan(plan, { rpcUrl: params.rpcUrl, accountIndex: params.accountIndex });
}

/**
 * Send FURL, taking a human-readable amount.
 *
 * The amount is a STRING, not a number: at 6 decimals a FURL amount exceeds
 * what a float represents exactly well inside ordinary balances, and
 * `furlToBaseUnits` refuses excess precision rather than truncating it to a
 * silent zero-value payment.
 */
export async function sendFurl(params: {
  recipient: string;
  amount: string;
  rpcUrl: string;
  senderOwner: string;
  accountIndex?: number;
}): Promise<{ signature: string }> {
  return sendSplToken({
    mint: FURL_MINT,
    recipient: params.recipient,
    amount: furlToBaseUnits(params.amount),
    tokenProgramId: TOKEN_2022_PROGRAM_ID,
    decimals: FURL_DECIMALS,
    rpcUrl: params.rpcUrl,
    accountIndex: params.accountIndex,
    senderOwner: params.senderOwner,
  });
}

export { TransactionError };
