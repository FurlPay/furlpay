import { api } from "@/lib/api";
import type { PaymentCard } from "@/lib/types";

// ---------------------------------------------------------------------------
// Card lifecycle — order → issue → deliver → activate → live → close.
//
// Every type and endpoint below was read out of apps/web/src/lib/services/
// cardLifecycle.ts and the routes under app/api/cards/, not transcribed from a
// document. Nothing here is invented: if a field is absent from this file, the
// server does not return it.
//
// THE APP HAD THE "LIVE" THIRD OF THIS AND NOTHING ELSE. cards.tsx called
// GET /cards and PATCH /cards/settings — list, freeze, limits, channels. The
// seventeen routes that get a card into someone's hands and take it out again
// were fully implemented server-side and had no caller at all.
//
// TWO SERVER RULES THE UI MUST NOT SOFTEN:
//
//  1. LOSS IS TERMINAL. `reportLost` cannot be undone — not unfrozen, not
//     reactivated, not re-PINned. Freezing is a reversible convenience; losing
//     is a security assertion, and an attacker holding the session must not be
//     able to un-report it. The only way forward is a reissue, which mints a
//     new number. Every confirmation in the UI has to say so plainly, because a
//     user who thinks this is "freeze but louder" will use it casually and then
//     be stuck.
//
//  2. THE PAN NEVER REACHES THIS APP. Revealing details mints a 60-second,
//     single-use grant that is exchanged with the PCI vault. FurlPay stores no
//     PAN and no CVV, so `revealCardDetails` returns a permit, not a number.
//     There is deliberately no code here that renders card digits from it.
// ---------------------------------------------------------------------------

export type CardStatus = "ordered" | "shipped" | "active" | "lost" | "closed";

export type CardKind = "virtual" | "physical";

export interface CardProduct {
  id: string;
  name: string;
  kind: CardKind;
  feeUsd: number;
  minTier: string;
  network: "Visa" | "Mastercard";
  shipsPhysically: boolean;
  description: string;
  /** False when this account cannot order it — `reasons` says why. */
  available: boolean;
  reasons: ProductBlockReason[];
}

/** The exact strings availableProducts() emits. */
export type ProductBlockReason = "kyc_required" | "tier_required" | "card_limit_reached";

export interface CardTheme {
  id: string;
  name: string;
  premium: boolean;
  gradient: [string, string];
  /** Set by GET /cards/products: premium design on a Standard plan. */
  locked?: boolean;
}

export interface ShippingAddress {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  postcode: string;
  /** ISO-3166 alpha-2, upper case. The server uppercases it too. */
  country: string;
}

/** Exactly `lifecycleView()`. The activation code is deliberately absent —
 *  it is printed on the carrier and no route ever returns it. */
export interface CardLifecycle {
  cardId: string;
  product: { id: string; name: string; kind: CardKind };
  status: CardStatus;
  orderedAt: string;
  shippedAt: string | null;
  activatedAt: string | null;
  closedAt: string | null;
  closeReason: "customer_closed" | "reissued" | "reported_lost" | null;
  hasPin: boolean;
  pinLockedUntil: string | null;
  activationAttemptsRemaining: number;
  shipping: ShippingAddress | null;
  trackingRef: string | null;
  theme: CardTheme;
  provisioning: { googlePay: boolean; applePay: boolean };
  replacesCardId: string | null;
  replacedByCardId: string | null;
}

// ── pure presentation rules ────────────────────────────────────────────────

/**
 * How a status reads to a human, and what colour it deserves.
 *
 * `tone` maps to the app's semantic palette rather than naming a colour, so a
 * theme change cannot silently turn a terminal state green.
 */
export interface StatusPresentation {
  label: string;
  tone: "good" | "warn" | "bad" | "neutral";
  /** One line of context. Empty for `active`, which needs no explanation. */
  detail: string;
}

export function statusPresentation(lc: CardLifecycle): StatusPresentation {
  switch (lc.status) {
    case "active":
      return { label: "Active", tone: "good", detail: "" };
    case "ordered":
      return {
        label: lc.product.kind === "physical" ? "Being made" : "Issued",
        tone: "neutral",
        detail:
          lc.product.kind === "physical"
            ? "We'll tell you when it ships. It arrives frozen and needs the code on the carrier."
            : "Ready to use.",
      };
    case "shipped":
      return {
        label: "In the post",
        tone: "neutral",
        detail: "It arrives frozen. Enter the 8-digit code on the carrier to start spending.",
      };
    case "lost":
      return {
        label: "Reported lost",
        tone: "bad",
        detail: "This card is permanently out of service and cannot be restored. Order a replacement to keep spending.",
      };
    case "closed":
      return {
        label: lc.closeReason === "reissued" ? "Replaced" : "Closed",
        tone: "neutral",
        detail:
          lc.closeReason === "reissued"
            ? "Superseded by a replacement card."
            : "This card is closed and cannot be reopened.",
      };
  }
}

/** A card in one of these states can never transact again, whatever the UI
 *  offers. Controls that imply otherwise must be hidden, not merely disabled. */
export function isTerminal(status: CardStatus): boolean {
  return status === "lost" || status === "closed";
}

/** Only a live card can be frozen, re-themed, PIN-changed or provisioned. */
export function canManage(lc: CardLifecycle): boolean {
  return lc.status === "active";
}

/** A physical card that has arrived but not yet been proven to be in hand. */
export function needsActivation(lc: CardLifecycle): boolean {
  return lc.status === "ordered" || lc.status === "shipped";
}

/**
 * Mirrors `isWeakPin` in the service, character for character.
 *
 * Duplicated deliberately rather than fetched: the server is still the gate,
 * but a user typing 1234 should be told while the field is focused, not after a
 * round trip that returns a 400. Both implementations reject repeats and any
 * strictly ascending or descending run.
 */
export function isWeakPin(pin: string): boolean {
  if (!/^\d{4}$/.test(pin)) return false; // shape errors are a different message
  if (/^(\d)\1+$/.test(pin)) return true;
  const digits = pin.split("").map(Number);
  const ascending = digits.every((d, i, a) => i === 0 || d === a[i - 1] + 1);
  const descending = digits.every((d, i, a) => i === 0 || d === a[i - 1] - 1);
  return ascending || descending;
}

/** Null when the PIN is acceptable; otherwise the message to show. */
export function pinError(pin: string): string | null {
  if (!/^\d{4}$/.test(pin)) return "A PIN is exactly 4 digits.";
  if (isWeakPin(pin)) return "Avoid repeated digits and simple runs like 1234 — pick something harder to guess.";
  return null;
}

/** Why a product cannot be ordered, in the user's words rather than the enum's. */
export function blockReasonText(reason: ProductBlockReason, minTier: string): string {
  switch (reason) {
    case "kyc_required":
      return "Verify your identity first — a card is a regulated payment instrument.";
    case "tier_required":
      return `Available on the ${minTier} plan and above.`;
    case "card_limit_reached":
      return "You've reached the maximum number of cards on this account.";
  }
}

/** Remaining lock time in whole minutes, or 0 when the PIN is usable. */
export function pinLockMinutesRemaining(lockedUntil: string | null, now = Date.now()): number {
  if (!lockedUntil) return 0;
  const ms = Date.parse(lockedUntil) - now;
  return ms > 0 ? Math.ceil(ms / 60_000) : 0;
}

// ── transport ──────────────────────────────────────────────────────────────

export async function fetchCardProducts(signal?: AbortSignal): Promise<{
  products: CardProduct[];
  themes: CardTheme[];
}> {
  const res = await api<{ products: CardProduct[]; themes: CardTheme[] }>("/cards/products", {
    signal,
  });
  return { products: res.products ?? [], themes: res.themes ?? [] };
}

export async function fetchCardLifecycle(
  cardId: string,
  signal?: AbortSignal
): Promise<CardLifecycle> {
  const res = await api<{ lifecycle: CardLifecycle }>(
    `/cards/lifecycle/${encodeURIComponent(cardId)}`,
    { signal }
  );
  return res.lifecycle;
}

export interface OrderCardInput {
  productId: string;
  label: string;
  themeId?: string;
  shipping?: ShippingAddress;
}

/**
 * Order a card.
 *
 * `idempotencyKey` is REQUIRED, not optional. Ordering charges an issuance fee
 * and mints a card; the route wraps itself in `withIdempotency`, and a retry
 * after a timeout without the same key produces a second card and a second
 * charge. Callers derive the key from the payload so a genuine second order is
 * still possible.
 */
export async function orderCard(
  input: OrderCardInput,
  idempotencyKey: string
): Promise<{ card: PaymentCard; lifecycle: CardLifecycle; feeUsd: number }> {
  return api<{ card: PaymentCard; lifecycle: CardLifecycle; feeUsd: number }>("/cards/order", {
    method: "POST",
    body: input,
    headers: { "Idempotency-Key": idempotencyKey },
  });
}

export async function activateCard(cardId: string, code: string): Promise<CardLifecycle> {
  const res = await api<{ lifecycle: CardLifecycle }>(
    `/cards/lifecycle/${encodeURIComponent(cardId)}/activate`,
    { method: "POST", body: { code } }
  );
  return res.lifecycle;
}

export async function setCardPin(cardId: string, pin: string): Promise<CardLifecycle> {
  const res = await api<{ lifecycle: CardLifecycle }>(
    `/cards/lifecycle/${encodeURIComponent(cardId)}/pin`,
    { method: "PUT", body: { pin } }
  );
  return res.lifecycle;
}

export interface PinVerifyResult {
  ok: boolean;
  attemptsRemaining: number;
  lockedUntil: string | null;
}

/**
 * Check a PIN the user has entered.
 *
 * Returns a RESULT rather than throwing on a wrong PIN: "that was wrong, 2 tries
 * left" is information the screen has to render, and turning it into an
 * exception loses `attemptsRemaining` — the one field that stops the user
 * locking themselves out blind.
 */
export async function verifyCardPin(cardId: string, pin: string): Promise<PinVerifyResult> {
  return api<PinVerifyResult>(`/cards/lifecycle/${encodeURIComponent(cardId)}/pin`, {
    method: "POST",
    body: { pin },
  });
}

export async function setCardTheme(cardId: string, themeId: string): Promise<CardLifecycle> {
  const res = await api<{ lifecycle: CardLifecycle }>(
    `/cards/lifecycle/${encodeURIComponent(cardId)}/theme`,
    { method: "PUT", body: { themeId } }
  );
  return res.lifecycle;
}

export async function updateCardShipping(
  cardId: string,
  address: ShippingAddress
): Promise<CardLifecycle> {
  const res = await api<{ lifecycle: CardLifecycle }>(
    `/cards/lifecycle/${encodeURIComponent(cardId)}/shipping`,
    { method: "PUT", body: address }
  );
  return res.lifecycle;
}

export async function setCardProvisioning(
  cardId: string,
  wallet: "googlePay" | "applePay",
  enabled: boolean
): Promise<CardLifecycle> {
  const res = await api<{ lifecycle: CardLifecycle }>(
    `/cards/lifecycle/${encodeURIComponent(cardId)}/provisioning`,
    { method: "PATCH", body: { wallet, enabled } }
  );
  return res.lifecycle;
}

/** Irreversible. See the module header. */
export async function reportCardLost(cardId: string): Promise<CardLifecycle> {
  const res = await api<{ lifecycle: CardLifecycle }>(
    `/cards/lifecycle/${encodeURIComponent(cardId)}/report-lost`,
    { method: "POST" }
  );
  return res.lifecycle;
}

/** Irreversible, and distinct from reporting a loss — the record keeps them
 *  apart because one is housekeeping and the other is a security event. */
export async function closeCard(cardId: string): Promise<CardLifecycle> {
  const res = await api<{ lifecycle: CardLifecycle }>(
    `/cards/lifecycle/${encodeURIComponent(cardId)}`,
    { method: "DELETE" }
  );
  return res.lifecycle;
}

export async function reissueCard(
  cardId: string,
  input: { label: string; shipping?: ShippingAddress },
  idempotencyKey: string
): Promise<{ card: PaymentCard; lifecycle: CardLifecycle; previous: CardLifecycle; feeUsd: number }> {
  return api<{
    card: PaymentCard;
    lifecycle: CardLifecycle;
    previous: CardLifecycle;
    feeUsd: number;
  }>(`/cards/lifecycle/${encodeURIComponent(cardId)}/reissue`, {
    method: "POST",
    body: input,
    headers: { "Idempotency-Key": idempotencyKey },
  });
}

/**
 * A single-use permit to fetch the PAN and CVV from the PCI vault.
 *
 * WHAT THIS DOES NOT RETURN: the card number. The server holds neither, by
 * design. The grant is exchanged directly with the vault by whatever client
 * eventually implements that exchange.
 *
 * TODO(backend): no vault exchange endpoint exists yet — `consumeRevealGrant`
 * is implemented in the service but nothing is mounted that trades a grant for
 * card details. Until one is, the app can prove it is allowed to reveal but
 * cannot display anything, so the reveal UI stays on the existing masked
 * `/cards` data and this function is not called from a screen. Wiring it up is
 * a backend task, not a client one, and faking digits here would be worse than
 * the gap.
 */
export async function mintRevealGrant(
  cardId: string
): Promise<{ grantToken: string; expiresAt: string; ttlSeconds: number }> {
  return api<{ grantToken: string; expiresAt: string; ttlSeconds: number }>(
    `/cards/lifecycle/${encodeURIComponent(cardId)}/reveal`,
    { method: "POST" }
  );
}
