// ---------------------------------------------------------------------------
// The one answer, inside the extension, to "which address may be shown as this
// user's wallet?" — mirrors apps/web/src/lib/receiveAddress.ts.
//
// THE BUG THIS CLOSES (audit P0-3). The popup's Receive sheet rendered
// `overview.user.safeAddress` as a QR code, and the EIP-1193 provider answered
// `eth_requestAccounts` with the same value. `safeAddress` is
// "0x" + sha256("furlpay:safe:" + key)[:40]: no private key exists for it and
// no contract is deployed there. /api/wallets itself labels it
// `accountType: "ledger_placeholder"`. Anything a person or a dapp sent to it
// was unrecoverable.
//
// THE RULE. The only payable address is a VERIFIED linked wallet — an EVM
// address the user proved with an EIP-191 signature from their device key
// (GET /api/wallet/link, status "active"). No link → no address. Callers must
// render "Set up your wallet in the FurlPay app", and the provider must reject
// with EIP-1193 code 4100 (unauthorized). Nothing address-shaped is ever
// substituted.
// ---------------------------------------------------------------------------

/** Shape of GET /api/wallet/link. */
export interface LinkStatusResponse {
  linked: {
    address: string;
    chainFamily: string;
    status: string;
  } | null;
}

export type NoAddressReason =
  | "no_wallet_linked"
  | "link_not_active"
  | "unsupported_chain"
  | "invalid_address"
  | "linking_disabled";

export type PayableAddress = { ok: true; address: string } | { ok: false; reason: NoAddressReason };

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** EIP-1193 "Unauthorized": the requested account has not been authorized. */
export const EIP1193_UNAUTHORIZED = 4100;

/** User-facing sentence for the null state. */
export const SET_UP_WALLET_MESSAGE = "Set up your wallet in the FurlPay app";

export function payableAddressFrom(res: LinkStatusResponse | null | undefined): PayableAddress {
  const link = res?.linked;
  if (!link) return { ok: false, reason: "no_wallet_linked" };
  if (link.status !== "active") return { ok: false, reason: "link_not_active" };
  if (link.chainFamily !== "evm") return { ok: false, reason: "unsupported_chain" };
  if (typeof link.address !== "string" || !EVM_ADDRESS.test(link.address)) {
    return { ok: false, reason: "invalid_address" };
  }
  return { ok: true, address: link.address };
}

/** Error string carried over the bridge when no payable address exists. The
 *  page-world provider maps it to EIP1193_UNAUTHORIZED. */
export const NO_LINKED_WALLET_ERROR = "NO_LINKED_WALLET";
