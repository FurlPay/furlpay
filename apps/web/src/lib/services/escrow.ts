import { randomUUID } from "crypto";
import { financialEnvironment } from "@/lib/flags";

// ---------------------------------------------------------------------------
// On-chain escrow / pre-authorization holds (Playbook Gap 3).
// Solves hotel/gas-pump pre-auth on self-custodial cards: instead of freezing
// the whole Safe, lock the EXACT hold amount in a time-locked escrow contract.
// Unclaimed holds auto-release back to the Safe after `HOLD_TTL_DAYS`.
// MOCK: models the escrow contract lifecycle in memory.
// ---------------------------------------------------------------------------

const HOLD_TTL_DAYS = 7;

export interface EscrowHold {
  id: string;
  /** Account the hold belongs to — every mutation must prove ownership. */
  userId: string;
  cardId: string;
  merchant: string;
  authorizedAmount: number;
  capturedAmount: number | null;
  status: "held" | "captured" | "released" | "expired";
  createdAt: string;
  expiresAt: string;
}

const globalForEscrow = globalThis as unknown as { __escrow?: Map<string, EscrowHold> };
const holds: Map<string, EscrowHold> =
  globalForEscrow.__escrow ?? (globalForEscrow.__escrow = new Map());

/**
 * Thrown when production asks for a hold this module cannot durably keep.
 *
 * The store above is a per-instance `globalThis` Map. On a serverless platform
 * that has three consequences, and all of them are money-adjacent:
 *
 *   * a hold created on one instance is INVISIBLE to every other, so a capture
 *     routed elsewhere fails "Escrow hold not found" against a hold the user was
 *     told exists;
 *   * an instance recycle silently drops every live hold, and the TTL
 *     auto-refund that is meant to protect the user cannot fire for a hold that
 *     no longer exists;
 *   * /api/escrow writes a transaction record with `status: "escrow"` through the
 *     durable store, so the user's history can outlive the hold it refers to.
 *
 * The same reasoning as lib/ledger.ts assertLedgerDurable: an in-memory record of
 * money held is not a record. Development and staging may run on the map alone.
 */
export class EscrowDurabilityError extends Error {
  constructor() {
    super(
      "Escrow holds have no durable backend. A pre-authorization recorded only in memory is " +
        "invisible to other instances and lost on recycle, so creating one is refused rather " +
        "than promising the user a hold that can vanish."
    );
    this.name = "EscrowDurabilityError";
  }
}

/**
 * Refuse to create a hold in production while the store is in-memory.
 *
 * Deliberately guards CREATE only. Capture and release of an existing hold are
 * safe to attempt — they already fail closed via `ownedHold` when the hold is
 * absent — and blocking them would strand any hold that does exist.
 */
export function assertEscrowDurable(): void {
  if (financialEnvironment() === "production") throw new EscrowDurabilityError();
}

/** Ownership gate: a hold that isn't yours is indistinguishable from one that
 *  doesn't exist — never confirm a foreign hold id. */
function ownedHold(id: string, userId: string): EscrowHold {
  const hold = holds.get(id);
  if (!hold || hold.userId !== userId) throw new Error("Escrow hold not found");
  return hold;
}

export function createHold(userId: string, cardId: string, merchant: string, amount: number): EscrowHold {
  // Refuse before allocating an id the caller would otherwise be handed as a
  // capability for a hold that cannot survive.
  assertEscrowDurable();
  const now = Date.now();
  const hold: EscrowHold = {
    id: "esc_" + randomUUID(), // unguessable — the id is the capture/release capability
    userId,
    cardId,
    merchant,
    authorizedAmount: amount,
    capturedAmount: null,
    status: "held",
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + HOLD_TTL_DAYS * 86400_000).toISOString(),
  };
  holds.set(hold.id, hold);
  return hold;
}

/** A hold past its TTL has auto-refunded on-chain; record that before any
 *  action, so neither a capture nor a release can act on it. */
function expireIfDue(hold: EscrowHold, now = Date.now()): void {
  if (hold.status === "held" && new Date(hold.expiresAt).getTime() < now) {
    hold.status = "expired";
    hold.capturedAmount = 0;
  }
}

// Merchant settles the final (usually lower) amount; remainder returns to Safe.
// held → captured only. A capture after expiry would take funds the contract
// already returned.
export function captureHold(id: string, finalAmount: number, userId: string): EscrowHold {
  const hold = ownedHold(id, userId);
  expireIfDue(hold);
  if (hold.status !== "held") throw new Error(`Hold already ${hold.status}`);
  if (!(finalAmount > 0) || finalAmount > hold.authorizedAmount) throw new Error("Capture exceeds authorized amount");
  hold.capturedAmount = finalAmount;
  hold.status = "captured";
  return hold;
}

// held → released only. Releasing a captured hold used to flip it to
// "released" with capturedAmount 0 and report the whole authorization as
// refunded, after the merchant had already been paid (SEC-P2-001).
export function releaseHold(id: string, userId: string): EscrowHold {
  const hold = ownedHold(id, userId);
  expireIfDue(hold);
  if (hold.status !== "held") throw new Error(`Hold already ${hold.status}`);
  hold.status = "released";
  hold.capturedAmount = 0;
  return hold;
}

export function listHolds(userId: string): EscrowHold[] {
  // Lazily expire any holds past TTL (contract auto-refund).
  const now = Date.now();
  for (const h of holds.values()) expireIfDue(h, now);
  return Array.from(holds.values())
    .filter((h) => h.userId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
