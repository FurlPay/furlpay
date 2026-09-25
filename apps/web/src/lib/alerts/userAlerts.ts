import { randomUUID } from "crypto";
import { kvDel, kvGet, kvSet, kvZAdd, kvZCard, kvZRangeByScore, kvZRem } from "@/lib/kv";

// ---------------------------------------------------------------------------
// User price alerts — the matching engine.
//
// NOT lib/alerts/index.ts. That module is OPS alerting (severity, sinks,
// acknowledge) for the operators of this system. This one is a product feature:
// a user says "tell me when EURUSD crosses 1.10" and gets a push notification.
// The names are similar and the concerns are unrelated.
//
// WHY A SORTED SET, WHICH IS THE WHOLE DESIGN. The obvious implementation stores
// alerts in a list and walks it on every tick: O(N) per tick, where N is every
// alert every user has. At 10,000 alerts that is a 10,000-element scan to
// discover that nothing fired, and the cost grows with how many users you have
// rather than with how much actually happened.
//
// Scoring a sorted set by TARGET PRICE turns "which alerts does this price
// cross?" into a range read — O(log N + M), M being the number that genuinely
// triggered. The work becomes proportional to the answer.
//
//   alerts:above:{symbol}   score = target.  Fires when price >= target,
//                           so the triggered set is the range [-inf, price].
//   alerts:below:{symbol}   score = target.  Fires when price <= target,
//                           so the triggered set is the range [price, +inf].
//
// TWO KEYS, NOT ONE, because a single set cannot answer both questions with one
// range: the directions read opposite ends, and merging them would mean scanning
// members to check which direction each wanted — the O(N) this design exists to
// avoid.
//
// EXACTLY-ONCE WITHOUT A LOCK. Several instances may evaluate the same tick
// concurrently and all see the same triggered members. The claim is the ZREM:
// Redis returns how many members it actually removed, so of N racing evaluators
// exactly one gets 1 for a given alert and only that one dispatches. No lock, no
// lease, no dedup table — the removal IS the claim. This is the single most
// important property in the file, and there is a test that races two evaluators.
// ---------------------------------------------------------------------------

/** Which way the price has to move to trigger. */
export type AlertDirection = "above" | "below";

export interface PriceAlert {
  id: string;
  userId: string;
  /** Uppercased instrument symbol, e.g. "EURUSD" or "AAPL". */
  symbol: string;
  direction: AlertDirection;
  targetPrice: number;
  /** `once` deletes on fire; `recurring` re-arms after a cooldown. */
  frequency: "once" | "recurring";
  /** The price when the alert was created — see the arming note below. */
  createdAtPrice: number;
  createdAt: string;
  /** Set when it last fired, for the recurring cooldown. */
  lastFiredAt?: string;
  note?: string;
}

export class AlertError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AlertError";
  }
}

/** Per-user ceiling. Bounds both the fan-out per tick and abuse of the store. */
export const MAX_ALERTS_PER_USER = 50;

/**
 * How long a `recurring` alert stays quiet after firing.
 *
 * Without it, a price oscillating either side of the target fires on every tick —
 * so the alert that was supposed to be useful becomes the reason the user turns
 * notifications off. 15 minutes is long enough to stop flapping and short enough
 * that a genuine second move still reaches them.
 */
export const RECURRING_COOLDOWN_MS = 15 * 60 * 1000;

const zKey = (dir: AlertDirection, symbol: string) => `alerts:${dir}:${symbol.toUpperCase()}`;
const metaKey = (id: string) => `alerts:meta:${id}`;
const userKey = (userId: string) => `alerts:user:${userId}`;

/** `{alertId}:{userId}` — the userId rides along so a triggered member can be
 *  dispatched without a second read. */
const member = (a: Pick<PriceAlert, "id" | "userId">) => `${a.id}:${a.userId}`;

function parseMember(raw: string): { alertId: string; userId: string } | null {
  const i = raw.indexOf(":");
  if (i <= 0 || i === raw.length - 1) return null;
  return { alertId: raw.slice(0, i), userId: raw.slice(i + 1) };
}

export interface CreateAlertInput {
  userId: string;
  symbol: string;
  direction: AlertDirection;
  targetPrice: number;
  frequency?: "once" | "recurring";
  /** The market price right now. Required — see the arming note. */
  currentPrice: number;
  note?: string;
}

/**
 * Create an alert.
 *
 * REFUSES AN ALREADY-SATISFIED CONDITION, which is the correctness decision in
 * this function rather than a validation nicety.
 *
 * "Tell me when EURUSD goes above 1.10" asked while it is already 1.15 is
 * satisfied the instant it is stored, so the engine fires immediately and the
 * user gets a notification about a move that happened before they asked. They
 * meant "when it CROSSES 1.10", and the crossing already happened.
 *
 * Silently arming it is worse than refusing: the user learns the feature sends
 * meaningless notifications. So the refusal names the current price and lets them
 * pick a target on the right side of it.
 */
export async function createAlert(input: CreateAlertInput): Promise<PriceAlert> {
  const symbol = input.symbol.trim().toUpperCase();
  if (!symbol) throw new AlertError("symbol is required.");
  if (!Number.isFinite(input.targetPrice) || input.targetPrice <= 0) {
    throw new AlertError("targetPrice must be a positive finite number.");
  }
  if (!Number.isFinite(input.currentPrice) || input.currentPrice <= 0) {
    throw new AlertError("currentPrice must be a positive finite number to arm an alert.");
  }

  if (input.direction === "above" && input.currentPrice >= input.targetPrice) {
    throw new AlertError(
      `${symbol} is already at ${input.currentPrice}, at or above your ${input.targetPrice} target — ` +
        `this alert would fire immediately. Pick a target above the current price, or use a "below" alert.`
    );
  }
  if (input.direction === "below" && input.currentPrice <= input.targetPrice) {
    throw new AlertError(
      `${symbol} is already at ${input.currentPrice}, at or below your ${input.targetPrice} target — ` +
        `this alert would fire immediately. Pick a target below the current price, or use an "above" alert.`
    );
  }

  const count = await kvZCard(userKey(input.userId));
  if (count >= MAX_ALERTS_PER_USER) {
    throw new AlertError(
      `You already have ${count} alerts, the maximum is ${MAX_ALERTS_PER_USER}. Delete one first.`
    );
  }

  const alert: PriceAlert = {
    id: `alr_${randomUUID()}`,
    userId: input.userId,
    symbol,
    direction: input.direction,
    targetPrice: input.targetPrice,
    frequency: input.frequency ?? "once",
    createdAtPrice: input.currentPrice,
    createdAt: new Date().toISOString(),
    ...(input.note ? { note: input.note.slice(0, 200) } : {}),
  };

  // Metadata first: an entry in the matching set whose metadata is missing would
  // trigger and then have nothing to say. The reverse — metadata with no set
  // entry — is inert and reclaimable.
  await kvSet(metaKey(alert.id), alert);
  await kvZAdd(userKey(alert.userId), alert.targetPrice, member(alert));
  await kvZAdd(zKey(alert.direction, symbol), alert.targetPrice, member(alert));
  return alert;
}

/** One user's alerts, newest first. */
export async function listAlerts(userId: string): Promise<PriceAlert[]> {
  const members = await kvZRangeByScore(userKey(userId), "-inf", "+inf");
  const out: PriceAlert[] = [];
  for (const m of members) {
    const parsed = parseMember(m);
    if (!parsed) continue;
    const alert = await kvGet<PriceAlert>(metaKey(parsed.alertId));
    if (alert) out.push(alert);
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Delete an alert, if it belongs to this user.
 *
 * OWNERSHIP IS CHECKED, and a foreign id is reported as "not found" rather than
 * "forbidden" — confirming that someone else's alert id exists is itself a
 * disclosure, and the caller has no legitimate use for the distinction.
 */
export async function deleteAlert(userId: string, alertId: string): Promise<boolean> {
  const alert = await kvGet<PriceAlert>(metaKey(alertId));
  if (!alert || alert.userId !== userId) return false;
  await kvZRem(zKey(alert.direction, alert.symbol), [member(alert)]);
  await kvZRem(userKey(userId), [member(alert)]);
  await kvDel(metaKey(alertId));
  return true;
}

export interface TriggeredAlert {
  alert: PriceAlert;
  /** The price that triggered it. */
  price: number;
}

/**
 * Evaluate one price tick and return the alerts this instance CLAIMED.
 *
 * "Claimed" is exact: the returned alerts are the ones this caller is responsible
 * for delivering, and no other concurrent evaluator will return them. The claim
 * is the ZREM — see the header note.
 *
 * Dispatch is deliberately NOT done here. The engine's job is deciding what
 * fired; sending is a separate concern with separate failure modes (a push
 * provider being down must not make the engine re-fire), and separating them is
 * what lets this be tested without a network.
 */
export async function evaluateTick(symbol: string, price: number): Promise<TriggeredAlert[]> {
  if (!Number.isFinite(price) || price <= 0) return [];
  const sym = symbol.toUpperCase();

  // "above" fires when price has reached or passed the target, so every target
  // at or below the current price is triggered. "below" is the mirror.
  const [aboveMembers, belowMembers] = await Promise.all([
    kvZRangeByScore(zKey("above", sym), "-inf", price),
    kvZRangeByScore(zKey("below", sym), price, "+inf"),
  ]);

  const claimed: TriggeredAlert[] = [];

  for (const [dir, members] of [
    ["above", aboveMembers],
    ["below", belowMembers],
  ] as const) {
    for (const raw of members) {
      const parsed = parseMember(raw);
      if (!parsed) continue;

      // THE CLAIM. Removing from the direction set is what makes delivery
      // exactly-once across instances: Redis reports how many members it
      // actually removed, so only the evaluator that gets 1 owns this alert.
      const removed = await kvZRem(zKey(dir, sym), [raw]);
      if (removed !== 1) continue; // another instance won it

      const alert = await kvGet<PriceAlert>(metaKey(parsed.alertId));
      if (!alert) {
        // Metadata gone (deleted, or expired). Clean the user index too so the
        // quota does not leak, and say nothing to anyone.
        await kvZRem(userKey(parsed.userId), [raw]);
        continue;
      }

      if (alert.frequency === "recurring") {
        const since = alert.lastFiredAt ? Date.now() - Date.parse(alert.lastFiredAt) : Infinity;
        if (since < RECURRING_COOLDOWN_MS) {
          // Inside the cooldown: re-arm without notifying. The alert was claimed
          // and must go back, or a flapping price would silently delete it.
          await kvZAdd(zKey(dir, sym), alert.targetPrice, raw);
          continue;
        }
        const updated: PriceAlert = { ...alert, lastFiredAt: new Date().toISOString() };
        await kvSet(metaKey(alert.id), updated);
        // Re-arm for the next crossing.
        await kvZAdd(zKey(dir, sym), alert.targetPrice, raw);
        claimed.push({ alert: updated, price });
        continue;
      }

      // `once`: fully retired. The direction-set entry is already gone.
      await kvZRem(userKey(alert.userId), [raw]);
      await kvDel(metaKey(alert.id));
      claimed.push({ alert, price });
    }
  }

  return claimed;
}

/** What a triggered alert says to the user. */
export function alertMessage(t: TriggeredAlert): { title: string; body: string } {
  const { alert, price } = t;
  const dir = alert.direction === "above" ? "rose above" : "fell below";
  return {
    title: `${alert.symbol} ${dir} ${alert.targetPrice}`,
    body: `${alert.symbol} is now ${price}.${alert.note ? ` — ${alert.note}` : ""}`,
  };
}
