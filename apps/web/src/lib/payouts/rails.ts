import { checkDestination, maskAddress, type DestinationCheck } from "./address";
import {
  addressTypeLabel,
  checkBitcoinDestination,
  type BitcoinAddressType,
  type BitcoinNetwork,
} from "./bitcoin";

// ---------------------------------------------------------------------------
// Payout rails.
//
// RAIL IS NOT NETWORK, AND NETWORK IS NOT ASSET. Collapsing them is the
// mistake that makes a wallet module unable to grow:
//
//   BTC on Bitcoin on-chain   →  an address, a UTXO set, a mining fee, blocks
//   BTC on Lightning          →  an invoice, a route, a routing fee, instant
//
// Same asset. Same "network" in the colloquial sense. Completely different
// destinations, failure modes and settlement evidence. A single `address`
// column cannot represent both, and a module that tries ends up with a nullable
// field per rail and no type telling anyone which combination is legal.
//
// So the rail is the discriminator, and each rail owns its own destination
// shape. Adding Lightning later adds a variant; it does not reopen this file's
// existing ones.
//
// Adapter boundaries follow the same rule. EVM/Solana live in ./address (viem
// and @solana/web3.js), Bitcoin lives in ./bitcoin (@scure/base). Nothing
// imports another rail's library, so replacing @solana/web3.js with the newer
// Solana stack touches one file.
// ---------------------------------------------------------------------------

export type PayoutRail =
  | "EVM"
  | "SOLANA"
  | "BITCOIN_ONCHAIN"
  /** Declared, not implemented. See `railStatus` — an unimplemented rail must
   *  be visibly absent rather than silently missing from a menu. */
  | "BITCOIN_LIGHTNING";

export const PAYOUT_RAILS: readonly PayoutRail[] = [
  "EVM",
  "SOLANA",
  "BITCOIN_ONCHAIN",
  "BITCOIN_LIGHTNING",
];

export type RailStatus = "available" | "not_implemented";

/**
 * What each rail can actually do TODAY.
 *
 * Lightning is `not_implemented` rather than omitted. A rail that is missing
 * from a menu looks like an oversight; one that says "not available yet" is a
 * decision. It also means the UI cannot accidentally offer a rail the backend
 * would reject at payout time — the menu is generated from this table.
 */
export function railStatus(rail: PayoutRail): RailStatus {
  return rail === "BITCOIN_LIGHTNING" ? "not_implemented" : "available";
}

export function availableRails(): PayoutRail[] {
  return PAYOUT_RAILS.filter((r) => railStatus(r) === "available");
}

export const RAIL_LABEL: Readonly<Record<PayoutRail, string>> = {
  EVM: "EVM (Base, Arbitrum, Polygon)",
  SOLANA: "Solana",
  BITCOIN_ONCHAIN: "Bitcoin (on-chain)",
  BITCOIN_LIGHTNING: "Bitcoin (Lightning)",
};

// ── the stored payment method ──────────────────────────────────────────────

/**
 * A verified payout destination.
 *
 * Deliberately NOT `{ address: string }`. Every field below exists because
 * something downstream needs it and cannot re-derive it: the rail selects the
 * adapter, the network selects the chain, `addressType` changes the Bitcoin
 * fee estimate, and `verification` decides whether money may move at all.
 */
export interface PaymentMethod {
  id: string;
  userId: string;
  discordUserId: string;

  rail: PayoutRail;
  /** Canonical network. `chain:network` for EVM/Solana, `bitcoin:*` for BTC. */
  network: string;
  /** Asset address (mint/contract) for token rails; "BTC" for Bitcoin, which
   *  has no contract because it is the chain's native unit. */
  asset: string;
  assetSymbol: string;
  decimals: number;

  /** The destination. For Lightning this will hold an invoice or Lightning
   *  address rather than a chain address — which is why it is named for its
   *  role, not its format. */
  destination: string;
  /** Bitcoin only: the script type, which the fee estimate depends on. */
  addressType: BitcoinAddressType | null;

  verification: WalletVerificationState;
  /** Signature proving control, when the rail supports a challenge. */
  ownershipProof: string | null;

  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  /** Set when the destination changed. Payouts are held until this passes —
   *  the window that stops a compromised account redirecting the next payout. */
  cooldownUntil: string | null;
}

export type WalletVerificationState =
  | "UNVERIFIED"
  | "PENDING_VERIFICATION"
  | "VERIFIED"
  | "SUSPENDED"
  | "REVOKED";

/** Only one state may receive money. Written as a function so the rule has one
 *  home and a new state cannot silently default to payable. */
export function canReceivePayout(m: PaymentMethod, now = Date.now()): boolean {
  if (!m.isActive) return false;
  if (m.verification !== "VERIFIED") return false;
  if (m.cooldownUntil && Date.parse(m.cooldownUntil) > now) return false;
  return true;
}

export type PayoutBlockedReason =
  | "inactive"
  | "not_verified"
  | "in_cooldown"
  | "rail_not_implemented";

/** Why a method cannot be paid, for a message the user can act on. */
export function payoutBlockedReason(
  m: PaymentMethod,
  now = Date.now()
): PayoutBlockedReason | null {
  if (railStatus(m.rail) === "not_implemented") return "rail_not_implemented";
  if (!m.isActive) return "inactive";
  if (m.verification !== "VERIFIED") return "not_verified";
  if (m.cooldownUntil && Date.parse(m.cooldownUntil) > now) return "in_cooldown";
  return null;
}

// ── one entry point, dispatching to the rail's own adapter ─────────────────

export interface DestinationRequest {
  rail: PayoutRail;
  /** User-selected network. For Bitcoin this is ASSERTED against the address
   *  rather than combined with it — see ./bitcoin. */
  network: string;
  destination: string;
  /** Token rails only. */
  assetAddress?: string;
}

export type RailCheck =
  | {
      ok: true;
      rail: PayoutRail;
      network: string;
      destination: string;
      assetSymbol: string;
      decimals: number;
      assetAddress: string;
      addressType: BitcoinAddressType | null;
      /** True when the destination format alone could not identify the
       *  network, so the UI must confirm it explicitly. False for Bitcoin,
       *  where the address encodes its own network. */
      requiresNetworkConfirmation: boolean;
      summary: string;
    }
  | { ok: false; reason: string; detail: string };

/**
 * Validate a payout destination on whichever rail it belongs to.
 *
 * The dispatch is explicit rather than clever: each rail's rules live with
 * that rail, and this function only decides which one applies. A shared
 * "validate any address" helper would have to know every rail's rules, which
 * is how EVM assumptions leak into Bitcoin.
 */
export function checkRailDestination(req: DestinationRequest): RailCheck {
  if (railStatus(req.rail) === "not_implemented") {
    return {
      ok: false,
      reason: "rail_not_implemented",
      detail: `${RAIL_LABEL[req.rail]} payouts are not available yet.`,
    };
  }

  if (req.rail === "BITCOIN_ONCHAIN") {
    const expected = req.network as BitcoinNetwork;
    const r = checkBitcoinDestination(req.destination, expected);
    if (!r.ok) return { ok: false, reason: r.reason, detail: r.detail };
    return {
      ok: true,
      rail: req.rail,
      network: r.value.network,
      destination: r.value.address,
      assetSymbol: "BTC",
      decimals: 8,
      // BTC is the chain's native unit; there is no contract to name, and
      // inventing a pseudo-address here would make it look like a token.
      assetAddress: "BTC",
      addressType: r.value.type,
      // The address encodes its own network, so there is nothing to confirm.
      requiresNetworkConfirmation: false,
      summary: `${addressTypeLabel(r.value.type)} · ${maskAddress(r.value.address)}`,
    };
  }

  // EVM and Solana share a destination shape (an address) and a registry, so
  // they share an adapter — but the adapter still refuses a Solana address on
  // an EVM network and vice versa.
  const r: DestinationCheck = checkDestination({
    network: req.network,
    address: req.destination,
    assetAddress: req.assetAddress,
  });
  if (!r.ok) return { ok: false, reason: r.reason, detail: r.detail };

  const expectedRail: PayoutRail = r.asset.chain === "solana" ? "SOLANA" : "EVM";
  if (expectedRail !== req.rail) {
    return {
      ok: false,
      reason: "rail_network_mismatch",
      detail: `${req.network} settles on the ${RAIL_LABEL[expectedRail]} rail, not ${RAIL_LABEL[req.rail]}.`,
    };
  }

  return {
    ok: true,
    rail: req.rail,
    network: r.network,
    destination: r.address,
    assetSymbol: r.asset.symbol,
    decimals: r.asset.decimals,
    assetAddress: r.asset.address,
    addressType: null,
    requiresNetworkConfirmation: r.requiresNetworkConfirmation,
    summary: `${r.asset.symbol} on ${r.network} · ${maskAddress(r.address)}`,
  };
}
