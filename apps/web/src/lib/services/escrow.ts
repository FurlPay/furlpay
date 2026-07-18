import { randomUUID } from "crypto";

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

/** Ownership gate: a hold that isn't yours is indistinguishable from one that
 *  doesn't exist — never confirm a foreign hold id. */
function ownedHold(id: string, userId: string): EscrowHold {
  const hold = holds.get(id);
  if (!hold || hold.userId !== userId) throw new Error("Escrow hold not found");
  return hold;
}

export function createHold(userId: string, cardId: string, merchant: string, amount: number): EscrowHold {
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

// Merchant settles the final (usually lower) amount; remainder returns to Safe.
export function captureHold(id: string, finalAmount: number, userId: string): EscrowHold {
  const hold = ownedHold(id, userId);
  if (hold.status !== "held") throw new Error(`Hold already ${hold.status}`);
  if (finalAmount > hold.authorizedAmount) throw new Error("Capture exceeds authorized amount");
  hold.capturedAmount = finalAmount;
  hold.status = "captured";
  return hold;
}

export function releaseHold(id: string, userId: string): EscrowHold {
  const hold = ownedHold(id, userId);
  hold.status = "released";
  hold.capturedAmount = 0;
  return hold;
}

export function listHolds(userId: string): EscrowHold[] {
  // Lazily expire any holds past TTL (contract auto-refund).
  const now = Date.now();
  for (const h of holds.values()) {
    if (h.status === "held" && new Date(h.expiresAt).getTime() < now) {
      h.status = "expired";
      h.capturedAmount = 0;
    }
  }
  return Array.from(holds.values())
    .filter((h) => h.userId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
