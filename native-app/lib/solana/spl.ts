import { base58 } from "@scure/base";
import {
  TOKEN_2022_PROGRAM,
  TOKEN_LEGACY_PROGRAM,
  ASSOCIATED_TOKEN_PROGRAM,
  getAssociatedTokenAddress,
  AtaError,
} from "./ata";

// ---------------------------------------------------------------------------
// SPL Token instruction construction, with no Solana SDK.
//
// WHY HAND-WRITTEN. `@solana/spl-token` pulls `@solana/web3.js` and several
// hundred KB of transitive dependencies into a React Native bundle, on the code
// path that moves money. The instruction layouts here are fixed by the program
// and are a few dozen bytes each; the ATA derivation is a standard PDA already
// implemented and cross-verified in ./ata.ts (6/6 vectors matched against
// @solana/spl-token, and the deployer's derived ATA equals the account holding
// 100% of FURL on mainnet).
//
// FURL IS TOKEN-2022. Every helper here takes the token program explicitly and
// the FURL constants point at Token-2022. Building a FURL instruction against
// the legacy program derives a different ATA and produces a transfer that can
// never arrive — with no error at any point.
// ---------------------------------------------------------------------------

export const TOKEN_PROGRAM_ID = TOKEN_LEGACY_PROGRAM;
export const TOKEN_2022_PROGRAM_ID = TOKEN_2022_PROGRAM;
export const ATA_PROGRAM_ID = ASSOCIATED_TOKEN_PROGRAM;

export const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";
export const SYSVAR_RENT_ID = "SysvarRent111111111111111111111111111111111";

/** FURL — Token-2022 mint on Solana mainnet. Mirrors packages/furl-token. */
export const FURL_MINT = "FYatJq71zqvaQNLLtbBy4hQcsV25dMATYfCSVBzV3gY1";
export const FURL_DECIMALS = 6;
/** FURL's owning program. Never the legacy one. */
export const FURL_TOKEN_PROGRAM_ID = TOKEN_2022_PROGRAM_ID;

/** USDC on Solana mainnet — legacy SPL Token, not Token-2022. */
export const USDC_MINT_SOL = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDC_DECIMALS_SOL = 6;

/** u64 ceiling — every SPL amount is a u64 on chain. */
export const U64_MAX = 18_446_744_073_709_551_615n;

/** SPL Token instruction discriminators used here. */
const IX_TRANSFER = 3;
const IX_TRANSFER_CHECKED = 12;

export interface AccountMeta {
  pubkey: string;
  isSigner: boolean;
  isWritable: boolean;
}

export interface TransactionInstruction {
  programId: string;
  keys: AccountMeta[];
  data: Uint8Array;
}

export class SplError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SplError";
  }
}

/** Validate a base58 address decodes to 32 bytes (AGENTS.md rule 4). */
function assertAddress(address: string, label: string): void {
  let bytes: Uint8Array;
  try {
    bytes = base58.decode(address);
  } catch {
    throw new SplError(`${label} is not valid base58: "${address}"`);
  }
  if (bytes.length !== 32) {
    throw new SplError(`${label} must decode to 32 bytes, got ${bytes.length}`);
  }
}

function assertTokenProgram(programId: string): void {
  if (programId !== TOKEN_PROGRAM_ID && programId !== TOKEN_2022_PROGRAM_ID) {
    throw new SplError(`Unknown token program: ${programId}`);
  }
}

/**
 * u64 little-endian, exactly 8 bytes.
 *
 * bigint in, never a number: at 6 decimals a FURL amount passes
 * Number.MAX_SAFE_INTEGER in base units around 9,007 FURL, so a float would
 * start silently rounding inside ordinary balances.
 */
export function encodeU64LE(amount: bigint): Uint8Array {
  if (typeof amount !== "bigint") {
    throw new SplError("Amount must be a bigint — a float cannot represent every u64 exactly.");
  }
  if (amount < 0n) throw new SplError("Amount cannot be negative.");
  if (amount > U64_MAX) throw new SplError(`Amount ${amount} exceeds the u64 maximum.`);

  const out = new Uint8Array(8);
  let v = amount;
  for (let i = 0; i < 8; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

/** Decode 8 little-endian bytes back to a bigint. Test seam. */
export function decodeU64LE(bytes: Uint8Array): bigint {
  if (bytes.length !== 8) throw new SplError(`Expected 8 bytes, got ${bytes.length}`);
  let v = 0n;
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(bytes[i]);
  return v;
}

export { getAssociatedTokenAddress, AtaError };

/**
 * SPL Token `Transfer` (discriminator 3).
 *
 * Data: [3][amount u64 LE] — 9 bytes.
 * Accounts: source ATA (w), destination ATA (w), owner (signer).
 *
 * PREFER `buildTransferCheckedInstruction` FOR FURL. Bare `Transfer` does not
 * carry the mint or the decimals, so the runtime cannot catch a wrong-scale or
 * wrong-mint transfer — it simply moves whatever number it was given from
 * whatever account it was pointed at. `TransferChecked` makes the program
 * verify both, which is the whole defence against a decimals mistake.
 */
export function buildTransferInstruction(params: {
  sourceAta: string;
  destinationAta: string;
  owner: string;
  amount: bigint;
  tokenProgramId: string;
}): TransactionInstruction {
  const { sourceAta, destinationAta, owner, amount, tokenProgramId } = params;
  assertAddress(sourceAta, "sourceAta");
  assertAddress(destinationAta, "destinationAta");
  assertAddress(owner, "owner");
  assertTokenProgram(tokenProgramId);
  if (amount <= 0n) throw new SplError("Transfer amount must be positive.");

  const data = new Uint8Array(9);
  data[0] = IX_TRANSFER;
  data.set(encodeU64LE(amount), 1);

  return {
    programId: tokenProgramId,
    keys: [
      { pubkey: sourceAta, isSigner: false, isWritable: true },
      { pubkey: destinationAta, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data,
  };
}

/**
 * SPL Token `TransferChecked` (discriminator 12). The one to use.
 *
 * Data: [12][amount u64 LE][decimals u8] — 10 bytes.
 * Accounts: source ATA (w), mint, destination ATA (w), owner (signer).
 *
 * The runtime rejects the instruction if the mint does not match the accounts
 * or if `decimals` disagrees with the mint. A 1,000x decimals error therefore
 * fails on chain instead of settling.
 */
export function buildTransferCheckedInstruction(params: {
  sourceAta: string;
  mint: string;
  destinationAta: string;
  owner: string;
  amount: bigint;
  decimals: number;
  tokenProgramId: string;
}): TransactionInstruction {
  const { sourceAta, mint, destinationAta, owner, amount, decimals, tokenProgramId } = params;
  assertAddress(sourceAta, "sourceAta");
  assertAddress(mint, "mint");
  assertAddress(destinationAta, "destinationAta");
  assertAddress(owner, "owner");
  assertTokenProgram(tokenProgramId);
  if (amount <= 0n) throw new SplError("Transfer amount must be positive.");
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 9) {
    throw new SplError(`Invalid decimals: ${decimals}`);
  }

  const data = new Uint8Array(10);
  data[0] = IX_TRANSFER_CHECKED;
  data.set(encodeU64LE(amount), 1);
  data[9] = decimals;

  return {
    programId: tokenProgramId,
    keys: [
      { pubkey: sourceAta, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: destinationAta, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data,
  };
}

/**
 * Associated Token Account creation, idempotent variant (discriminator 1).
 *
 * Data: [1] — one byte.
 * Accounts: payer (signer, w), ata (w), owner, mint, system program, token
 * program.
 *
 * IDEMPOTENT ON PURPOSE. The plain `Create` (discriminator 0) fails if the
 * account already exists, which turns a harmless race — two payments to the
 * same new recipient — into a failed transfer. `CreateIdempotent` is a no-op
 * when the account is already there.
 *
 * The rent sysvar is NOT in the account list: the associated-token program
 * stopped requiring it, and including it is harmless but unnecessary. It is
 * exported as a constant for callers that build the legacy form.
 */
export function buildCreateAtaInstruction(params: {
  payer: string;
  owner: string;
  mint: string;
  tokenProgramId: string;
  idempotent?: boolean;
}): TransactionInstruction {
  const { payer, owner, mint, tokenProgramId, idempotent = true } = params;
  assertAddress(payer, "payer");
  assertAddress(owner, "owner");
  assertAddress(mint, "mint");
  assertTokenProgram(tokenProgramId);

  const ata = getAssociatedTokenAddress(owner, mint, tokenProgramId);

  return {
    programId: ATA_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: tokenProgramId, isSigner: false, isWritable: false },
    ],
    data: new Uint8Array([idempotent ? 1 : 0]),
  };
}

/** The token program that owns a given mint. FURL is the Token-2022 case. */
export function tokenProgramForMint(mint: string): string {
  return mint === FURL_MINT ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
}
