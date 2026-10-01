import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";
import { normalize } from "viem/ens";
import { getChain } from "@/lib/services/chainRegistry";
import { classifyAddress, isEvmAddress } from "@/lib/addressValidation";
import { getHandle, normalizeHandle } from "@/lib/walletHandles";
import { getAccountDurable } from "@/lib/store";
import { loadLinkedWallet } from "@/lib/linkedWalletStore";

// ---------------------------------------------------------------------------
// Human name → payable address.
//
// Three kinds of input reach the "To" field, and conflating them is how people
// pay the wrong account:
//
//   · a raw address        — already payable, just classify its family
//   · an ENS name          — resolved on Ethereum mainnet, on-chain
//   · a FurlPay handle     — resolved from the handle reservation (lib/walletHandles)
//
// THE RULE THAT MATTERS: "we could not check" is never reported as "no such
// name". An RPC outage that silently degrades to `unresolved` teaches the user
// their friend's ENS name is wrong, and the next thing they do is paste an
// address by hand — the exact failure the address book exists to remove. So
// lookup failure is its own outcome (`unavailable`) and the caller surfaces it
// as a 503, not a 404.
// ---------------------------------------------------------------------------

export type NameKind = "address" | "ens" | "furlpay";

/**
 * ENS resolution is an Ethereum-mainnet read regardless of which chain the user
 * intends to pay on, and it always yields an EVM address. A resolved name is
 * therefore payable on every EVM chain and on none of the non-EVM ones.
 */
const ENS_SUFFIXES = [".eth"] as const;

export interface ResolvedName {
  /** What the user typed, trimmed. */
  query: string;
  kind: NameKind;
  address: string;
  /** Chain family the resolved address is payable on. */
  family: "evm" | "solana";
  /** Human label to show beside the address once resolved. */
  display: string;
}

export type ResolutionOutcome =
  | { status: "resolved"; result: ResolvedName }
  | { status: "unresolved"; kind: NameKind }
  /** The lookup itself failed — NOT evidence the name is unregistered. */
  | { status: "unavailable"; kind: NameKind; reason: string }
  /** The name exists but its owner has no verified wallet to receive into. */
  | { status: "no_receive_address"; kind: NameKind; reason: string }
  | { status: "invalid"; reason: string };

/** Which resolver an input belongs to, before any lookup happens. */
export function classifyName(input: string): NameKind | null {
  const value = input.trim();
  if (!value) return null;
  if (classifyAddress(value)) return "address";
  const lower = value.toLowerCase();
  if (ENS_SUFFIXES.some((suffix) => lower.endsWith(suffix))) return "ens";
  // A dot that is not an ENS suffix is not a handle either — handles are
  // `[a-z0-9-]` only, and guessing at some other name system would be inventing
  // a resolver we do not have.
  if (lower.includes(".")) return null;
  return "furlpay";
}

/** Lazily built so a deployment that never resolves a name never opens a socket. */
let ensClient: ReturnType<typeof createPublicClient> | null = null;

function mainnetClient() {
  if (!ensClient) {
    const rpcUrl = getChain("ethereum")?.rpcUrl;
    ensClient = createPublicClient({ chain: mainnet, transport: http(rpcUrl) });
  }
  return ensClient;
}

/** Reset between tests; also lets a deployment pick up a changed RPC URL. */
export function resetEnsClient(): void {
  ensClient = null;
}

async function resolveEns(name: string): Promise<ResolutionOutcome> {
  let normalized: string;
  try {
    // ENSIP-15 normalisation. It REJECTS confusable and disallowed characters,
    // which is a safety check and not a formality: "vitalik.eth" written with a
    // Cyrillic 'а' is a different name that resolves to a different address.
    normalized = normalize(name.trim());
  } catch {
    return { status: "invalid", reason: "That is not a valid ENS name." };
  }

  try {
    const address = await mainnetClient().getEnsAddress({ name: normalized });
    // A name with no address record resolves to null or the zero address; both
    // mean "registered, but nothing to pay".
    //
    // Shape-checked with isEvmAddress, NOT viem's isAddress: the latter enforces
    // an EIP-55 checksum, so a resolver returning a correct but all-lowercase
    // address would be reported as "this name has no address" — a lookup result
    // silently downgraded to a denial. EIP-55 is a checksum, not an identity
    // (AGENTS.md rule 9 uses the same 40-hex test everywhere else).
    if (!address || !isEvmAddress(address) || /^0x0{40}$/i.test(address)) {
      return { status: "unresolved", kind: "ens" };
    }
    return {
      status: "resolved",
      result: {
        query: name.trim(),
        kind: "ens",
        address,
        family: "evm",
        display: normalized,
      },
    };
  } catch (e) {
    return {
      status: "unavailable",
      kind: "ens",
      reason: (e as Error)?.message?.slice(0, 200) || "ENS lookup failed.",
    };
  }
}

async function resolveFurlpayHandle(name: string): Promise<ResolutionOutcome> {
  const validation = normalizeHandle(name);
  if (!validation.ok || !validation.normalized) {
    return { status: "invalid", reason: validation.error ?? "Not a valid FurlPay name." };
  }
  const handle = validation.normalized;

  let owner: Awaited<ReturnType<typeof getHandle>>;
  try {
    owner = await getHandle(handle);
  } catch (e) {
    return {
      status: "unavailable",
      kind: "furlpay",
      reason: (e as Error)?.message?.slice(0, 200) || "Handle lookup failed.",
    };
  }
  if (!owner) return { status: "unresolved", kind: "furlpay" };

  // A reservation stores the owning user id, not an address — the address comes
  // from their account so it stays correct if their wallet is ever re-derived.
  const account = await getAccountDurable(owner.ownerId);
  // A handle whose owner we cannot load is NOT an unclaimed handle. Reporting
  // it as unresolved would let the caller offer the name to someone else.
  if (!account) {
    return { status: "unavailable", kind: "furlpay", reason: "Handle owner is unavailable." };
  }

  // THE PAYABLE ADDRESS IS THE OWNER'S VERIFIED LINKED WALLET, NOTHING ELSE.
  // This used to return account.user.safeAddress — sha256("furlpay:safe:"+key)
  // truncated, an address no key controls. Anyone paying "name.furlpay" from an
  // external wallet sent funds nobody could ever move. Read durably so a cold
  // instance does not miss a link made elsewhere.
  let linked;
  try {
    linked = await loadLinkedWallet(owner.ownerId);
  } catch (e) {
    return { status: "unavailable", kind: "furlpay", reason: (e as Error)?.message?.slice(0, 200) || "Wallet lookup failed." };
  }
  if (!linked || linked.status !== "active" || linked.verificationMethod !== "eip191") {
    return {
      status: "no_receive_address",
      kind: "furlpay",
      reason: "This FurlPay name has not set up a wallet to receive funds.",
    };
  }

  return {
    status: "resolved",
    result: {
      query: name.trim(),
      kind: "furlpay",
      address: linked.address,
      family: "evm",
      // The handle, never the owner's name or email — resolving a payment name
      // must not become a directory lookup for someone's identity.
      display: `${handle}.furlpay`,
    },
  };
}

/** Resolve any of the three input kinds to a payable address. */
export async function resolveName(input: string): Promise<ResolutionOutcome> {
  const query = input.trim();
  const kind = classifyName(query);
  if (!kind) return { status: "invalid", reason: "Enter an address, an ENS name, or a FurlPay name." };

  if (kind === "address") {
    const family = classifyAddress(query)!;
    return {
      status: "resolved",
      result: { query, kind: "address", address: query, family, display: query },
    };
  }
  return kind === "ens" ? resolveEns(query) : resolveFurlpayHandle(query);
}
