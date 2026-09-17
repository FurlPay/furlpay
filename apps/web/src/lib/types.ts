// Shared domain types for the super-app.
// Cross-cutting primitives live in @furlpay/types (single source of truth).

export type { Chain, Stablecoin, NativeToken, Token, Region } from "@furlpay/types";
import type { Chain, Token } from "@furlpay/types";

export interface TokenBalance {
  token: Token;
  chain: Chain;
  amount: number; // human units (e.g. 1250.42)
  usdValue: number;
}

export interface FiatBalance {
  currency: string; // USD, EUR, GBP, INR
  amount: number;
  usdValue: number;
  localDetails?: {
    iban?: string;
    routingNumber?: string;
    accountNumber?: string;
    swift?: string;
  };
}

export interface Holding {
  symbol: string;
  name: string;
  shares: number;
  price: number;
  changePct: number; // daily % change
  marketValue: number;
  /** Total amount paid for the current shares (drives real P&L). */
  costBasis: number;
}

export type CardKind = "virtual" | "physical";

export interface PaymentCard {
  id: string;
  /**
   * The ISSUER's id for this card, when one issued it.
   *
   * Our `id` is ours and is what every FurlPay surface shows; this is the
   * handle every later lifecycle call needs (freeze, reveal, close). Absent on
   * cards created before the issuer seam existed, and absent on simulator
   * cards from an older run — so callers must treat `undefined` as "this card
   * is not addressable at an issuer" rather than assuming it is present.
   */
  providerCardRef?: string;
  kind: CardKind;
  label: string;
  last4: string;
  network: "Visa" | "Mastercard";
  frozen: boolean;
  gradient: [string, string];
  limits: {
    perPurchase: number;
    daily: number;
    dailySpent: number;
  };
  channels: {
    online: boolean;
    offline: boolean;
    atm: boolean;
  };
  settlementCurrency: string;
}

export type TxDirection = "in" | "out";
export type TxCategory =
  | "card"
  | "transfer"
  | "swap"
  | "invest"
  | "bill"
  | "ramp"
  | "yield";

export interface Transaction {
  id: string;
  category: TxCategory;
  direction: TxDirection;
  title: string;
  subtitle: string;
  amountUsd: number;
  token?: Token;
  chain?: Chain;
  cardId?: string;
  timestamp: string; // ISO
  status: "settled" | "pending" | "escrow" | "declined";
}

/** One saved address belonging to a contact. */
export interface ContactAddress {
  id: string;
  address: string;
  chain: Chain;
  /** Optional user label, e.g. "salary" or "cold wallet". */
  label?: string;
  /** Preferred address for this contact on this chain family. */
  isDefault: boolean;
  /** Epoch ms of the last send to this address — drives "recent" ordering. */
  lastUsedAt?: number;
}

/**
 * An address-book entry. A contact is a SAFETY control first: the mistake it
 * prevents is paying a 42-character string that looks right and is not. The
 * name is what the user recognises, but the ADDRESS is what moves money, so
 * every surface that shows a contact must show both.
 */
export interface Contact {
  id: string;
  name: string;
  /** Hex from the app palette; validated so it can be interpolated into style. */
  avatarColor: string;
  addresses: ContactAddress[];
  isFavorite: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Bill {
  id: string;
  provider: string;
  category: "utility" | "credit-card" | "mortgage" | "loan" | "telecom";
  balanceDue: number;
  dueDate: string; // ISO date
  autopay: boolean;
}

export interface RiskScreenResult {
  address: string;
  risk: "low" | "medium" | "high" | "severe";
  score: number; // 0-100
  sanctioned: boolean;
  reasons: string[];
}

export interface PolicyDecision {
  approved: boolean;
  reasons: string[];
  checks: {
    velocity: boolean;
    sanctions: boolean;
    mcc: boolean;
    limit: boolean;
  };
}
