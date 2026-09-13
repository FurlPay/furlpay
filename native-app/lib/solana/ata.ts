import { sha256 } from "@noble/hashes/sha2";
import { ed25519 } from "@noble/curves/ed25519";
import { base58 } from "@scure/base";
import { concatBytes } from "@noble/hashes/utils";

// ---------------------------------------------------------------------------
// Associated Token Account derivation, without @solana/web3.js.
//
// WHY HAND-ROLLED. Pulling web3.js + spl-token into a React Native bundle drags
// in Buffer/crypto polyfills for what is, here, one PDA derivation. The cost of
// writing it is ~50 lines; the cost of getting it wrong is a transfer sent to an
// address nobody controls. So it is written, and then checked against
// `getAssociatedTokenAddressSync` from @solana/spl-token as an oracle
// (__tests__/ata.test.ts) rather than trusted.
//
// THE PROGRAM ID IS PART OF THE SEEDS. This is the single most consequential
// detail for FURL: the ATA seeds are [owner, TOKEN_PROGRAM, mint]. FURL is
// Token-2022, so passing the legacy SPL Token program derives a DIFFERENT,
// VALID-LOOKING address — one that no FURL transfer can ever reach. There is no
// error; the funds simply go somewhere unspendable. `FURL_TOKEN_PROGRAM` is the
// default here for exactly that reason.
// ---------------------------------------------------------------------------

/** Token-2022 program — FURL's owning program. */
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
/** Legacy SPL Token program. Present so code can assert FURL is NOT this. */
export const TOKEN_LEGACY_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
/** Associated Token Account program. */
export const ASSOCIATED_TOKEN_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

const PDA_MARKER = new TextEncoder().encode("ProgramDerivedAddress");

export class AtaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AtaError";
  }
}

function decodeAddress(address: string, label: string): Uint8Array {
  let bytes: Uint8Array;
  try {
    bytes = base58.decode(address);
  } catch {
    throw new AtaError(`${label} is not valid base58: "${address}"`);
  }
  if (bytes.length !== 32) {
    throw new AtaError(`${label} must decode to 32 bytes, got ${bytes.length}`);
  }
  return bytes;
}

/**
 * Is this 32-byte value a point on the ed25519 curve?
 *
 * A PDA must be OFF-curve — that is what guarantees no private key exists for
 * it. `createProgramAddress` retries with a decreasing bump until it finds one.
 */
function isOnCurve(point: Uint8Array): boolean {
  try {
    ed25519.ExtendedPoint.fromHex(point);
    return true;
  } catch {
    return false;
  }
}

/**
 * Find the program-derived address for `seeds` under `programId`.
 *
 * Mirrors `PublicKey.findProgramAddressSync`: start at bump 255 and walk down
 * until the hash lands off-curve.
 */
export function findProgramAddress(
  seeds: Uint8Array[],
  programId: string,
): { address: string; bump: number } {
  const programBytes = decodeAddress(programId, "programId");

  for (let bump = 255; bump >= 0; bump--) {
    const hash = sha256(
      concatBytes(...seeds, new Uint8Array([bump]), programBytes, PDA_MARKER),
    );
    if (!isOnCurve(hash)) {
      return { address: base58.encode(hash), bump };
    }
  }
  // Astronomically unlikely; refusing beats returning something unusable.
  throw new AtaError("Unable to find a program address off the curve for these seeds.");
}

/**
 * The associated token account for `owner` holding `mint`.
 *
 * `tokenProgram` defaults to Token-2022 because that is what FURL is. Pass the
 * legacy program ONLY for a legacy mint such as USDC — and understand that the
 * two derivations produce different addresses for the same owner and mint.
 */
export function getAssociatedTokenAddress(
  owner: string,
  mint: string,
  tokenProgram: string = TOKEN_2022_PROGRAM,
): string {
  const ownerBytes = decodeAddress(owner, "owner");
  const mintBytes = decodeAddress(mint, "mint");
  const programBytes = decodeAddress(tokenProgram, "tokenProgram");

  return findProgramAddress(
    [ownerBytes, programBytes, mintBytes],
    ASSOCIATED_TOKEN_PROGRAM,
  ).address;
}

/**
 * Guard against the single most expensive Token-2022 mistake.
 *
 * Throws if a caller is about to derive a FURL account under the legacy program.
 * The resulting address looks entirely normal, which is precisely the problem.
 */
export function assertToken2022(tokenProgram: string): void {
  if (tokenProgram === TOKEN_LEGACY_PROGRAM) {
    throw new AtaError(
      "FURL is a Token-2022 mint. Deriving its account under the legacy SPL Token program " +
        "yields a different, valid-looking address that no FURL transfer can reach.",
    );
  }
  if (tokenProgram !== TOKEN_2022_PROGRAM) {
    throw new AtaError(`Unexpected token program: ${tokenProgram}`);
  }
}
