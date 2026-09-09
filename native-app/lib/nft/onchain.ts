import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex } from "@/lib/evm/rlp";
import { call, type ChainSlug } from "@/lib/evm/rpc";
import type { NftStandard, OwnershipProof } from "./types";

// ---------------------------------------------------------------------------
// The parts of NFT support that are REAL regardless of any indexer.
//
// Discovery needs an indexer (there is no way to enumerate an address's ERC-721
// holdings from RPC alone — the standard has no such view, and reconstructing
// it from Transfer logs means scanning every block since the contract's
// deployment). Everything HERE is different: ownership and transfer are plain
// contract calls, they work with nothing but an RPC endpoint, and they are the
// two operations where being wrong costs the user money.
//
// SELECTORS ARE COMPUTED, not pasted — same rule as lib/evm/erc20.ts. Four
// bytes of hex carry no meaning a reviewer can check, and a transposed digit in
// a TRANSFER selector calls a different function on the same contract.
//
// THE ERC-721 / ERC-1155 SPLIT IS NOT COSMETIC. They have different transfer
// signatures, different ownership queries, and different failure modes:
//
//   ERC-721   ownerOf(tokenId) -> address       reverts for a burned/absent id
//   ERC-1155  balanceOf(owner, id) -> uint256   returns 0, never reverts
//
// A single "does this address own it" helper that ignored the distinction would
// have to treat a revert as `false`, which silently converts an RPC outage into
// "you do not own this" — on the screen that decides whether to let someone
// send their own property.
// ---------------------------------------------------------------------------

function selector(signature: string): string {
  return bytesToHex(keccak_256(new TextEncoder().encode(signature)).slice(0, 4));
}

export const NFT_SELECTORS = {
  ownerOf: selector("ownerOf(uint256)"),
  balanceOf1155: selector("balanceOf(address,uint256)"),
  safeTransferFrom721: selector("safeTransferFrom(address,address,uint256)"),
  safeTransferFrom1155: selector("safeTransferFrom(address,address,uint256,uint256,bytes)"),
  supportsInterface: selector("supportsInterface(bytes4)"),
} as const;

/** ERC-165 interface ids, from the standards. */
export const INTERFACE_IDS = {
  erc721: "0x80ac58cd",
  erc1155: "0xd9b67a26",
} as const;

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export class NftError extends Error {
  readonly code: "invalid_address" | "invalid_token_id" | "rpc_failed" | "not_owned" | "unsupported";
  constructor(code: NftError["code"], message: string) {
    super(message);
    this.name = "NftError";
    this.code = code;
  }
}

function addressWord(address: string): string {
  if (!ADDRESS_RE.test(address)) throw new NftError("invalid_address", `Invalid address: ${address}`);
  return address.replace(/^0x/, "").toLowerCase().padStart(64, "0");
}

/**
 * A token id as a 32-byte word.
 *
 * Token ids are uint256 and routinely exceed 2^53 — several major collections
 * use a hash as the id. Parsed as bigint from a decimal STRING for that reason;
 * a JS number would round and address a different token.
 */
export function tokenIdWord(tokenId: string): string {
  // BigInt("") is 0n, not an error — a JavaScript quirk that would turn a
  // MISSING token id into a transfer of token 0, which is a real, owned token in
  // plenty of collections. The same applies to whitespace. Rejected explicitly
  // before BigInt ever sees it.
  if (typeof tokenId !== "string" || tokenId.trim() === "") {
    throw new NftError("invalid_token_id", "Missing token id.");
  }

  let value: bigint;
  try {
    value = BigInt(tokenId.trim());
  } catch {
    throw new NftError("invalid_token_id", `Invalid token id: ${tokenId}`);
  }
  if (value < 0n || value >= 1n << 256n) {
    throw new NftError("invalid_token_id", `Token id out of range: ${tokenId}`);
  }
  return value.toString(16).padStart(64, "0");
}

function uintWord(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}

function decodeAddress(hex: string): string | null {
  const body = (hex || "").replace(/^0x/, "");
  if (body.length !== 64) return null;
  // The high 12 bytes of an address word must be zero. A dirty high half means
  // something other than an address is being read as one.
  if (!/^0{24}$/.test(body.slice(0, 24))) return null;
  return `0x${body.slice(24)}`;
}

function decodeUint(hex: string): bigint | null {
  const body = (hex || "").replace(/^0x/, "");
  if (body.length !== 64) return null;
  try {
    return BigInt(`0x${body}`);
  } catch {
    return null;
  }
}

/**
 * Does `owner` hold this token, according to the chain?
 *
 * AN RPC FAILURE THROWS; IT DOES NOT RETURN `owned: false`. That distinction is
 * the whole point of this function. Collapsing them means a flaky connection
 * tells the user they do not own their own NFT and hides the send button —
 * and the honest answer, "we could not check", is the one the UI needs.
 *
 * The ERC-721 case tolerates exactly one revert: `ownerOf` reverts for a token
 * that does not exist or was burned, which IS an answer (nobody owns it), and
 * is distinguishable from a transport failure because the call returned.
 */
export async function verifyOwnership(input: {
  chain: ChainSlug;
  contract: string;
  tokenId: string;
  owner: string;
  standard: NftStandard;
}): Promise<OwnershipProof> {
  const owner = input.owner;
  if (!ADDRESS_RE.test(owner)) throw new NftError("invalid_address", "Invalid wallet address.");
  if (!ADDRESS_RE.test(input.contract)) throw new NftError("invalid_address", "Invalid contract address.");

  const checkedAt = Date.now();

  if (input.standard === "erc1155") {
    const data = `${NFT_SELECTORS.balanceOf1155}${addressWord(owner)}${tokenIdWord(input.tokenId)}`;
    const raw = await call(input.chain, input.contract, data);
    const balance = decodeUint(raw);
    if (balance === null) {
      throw new NftError("rpc_failed", "The contract did not return a readable balance.");
    }
    return { owned: balance > 0n, balance: balance.toString(), owner: balance > 0n ? owner : null, checkedAt };
  }

  const data = `${NFT_SELECTORS.ownerOf}${tokenIdWord(input.tokenId)}`;
  let raw: string;
  try {
    raw = await call(input.chain, input.contract, data);
  } catch (e) {
    // A revert here means "no such token" and is a real answer; anything else is
    // a transport problem and must not be reported as "not owned".
    if (isRevert(e)) return { owned: false, balance: "0", owner: null, checkedAt };
    throw new NftError("rpc_failed", (e as Error).message);
  }

  const actual = decodeAddress(raw);
  if (actual === null) {
    // An empty return is what a non-ERC-721 contract gives for ownerOf. Treating
    // it as "not owned" would be indistinguishable from a wrong standard.
    throw new NftError("unsupported", "This contract did not answer ownerOf — it may not be an ERC-721.");
  }

  const owned = actual.toLowerCase() === owner.toLowerCase();
  return { owned, balance: owned ? "1" : "0", owner: actual, checkedAt };
}

/** Does the RPC error look like a contract revert rather than a transport failure? */
function isRevert(e: unknown): boolean {
  const message = String((e as Error)?.message ?? "").toLowerCase();
  return (
    message.includes("revert") ||
    message.includes("execution reverted") ||
    message.includes("invalid token") ||
    message.includes("nonexistent")
  );
}

/**
 * Calldata for an NFT transfer.
 *
 * `safeTransferFrom`, never `transferFrom`. The safe variant calls
 * `onERC721Received` on a contract recipient and REVERTS if it is not
 * implemented — which is exactly what stops an NFT being sent to a contract
 * that cannot move it again. `transferFrom` succeeds in that case and the token
 * is stranded permanently. The gas difference is not worth an unrecoverable
 * asset.
 */
export function encodeNftTransfer(input: {
  standard: NftStandard;
  from: string;
  to: string;
  tokenId: string;
  /** ERC-1155 only. Decimal string; ignored for ERC-721, which is always one. */
  amount?: string;
}): string {
  const from = addressWord(input.from);
  const to = addressWord(input.to);
  const id = tokenIdWord(input.tokenId);

  if (input.standard === "erc721") {
    return `${NFT_SELECTORS.safeTransferFrom721}${from}${to}${id}`;
  }

  let amount: bigint;
  try {
    amount = BigInt(input.amount ?? "1");
  } catch {
    throw new NftError("invalid_token_id", `Invalid amount: ${input.amount}`);
  }
  if (amount <= 0n) throw new NftError("invalid_token_id", "Amount must be positive.");

  // ERC-1155 safeTransferFrom(address,address,uint256,uint256,bytes).
  // `bytes` is dynamic: the head holds an OFFSET to the tail, and the tail
  // holds the length. Five head words means the data begins at 0xa0 (160).
  // Writing 0 there instead — the common mistake — points the decoder at the
  // selector and the call reverts with no useful message.
  const dataOffset = uintWord(160n);
  const dataLength = uintWord(0n);
  return (
    `${NFT_SELECTORS.safeTransferFrom1155}${from}${to}${id}${uintWord(amount)}${dataOffset}${dataLength}`
  );
}

/**
 * Ask a contract which standard it implements (ERC-165).
 *
 * Returns null when the contract does not answer — many older NFTs predate
 * ERC-165 or implement it incorrectly. Null means "use what the indexer said",
 * not "unsupported": refusing a transfer because a 2018 contract has no
 * supportsInterface would block genuinely transferable tokens.
 */
export async function detectStandard(chain: ChainSlug, contract: string): Promise<NftStandard | null> {
  const probe = async (interfaceId: string): Promise<boolean> => {
    try {
      const data = `${NFT_SELECTORS.supportsInterface}${interfaceId.replace(/^0x/, "").padEnd(64, "0")}`;
      const raw = await call(chain, contract, data);
      return decodeUint(raw) === 1n;
    } catch {
      return false;
    }
  };

  if (await probe(INTERFACE_IDS.erc721)) return "erc721";
  if (await probe(INTERFACE_IDS.erc1155)) return "erc1155";
  return null;
}
