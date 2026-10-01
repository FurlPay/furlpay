import type { UserAccount } from "@/lib/store";
import { loadLinkedWallet } from "@/lib/linkedWalletStore";

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * The address a live on-chain call may name as the user's RECEIVER (vault
 * shares, withdrawals): their verified, active, EIP-191-linked EVM wallet,
 * read durably. Null when there is none — the caller must refuse, never
 * substitute. account.user.safeAddress is never a receiver (T-E2).
 */
export async function verifiedReceiver(userId: string): Promise<string | null> {
  const linked = await loadLinkedWallet(userId);
  if (!linked || linked.status !== "active" || linked.verificationMethod !== "eip191") return null;
  return EVM_ADDRESS.test(linked.address) ? linked.address : null;
}

// ---------------------------------------------------------------------------
// The one answer to "where do I send this person money?"
//
// THE BUG THIS CLOSES. An account carries two addresses and they are not
// interchangeable:
//
//   linkedWallet.address  A REAL self-custodial address, proven by an EIP-191
//                         signature from the user's device key. Funds sent here
//                         arrive, and the user can spend them.
//
//   safeAddress           sha256("furlpay:safe:" + key), truncated to 20 bytes.
//                         store.ts calls it DEPRECATED and says it "controls
//                         nothing on-chain". No private key exists for it and
//                         no contract is deployed at it.
//
// store.ts warned about this and two screens did it anyway. DepositFlow read
// `safeAddress` from /api/profile and presented it as the address to deposit
// TO, with a copy button. ScanToPay rendered it as a QR under the text "Pay me
// on Furlpay — my wallet address", ready to show to a stranger in a shop.
// Anything sent to either is unrecoverable: the funds land at an address whose
// preimage is a hash nobody holds a key for.
//
// So the resolution is deliberately narrow. There is one source of a payable
// address — a VERIFIED link — and when there is no link the honest answer is
// null. A UI that gets null must ask the user to connect a wallet; it must not
// substitute something address-shaped.
// ---------------------------------------------------------------------------

/** Why no address can be shown. Rendered to the user, so it is a sentence. */
export type ReceiveAddressUnavailable =
  | "no_wallet_linked"
  | "link_not_verified";

export interface ReceiveAddress {
  address: string;
  /** How we know this address is really theirs. */
  verifiedBy: "eip191";
  verifiedAt: string;
  chainFamily: "evm";
}

/**
 * The address a third party may safely send funds to, or null.
 *
 * Never falls back to `safeAddress`. That fallback is the whole defect: it is
 * the branch that turns "we don't know where to send your money" into "here is
 * somewhere to send it", and the two are not close enough to guess between.
 */
export function receiveAddressFor(
  account: UserAccount
): { ok: true; receive: ReceiveAddress } | { ok: false; reason: ReceiveAddressUnavailable } {
  const linked = account.user.linkedWallet;
  if (!linked) return { ok: false, reason: "no_wallet_linked" };
  if (linked.status !== "active" || linked.verificationMethod !== "eip191") {
    return { ok: false, reason: "link_not_verified" };
  }
  return {
    ok: true,
    receive: {
      address: linked.address,
      verifiedBy: "eip191",
      verifiedAt: linked.verifiedAt,
      chainFamily: linked.chainFamily,
    },
  };
}

/** Copy for the empty state. Kept here so every surface says the same thing. */
export const RECEIVE_UNAVAILABLE_COPY: Record<ReceiveAddressUnavailable, string> = {
  no_wallet_linked:
    "Connect a wallet to get a deposit address. FurlPay does not issue you one — the address has to be a wallet you hold the key for.",
  link_not_verified:
    "Your linked wallet has not completed signature verification, so we cannot show it as a deposit address yet.",
};
