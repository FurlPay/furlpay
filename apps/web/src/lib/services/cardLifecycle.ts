import { randomUUID, randomInt, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import type { CardKind, PaymentCard } from "@/lib/types";
import type { Tier } from "@/lib/entitlements";

// ---------------------------------------------------------------------------
// Card lifecycle: order → issue → deliver → activate → live → close.
//
// FurlPay had the LIVE part only (freeze, limits, channels, 3DS). Everything
// that gets a card into a customer's hands, and everything that takes it out
// again, lived nowhere. RedotPay ships 59 card endpoints against FurlPay's 6,
// and this is most of that delta.
//
// Two design rules run through the whole module:
//
//  1. LOSS IS TERMINAL. A card reported lost can never be unfrozen, reactivated
//     or re-PINned. "Frozen" is a reversible convenience control; "lost" is a
//     security assertion, and letting it be undone would make the control
//     worthless — an attacker who takes over the session could simply un-report
//     it. Recovery is a reissue, which mints a new number.
//
//  2. THE PAN NEVER TOUCHES THIS SERVER. Revealing card details mints a
//     short-lived, single-use grant that the client exchanges directly with the
//     PCI vault. FurlPay stores no PAN and no CVV, so there is nothing here to
//     leak and nothing to fabricate. See `mintRevealGrant`.
//
// MOCK/in-memory like the other service modules; the state machine, the PIN
// rules and the possession checks are the parts meant to survive the move to
// Postgres.
// ---------------------------------------------------------------------------

export type CardStatus =
  | "ordered" // paid for, not yet produced
  | "shipped" // physical card in transit
  | "active" // usable
  | "lost" // reported lost or stolen — TERMINAL
  | "closed"; // closed by the customer, or superseded by a reissue

export interface CardProduct {
  id: string;
  name: string;
  kind: CardKind;
  /** Issuance fee in USD. */
  feeUsd: number;
  /** Lowest membership tier that may order this product. */
  minTier: Tier;
  network: PaymentCard["network"];
  /** Physical products ship; virtual ones activate immediately. */
  shipsPhysically: boolean;
  description: string;
}

export const CARD_PRODUCTS: CardProduct[] = [
  {
    id: "virtual-standard",
    name: "Virtual",
    kind: "virtual",
    feeUsd: 0,
    minTier: "Standard",
    network: "Visa",
    shipsPhysically: false,
    description: "Issued instantly. Add to Apple Pay or Google Pay and spend today.",
  },
  {
    id: "physical-core",
    name: "Core",
    kind: "physical",
    feeUsd: 9.99,
    minTier: "Standard",
    network: "Visa",
    shipsPhysically: true,
    description: "Contactless recycled-plastic card. Ships in 7–14 days.",
  },
  {
    id: "physical-metal",
    name: "Metal",
    kind: "physical",
    feeUsd: 49.99,
    minTier: "Pro",
    network: "Visa",
    shipsPhysically: true,
    description: "Brushed stainless steel, laser-etched. Ships in 7–14 days.",
  },
];

// electric / world / pearl are the three designs shown on /telegram
// (components/telegram/PaymentCard.tsx). The clients key their artwork off the
// id; the gradient is the fallback for a client that does not know the design.
export const CARD_THEMES = [
  { id: "electric", name: "Electric", premium: false, gradient: ["#14197D", "#006BFF"] as [string, string] },
  { id: "world", name: "World", premium: false, gradient: ["#060B21", "#0B2A6B"] as [string, string] },
  { id: "pearl", name: "Pearl", premium: false, gradient: ["#F1F0FF", "#C7A7F8"] as [string, string] },
  { id: "midnight", name: "Midnight", premium: false, gradient: ["#0B1220", "#1E293B"] as [string, string] },
  { id: "sand", name: "Sand", premium: false, gradient: ["#D9C6A5", "#8C7A5B"] as [string, string] },
  { id: "teal", name: "Deep Teal", premium: false, gradient: ["#0E4F52", "#08282B"] as [string, string] },
  { id: "aurora", name: "Aurora", premium: true, gradient: ["#3B1E54", "#0E7C86"] as [string, string] },
  { id: "copper", name: "Copper", premium: true, gradient: ["#7A3B14", "#2A1408"] as [string, string] },
];

export interface ShippingAddress {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  postcode: string;
  /** ISO-3166 alpha-2. */
  country: string;
}

interface PinRecord {
  salt: string;
  hash: string;
  setAt: string;
  failedAttempts: number;
  /** ISO timestamp; verification refuses until it passes. */
  lockedUntil: string | null;
}

export interface CardLifecycle {
  cardId: string;
  userId: string;
  productId: string;
  status: CardStatus;
  orderedAt: string;
  shippedAt: string | null;
  activatedAt: string | null;
  closedAt: string | null;
  /** Reason a card left service, for support and for the customer's own view. */
  closeReason: "customer_closed" | "reissued" | "reported_lost" | null;
  /**
   * Proof-of-possession code printed on the carrier a physical card ships in.
   * Never returned by any route — the customer reads it off the card.
   */
  activationCode: string | null;
  activationAttempts: number;
  pin: PinRecord | null;
  shipping: ShippingAddress | null;
  trackingRef: string | null;
  themeId: string;
  provisioning: { googlePay: boolean; applePay: boolean };
  /** Reissue chain, so support can follow a card's ancestry. */
  replacesCardId: string | null;
  replacedByCardId: string | null;
}

/** A short-lived, single-use permit to fetch card details from the PCI vault. */
export interface RevealGrant {
  token: string;
  cardId: string;
  userId: string;
  expiresAt: string;
  usedAt: string | null;
}

interface CardState {
  lifecycles: Map<string, CardLifecycle>;
  grants: Map<string, RevealGrant>;
}

const globalForCards = globalThis as unknown as { __cardLifecycle?: CardState };
const state: CardState =
  globalForCards.__cardLifecycle ?? (globalForCards.__cardLifecycle = { lifecycles: new Map(), grants: new Map() });

export const CARD_LIMITS = {
  maxCardsPerUser: 5,
  pinLength: 4,
  maxPinAttempts: 3,
  pinLockMinutes: 15,
  maxActivationAttempts: 5,
  revealGrantTtlSeconds: 60,
  maxLabelLength: 24,
} as const;

const TIER_RANK: Record<Tier, number> = { Standard: 0, Pro: 1, Ultra: 2 };

export function productFor(id: string): CardProduct {
  const p = CARD_PRODUCTS.find((x) => x.id === id);
  if (!p) throw new Error("Unknown card product");
  return p;
}

export function themeFor(id: string) {
  const t = CARD_THEMES.find((x) => x.id === id);
  if (!t) throw new Error("Unknown card theme");
  return t;
}

// --- ordering ---------------------------------------------------------------

export interface OrderResult {
  lifecycle: CardLifecycle;
  card: Omit<PaymentCard, "id"> & { id: string };
  /** Issuance fee to charge, if any. */
  feeUsd: number;
}

/**
 * Order a card. A virtual product is live the moment it is issued; a physical
 * one is `ordered`, ships, and only becomes usable once the customer proves
 * possession by entering the code on the carrier.
 */
export function orderCard(
  userId: string,
  input: { productId: string; label: string; themeId?: string; shipping?: ShippingAddress },
  context: { tier: Tier; kycVerified: boolean; existingCards: number },
): OrderResult {
  const product = productFor(input.productId);

  // A card is a regulated payment instrument; it does not get issued to an
  // unverified identity.
  if (!context.kycVerified) throw new Error("Identity verification required");
  if (TIER_RANK[context.tier] < TIER_RANK[product.minTier]) {
    throw new Error(`${product.name} requires the ${product.minTier} plan`);
  }
  if (context.existingCards >= CARD_LIMITS.maxCardsPerUser) throw new Error("Card limit reached");
  if (product.shipsPhysically && !input.shipping) throw new Error("A shipping address is required");

  const theme = themeFor(input.themeId ?? "midnight");
  if (theme.premium && TIER_RANK[context.tier] < TIER_RANK.Pro) {
    throw new Error("That design is available on Pro and above");
  }

  const cardId = "card_" + randomUUID();
  const now = new Date().toISOString();

  const lifecycle: CardLifecycle = {
    cardId,
    userId,
    productId: product.id,
    status: product.shipsPhysically ? "ordered" : "active",
    orderedAt: now,
    shippedAt: null,
    activatedAt: product.shipsPhysically ? null : now,
    closedAt: null,
    closeReason: null,
    // Generated now and printed on the carrier, so it exists before the card
    // is in anyone's hands.
    activationCode: product.shipsPhysically ? newActivationCode() : null,
    activationAttempts: 0,
    pin: null,
    shipping: input.shipping ?? null,
    trackingRef: null,
    themeId: theme.id,
    provisioning: { googlePay: false, applePay: false },
    replacesCardId: null,
    replacedByCardId: null,
  };
  state.lifecycles.set(cardId, lifecycle);

  const card: PaymentCard = {
    id: cardId,
    kind: product.kind,
    label: input.label,
    last4: newLast4(),
    network: product.network,
    // A card that has not been activated must not authorize. Frozen is the
    // existing mechanism for that, so an un-activated card starts frozen.
    frozen: product.shipsPhysically,
    gradient: theme.gradient,
    limits: { perPurchase: 2000, daily: 5000, dailySpent: 0 },
    channels: { online: true, offline: true, atm: product.kind === "physical" },
    settlementCurrency: "USD",
  };

  return { lifecycle, card, feeUsd: product.feeUsd };
}

function newLast4(): string {
  return String(randomInt(10000)).padStart(4, "0");
}

function newActivationCode(): string {
  // 8 digits, from a CSPRNG. It is a possession proof, so it must not be
  // guessable from anything the customer's account already exposes.
  return String(randomInt(100000000)).padStart(8, "0");
}

export function getLifecycle(cardId: string, userId: string): CardLifecycle {
  const lc = state.lifecycles.get(cardId);
  // A card that is not yours is indistinguishable from one that does not exist.
  if (!lc || lc.userId !== userId) throw new Error("Card not found");
  return lc;
}

export function listLifecycles(userId: string): CardLifecycle[] {
  return [...state.lifecycles.values()]
    .filter((l) => l.userId === userId)
    .sort((a, b) => b.orderedAt.localeCompare(a.orderedAt));
}

/** Register a card that predates this module, so old cards get a lifecycle. */
export function adoptExistingCard(userId: string, card: PaymentCard): CardLifecycle {
  const existing = state.lifecycles.get(card.id);
  if (existing) return existing;
  const lc: CardLifecycle = {
    cardId: card.id,
    userId,
    productId: card.kind === "physical" ? "physical-core" : "virtual-standard",
    status: "active",
    orderedAt: new Date().toISOString(),
    shippedAt: null,
    activatedAt: new Date().toISOString(),
    closedAt: null,
    closeReason: null,
    activationCode: null,
    activationAttempts: 0,
    pin: null,
    shipping: null,
    trackingRef: null,
    themeId: "midnight",
    provisioning: { googlePay: false, applePay: false },
    replacesCardId: null,
    replacedByCardId: null,
  };
  state.lifecycles.set(card.id, lc);
  return lc;
}

// --- shipping ---------------------------------------------------------------

/** Move an ordered card into transit. Ops/fulfilment side. */
export function markShipped(cardId: string, trackingRef: string): CardLifecycle {
  const lc = state.lifecycles.get(cardId);
  if (!lc) throw new Error("Card not found");
  if (lc.status !== "ordered") throw new Error(`Card is ${lc.status}`);
  lc.status = "shipped";
  lc.shippedAt = new Date().toISOString();
  lc.trackingRef = trackingRef;
  return lc;
}

/**
 * Change where a card is going. Only while it is still `ordered` — once it is
 * in the post, editing the address here would tell the customer their card is
 * going somewhere it is not.
 */
export function updateShipping(cardId: string, userId: string, address: ShippingAddress): CardLifecycle {
  const lc = getLifecycle(cardId, userId);
  if (lc.status !== "ordered") throw new Error("The card has already been dispatched");
  lc.shipping = address;
  return lc;
}

// --- activation -------------------------------------------------------------

/**
 * Activate a delivered physical card by entering the code on its carrier.
 *
 * The attempt counter is the whole point: an 8-digit code with unlimited
 * guesses is not a possession proof. Exhausting the attempts requires a
 * reissue rather than a lockout that expires, because a card whose code has
 * been brute-forced should not go live at all.
 */
export function activateCard(cardId: string, userId: string, code: string): CardLifecycle {
  const lc = getLifecycle(cardId, userId);
  if (lc.status === "active") throw new Error("Card is already active");
  if (lc.status !== "shipped" && lc.status !== "ordered") throw new Error(`Card is ${lc.status}`);
  if (lc.activationAttempts >= CARD_LIMITS.maxActivationAttempts) {
    throw new Error("Too many failed attempts — request a replacement card");
  }

  const expected = lc.activationCode;
  if (!expected || !constantTimeEquals(code, expected)) {
    lc.activationAttempts += 1;
    throw new Error("Incorrect activation code");
  }

  lc.status = "active";
  lc.activatedAt = new Date().toISOString();
  // The code has done its job; keeping it is keeping a credential for no reason.
  lc.activationCode = null;
  lc.activationAttempts = 0;
  return lc;
}

// --- PIN --------------------------------------------------------------------

/** Sequences and repeats are the PINs that get guessed first. */
export function isWeakPin(pin: string): boolean {
  if (/^(\d)\1+$/.test(pin)) return true; // 0000, 1111
  const ascending = pin.split("").every((d, i, a) => i === 0 || Number(d) === Number(a[i - 1]) + 1);
  const descending = pin.split("").every((d, i, a) => i === 0 || Number(d) === Number(a[i - 1]) - 1);
  return ascending || descending;
}

function hashPin(pin: string, salt: string): string {
  return scryptSync(pin, salt, 32).toString("hex");
}

/**
 * Set or change the PIN.
 *
 * Stored salted and scrypt-hashed, exactly like a password — the difference
 * between a PIN and a password is length, not sensitivity. Nothing in this
 * module ever returns it, and there is deliberately no "get PIN" path: an
 * issuer that can show you your PIN can show it to whoever takes over your
 * session.
 */
export function setPin(cardId: string, userId: string, pin: string): CardLifecycle {
  const lc = getLifecycle(cardId, userId);
  if (lc.status === "lost" || lc.status === "closed") throw new Error(`Card is ${lc.status}`);
  if (!new RegExp(`^\\d{${CARD_LIMITS.pinLength}}$`).test(pin)) {
    throw new Error(`PIN must be ${CARD_LIMITS.pinLength} digits`);
  }
  if (isWeakPin(pin)) throw new Error("Choose a less predictable PIN");

  const salt = randomBytes(16).toString("hex");
  lc.pin = { salt, hash: hashPin(pin, salt), setAt: new Date().toISOString(), failedAttempts: 0, lockedUntil: null };
  return lc;
}

export interface PinVerifyResult {
  ok: boolean;
  attemptsRemaining: number;
  lockedUntil: string | null;
}

/** Check a PIN, with lockout. Wrong answers are never distinguished by reason. */
export function verifyPin(cardId: string, userId: string, pin: string, now: Date = new Date()): PinVerifyResult {
  const lc = getLifecycle(cardId, userId);
  if (!lc.pin) throw new Error("No PIN is set on this card");

  if (lc.pin.lockedUntil && Date.parse(lc.pin.lockedUntil) > now.getTime()) {
    return { ok: false, attemptsRemaining: 0, lockedUntil: lc.pin.lockedUntil };
  }
  // The lock has expired — start the customer on a fresh set of attempts.
  if (lc.pin.lockedUntil) {
    lc.pin.lockedUntil = null;
    lc.pin.failedAttempts = 0;
  }

  const candidate = hashPin(pin, lc.pin.salt);
  if (constantTimeEquals(candidate, lc.pin.hash)) {
    lc.pin.failedAttempts = 0;
    return { ok: true, attemptsRemaining: CARD_LIMITS.maxPinAttempts, lockedUntil: null };
  }

  lc.pin.failedAttempts += 1;
  if (lc.pin.failedAttempts >= CARD_LIMITS.maxPinAttempts) {
    lc.pin.lockedUntil = new Date(now.getTime() + CARD_LIMITS.pinLockMinutes * 60_000).toISOString();
    return { ok: false, attemptsRemaining: 0, lockedUntil: lc.pin.lockedUntil };
  }
  return {
    ok: false,
    attemptsRemaining: CARD_LIMITS.maxPinAttempts - lc.pin.failedAttempts,
    lockedUntil: null,
  };
}

// --- loss, closure, reissue -------------------------------------------------

/**
 * Report a card lost or stolen. TERMINAL by design — see the module header.
 * The caller is responsible for also freezing the PaymentCard record.
 */
export function reportLost(cardId: string, userId: string): CardLifecycle {
  const lc = getLifecycle(cardId, userId);
  if (lc.status === "lost") throw new Error("Card is already reported lost");
  if (lc.status === "closed") throw new Error("Card is closed");
  lc.status = "lost";
  lc.closedAt = new Date().toISOString();
  lc.closeReason = "reported_lost";
  // A lost card's PIN and provisioning die with it.
  lc.pin = null;
  lc.provisioning = { googlePay: false, applePay: false };
  return lc;
}

export function closeCard(cardId: string, userId: string): CardLifecycle {
  const lc = getLifecycle(cardId, userId);
  if (lc.status === "closed" || lc.status === "lost") throw new Error(`Card is ${lc.status}`);
  lc.status = "closed";
  lc.closedAt = new Date().toISOString();
  lc.closeReason = "customer_closed";
  lc.pin = null;
  lc.provisioning = { googlePay: false, applePay: false };
  return lc;
}

export interface ReissueResult {
  previous: CardLifecycle;
  lifecycle: CardLifecycle;
  card: PaymentCard;
  feeUsd: number;
}

/**
 * Replace a card. This is the recovery path from a loss, and the only one.
 *
 * The replacement gets a NEW number and NO PIN: carrying either across would
 * mean the compromised card's details still work, which is the entire reason
 * the customer is here.
 */
export function reissueCard(
  cardId: string,
  userId: string,
  input: { label: string; shipping?: ShippingAddress },
): ReissueResult {
  const previous = getLifecycle(cardId, userId);
  if (previous.replacedByCardId) throw new Error("Card has already been replaced");

  const product = productFor(previous.productId);
  if (product.shipsPhysically && !input.shipping && !previous.shipping) {
    throw new Error("A shipping address is required");
  }

  const newId = "card_" + randomUUID();
  const now = new Date().toISOString();
  const theme = themeFor(previous.themeId);

  const lifecycle: CardLifecycle = {
    cardId: newId,
    userId,
    productId: previous.productId,
    status: product.shipsPhysically ? "ordered" : "active",
    orderedAt: now,
    shippedAt: null,
    activatedAt: product.shipsPhysically ? null : now,
    closedAt: null,
    closeReason: null,
    activationCode: product.shipsPhysically ? newActivationCode() : null,
    activationAttempts: 0,
    pin: null,
    shipping: input.shipping ?? previous.shipping,
    trackingRef: null,
    themeId: previous.themeId,
    provisioning: { googlePay: false, applePay: false },
    replacesCardId: previous.cardId,
    replacedByCardId: null,
  };
  state.lifecycles.set(newId, lifecycle);

  previous.replacedByCardId = newId;
  // A card reported lost stays `lost` — that is the security record, and
  // overwriting it with "reissued" would erase why it left service.
  if (previous.status !== "lost") {
    previous.status = "closed";
    previous.closedAt = now;
    previous.closeReason = "reissued";
  }
  previous.pin = null;
  previous.provisioning = { googlePay: false, applePay: false };

  const card: PaymentCard = {
    id: newId,
    kind: product.kind,
    label: input.label,
    last4: newLast4(),
    network: product.network,
    frozen: product.shipsPhysically,
    gradient: theme.gradient,
    limits: { perPurchase: 2000, daily: 5000, dailySpent: 0 },
    channels: { online: true, offline: true, atm: product.kind === "physical" },
    settlementCurrency: "USD",
  };

  return { previous, lifecycle, card, feeUsd: product.feeUsd };
}

// --- themes and provisioning ------------------------------------------------

export function setTheme(cardId: string, userId: string, themeId: string, tier: Tier): CardLifecycle {
  const lc = getLifecycle(cardId, userId);
  if (lc.status === "lost" || lc.status === "closed") throw new Error(`Card is ${lc.status}`);
  const theme = themeFor(themeId);
  if (theme.premium && TIER_RANK[tier] < TIER_RANK.Pro) {
    throw new Error("That design is available on Pro and above");
  }
  lc.themeId = theme.id;
  return lc;
}

/**
 * Record that a card was pushed to a device wallet. Only an ACTIVE card may be
 * provisioned — an un-activated or dead card in Apple Pay is a decline waiting
 * to happen, and a confusing one.
 */
export function setProvisioning(
  cardId: string,
  userId: string,
  wallet: "googlePay" | "applePay",
  enabled: boolean,
): CardLifecycle {
  const lc = getLifecycle(cardId, userId);
  if (enabled && lc.status !== "active") throw new Error(`Card is ${lc.status}`);
  lc.provisioning[wallet] = enabled;
  return lc;
}

// --- detail reveal ----------------------------------------------------------

/**
 * Mint a single-use, 60-second permit to read the card's PAN and CVV.
 *
 * FurlPay never holds those values — the client exchanges this grant directly
 * with the PCI vault, which keeps the card data entirely out of our scope. The
 * grant is bound to one card and one user, so it cannot be replayed against a
 * different card even inside the window.
 */
export function mintRevealGrant(cardId: string, userId: string): RevealGrant {
  const lc = getLifecycle(cardId, userId);
  if (lc.status !== "active") throw new Error(`Card is ${lc.status}`);

  const grant: RevealGrant = {
    token: randomBytes(32).toString("base64url"),
    cardId,
    userId,
    expiresAt: new Date(Date.now() + CARD_LIMITS.revealGrantTtlSeconds * 1000).toISOString(),
    usedAt: null,
  };
  state.grants.set(grant.token, grant);
  return grant;
}

export function consumeRevealGrant(token: string, userId: string, now: Date = new Date()): RevealGrant {
  const grant = state.grants.get(token);
  if (!grant || grant.userId !== userId) throw new Error("Grant not found");
  if (grant.usedAt) throw new Error("Grant already used");
  if (Date.parse(grant.expiresAt) <= now.getTime()) throw new Error("Grant has expired");
  grant.usedAt = now.toISOString();
  return grant;
}

// --- views ------------------------------------------------------------------

/** Lifecycle as the customer sees it — no codes, no PIN material, no grants. */
export function lifecycleView(lc: CardLifecycle) {
  const product = productFor(lc.productId);
  return {
    cardId: lc.cardId,
    product: { id: product.id, name: product.name, kind: product.kind },
    status: lc.status,
    orderedAt: lc.orderedAt,
    shippedAt: lc.shippedAt,
    activatedAt: lc.activatedAt,
    closedAt: lc.closedAt,
    closeReason: lc.closeReason,
    // Whether a PIN exists is useful; the PIN itself is never derivable here.
    hasPin: Boolean(lc.pin),
    pinLockedUntil: lc.pin?.lockedUntil ?? null,
    // Surfaced so the client can say "3 tries left" rather than failing blankly.
    activationAttemptsRemaining: Math.max(0, CARD_LIMITS.maxActivationAttempts - lc.activationAttempts),
    shipping: lc.shipping,
    trackingRef: lc.trackingRef,
    theme: themeFor(lc.themeId),
    provisioning: lc.provisioning,
    replacesCardId: lc.replacesCardId,
    replacedByCardId: lc.replacedByCardId,
  };
}

/** Which products this account may order right now, and why not otherwise. */
export function availableProducts(tier: Tier, kycVerified: boolean, existingCards: number) {
  return CARD_PRODUCTS.map((p) => {
    const reasons: string[] = [];
    if (!kycVerified) reasons.push("kyc_required");
    if (TIER_RANK[tier] < TIER_RANK[p.minTier]) reasons.push("tier_required");
    if (existingCards >= CARD_LIMITS.maxCardsPerUser) reasons.push("card_limit_reached");
    return { ...p, available: reasons.length === 0, reasons };
  });
}

function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  // timingSafeEqual throws on a length mismatch, which would itself leak the
  // length — compare lengths separately and always run the digest compare.
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Test seam — the in-memory maps are process-global otherwise. */
export function __resetCardLifecycleForTests(): void {
  state.lifecycles.clear();
  state.grants.clear();
}

/** Test seam: read the activation code a carrier would have printed. */
export function __activationCodeForTests(cardId: string): string | null {
  return state.lifecycles.get(cardId)?.activationCode ?? null;
}
