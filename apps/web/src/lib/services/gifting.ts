import { randomUUID, randomInt } from "crypto";

// ---------------------------------------------------------------------------
// Red packets, gift cards and promo coupons.
//
// A red packet is the "lucky money" pattern: the sender funds one pot, sets how
// many people may claim it, and the pot is split either evenly or randomly.
// The interesting constraints are conservation ones — the parts must sum to the
// whole, exactly, with no rounding dust created or destroyed, and the pot must
// never pay out more than was funded no matter how many people race to claim.
//
// Funding is escrowed at creation, like a P2P order: an unfunded packet that
// pays out is the failure mode worth designing against. Whatever is unclaimed
// when the packet expires goes back to the sender.
//
// MOCK/in-memory like the other service modules.
// ---------------------------------------------------------------------------

export type PacketSplit = "equal" | "random";
export type PacketStatus = "open" | "emptied" | "expired" | "refunded";

export interface RedPacket {
  id: string;
  /** Short shareable code — the capability to claim. */
  code: string;
  senderId: string;
  message: string;
  token: "USDC" | "USDT";
  totalAmount: number;
  /** How many claims the packet allows. */
  slots: number;
  split: PacketSplit;
  /** Pre-computed shares, one per slot, that sum EXACTLY to totalAmount. */
  shares: number[];
  claims: PacketClaim[];
  status: PacketStatus;
  createdAt: string;
  expiresAt: string;
  refundedAmount: number | null;
}

export interface PacketClaim {
  userId: string;
  amount: number;
  claimedAt: string;
}

export interface Voucher {
  id: string;
  code: string;
  /** Null for a promo issued by FurlPay rather than bought by a user. */
  purchaserId: string | null;
  kind: "gift_card" | "coupon";
  token: "USDC" | "USDT";
  /** Face value for a gift card; discount value for a coupon. */
  amount: number;
  /** Coupons only: minimum spend before the coupon applies. */
  minSpend: number;
  redeemedBy: string | null;
  redeemedAt: string | null;
  createdAt: string;
  expiresAt: string;
}

interface GiftingState {
  packets: Map<string, RedPacket>;
  byCode: Map<string, string>;
  vouchers: Map<string, Voucher>;
  voucherByCode: Map<string, string>;
}

const globalForGifting = globalThis as unknown as { __gifting?: GiftingState };
const state: GiftingState =
  globalForGifting.__gifting ??
  (globalForGifting.__gifting = {
    packets: new Map(),
    byCode: new Map(),
    vouchers: new Map(),
    voucherByCode: new Map(),
  });

export const GIFTING_LIMITS = {
  maxPacketAmount: 10_000,
  minPacketAmount: 1,
  maxSlots: 100,
  minSlots: 1,
  maxMessageLength: 120,
  packetTtlHours: 24,
  maxVoucherAmount: 10_000,
  voucherTtlDays: 365,
} as const;

/** Unambiguous alphabet — no O/0, I/1, so a code read aloud survives. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function newCode(len = 10): string {
  let out = "";
  for (let i = 0; i < len; i++) {
    // randomInt, not Math.random — the code IS the capability to take money.
    out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return out;
}

// --- splitting --------------------------------------------------------------

/**
 * Split `total` across `slots` shares that sum to exactly `total`.
 *
 * Both modes work in integer cents and hand any remainder to the last shares,
 * so the parts always reconstitute the whole. Doing this in floats is how a
 * packet ends up a cent short — or a cent rich, which is worse.
 */
export function splitAmount(total: number, slots: number, mode: PacketSplit): number[] {
  const cents = Math.round(total * 100);
  if (slots < 1) throw new Error("A packet needs at least one slot");
  if (cents < slots) throw new Error("Amount is too small to split across that many slots");

  if (mode === "equal") {
    const base = Math.floor(cents / slots);
    const remainder = cents - base * slots;
    // Spread the remainder one cent at a time rather than dumping it on one
    // share; nobody gets a visibly odd amount.
    return Array.from({ length: slots }, (_, i) => (base + (i < remainder ? 1 : 0)) / 100);
  }

  // Random split, "leftover" method: each share takes a random slice of what
  // remains, bounded so every later slot can still receive at least one cent.
  const shares: number[] = [];
  let remaining = cents;
  for (let i = 0; i < slots - 1; i++) {
    const slotsLeft = slots - i;
    // Cap at twice the fair share, the convention that keeps the spread
    // interesting without letting the first claimant take almost everything.
    const maxTake = Math.max(1, Math.min(remaining - (slotsLeft - 1), Math.floor((remaining / slotsLeft) * 2)));
    const take = 1 + randomInt(maxTake);
    shares.push(take / 100);
    remaining -= take;
  }
  shares.push(remaining / 100);
  return shares;
}

// --- red packets ------------------------------------------------------------

export interface CreatePacketResult {
  packet: RedPacket;
  /** The sender's funding obligation — the caller debits the real balance. */
  escrow: { userId: string; token: RedPacket["token"]; amount: number };
}

export function createPacket(
  senderId: string,
  input: {
    token: RedPacket["token"];
    totalAmount: number;
    slots: number;
    split: PacketSplit;
    message?: string;
  },
): CreatePacketResult {
  const shares = splitAmount(input.totalAmount, input.slots, input.split);

  const now = Date.now();
  const code = newCode();
  const packet: RedPacket = {
    id: "rp_" + randomUUID(),
    code,
    senderId,
    message: input.message ?? "",
    token: input.token,
    totalAmount: input.totalAmount,
    slots: input.slots,
    split: input.split,
    shares,
    claims: [],
    status: "open",
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + GIFTING_LIMITS.packetTtlHours * 3600_000).toISOString(),
    refundedAmount: null,
  };
  state.packets.set(packet.id, packet);
  state.byCode.set(code, packet.id);
  return { packet, escrow: { userId: senderId, token: input.token, amount: input.totalAmount } };
}

export function packetByCode(code: string): RedPacket | undefined {
  const id = state.byCode.get(code.toUpperCase());
  return id ? state.packets.get(id) : undefined;
}

export function getPacket(id: string): RedPacket | undefined {
  return state.packets.get(id);
}

export function listPacketsSent(senderId: string): RedPacket[] {
  return [...state.packets.values()]
    .filter((p) => p.senderId === senderId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function claimedAmount(p: RedPacket): number {
  return round2(p.claims.reduce((s, c) => s + c.amount, 0));
}

export interface ClaimPacketResult {
  packet: RedPacket;
  amount: number;
}

/**
 * Take one slot from a packet.
 *
 * Every refusal here is a way the pot could otherwise be over-drawn: claiming
 * twice, claiming your own packet, claiming after expiry, or claiming a slot
 * that no longer exists.
 */
export function claimPacket(code: string, userId: string, now: Date = new Date()): ClaimPacketResult {
  const packet = packetByCode(code);
  if (!packet) throw new Error("Packet not found");
  if (packet.senderId === userId) throw new Error("You cannot claim your own packet");
  if (packet.status !== "open") throw new Error(`Packet is ${packet.status}`);
  if (Date.parse(packet.expiresAt) <= now.getTime()) throw new Error("Packet has expired");
  if (packet.claims.some((c) => c.userId === userId)) throw new Error("Already claimed");
  if (packet.claims.length >= packet.slots) throw new Error("Packet is empty");

  // Shares were fixed at creation, so a claim just takes the next one. The pot
  // cannot pay out more than was funded because there are exactly `slots`
  // shares and exactly `slots` claims allowed.
  const amount = packet.shares[packet.claims.length];
  packet.claims.push({ userId, amount, claimedAt: now.toISOString() });
  if (packet.claims.length >= packet.slots) packet.status = "emptied";

  return { packet, amount };
}

export interface RefundResult {
  packet: RedPacket;
  refund: { userId: string; token: RedPacket["token"]; amount: number };
}

/**
 * Return the unclaimed remainder of an expired packet to its sender. Safe to
 * run repeatedly — only an open, expired packet with something left refunds.
 */
export function expirePacket(id: string, now: Date = new Date()): RefundResult | null {
  const packet = state.packets.get(id);
  if (!packet || packet.status !== "open") return null;
  if (Date.parse(packet.expiresAt) > now.getTime()) return null;

  const unclaimed = round2(packet.totalAmount - claimedAmount(packet));
  packet.status = unclaimed > 0 ? "refunded" : "expired";
  packet.refundedAmount = unclaimed;
  if (unclaimed <= 0) return null;
  return { packet, refund: { userId: packet.senderId, token: packet.token, amount: unclaimed } };
}

/** Sweep every due packet — the cron entry point. */
export function expireDuePackets(now: Date = new Date()): RefundResult[] {
  const out: RefundResult[] = [];
  for (const p of state.packets.values()) {
    const r = expirePacket(p.id, now);
    if (r) out.push(r);
  }
  return out;
}

/** Public packet view — never leaks the code to someone who was shown the id. */
export function packetView(p: RedPacket, viewerId: string) {
  const mine = p.claims.find((c) => c.userId === viewerId);
  return {
    id: p.id,
    // Only the sender needs the code back; a claimant already had it.
    code: p.senderId === viewerId ? p.code : undefined,
    message: p.message,
    token: p.token,
    totalAmount: p.totalAmount,
    slots: p.slots,
    split: p.split,
    status: p.status,
    createdAt: p.createdAt,
    expiresAt: p.expiresAt,
    claimedCount: p.claims.length,
    claimedAmount: claimedAmount(p),
    remainingSlots: Math.max(0, p.slots - p.claims.length),
    refundedAmount: p.refundedAmount,
    isSender: p.senderId === viewerId,
    myClaim: mine ? { amount: mine.amount, claimedAt: mine.claimedAt } : null,
  };
}

// --- vouchers ---------------------------------------------------------------

export interface CreateVoucherResult {
  voucher: Voucher;
  /** Gift cards are funded by the purchaser; promo coupons are not. */
  escrow: { userId: string; token: Voucher["token"]; amount: number } | null;
}

export function createVoucher(
  purchaserId: string | null,
  input: { kind: Voucher["kind"]; token: Voucher["token"]; amount: number; minSpend?: number },
): CreateVoucherResult {
  const now = Date.now();
  const code = newCode(12);
  const voucher: Voucher = {
    id: "vch_" + randomUUID(),
    code,
    purchaserId,
    kind: input.kind,
    token: input.token,
    amount: input.amount,
    minSpend: input.minSpend ?? 0,
    redeemedBy: null,
    redeemedAt: null,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + GIFTING_LIMITS.voucherTtlDays * 86400_000).toISOString(),
  };
  state.vouchers.set(voucher.id, voucher);
  state.voucherByCode.set(code, voucher.id);

  // A gift card moves the purchaser's money now; a coupon is FurlPay's promo
  // spend and has no purchaser to debit.
  const escrow =
    input.kind === "gift_card" && purchaserId
      ? { userId: purchaserId, token: input.token, amount: input.amount }
      : null;
  return { voucher, escrow };
}

export function voucherByCode(code: string): Voucher | undefined {
  const id = state.voucherByCode.get(code.toUpperCase());
  return id ? state.vouchers.get(id) : undefined;
}

export interface RedeemResult {
  voucher: Voucher;
  creditedAmount: number;
}

/** Redeem a voucher exactly once. */
export function redeemVoucher(code: string, userId: string, now: Date = new Date()): RedeemResult {
  const voucher = voucherByCode(code);
  if (!voucher) throw new Error("Voucher not found");
  if (voucher.redeemedBy) throw new Error("Voucher already redeemed");
  if (Date.parse(voucher.expiresAt) <= now.getTime()) throw new Error("Voucher has expired");
  // Redeeming a gift card you bought yourself just moves your own money in a
  // circle; it is almost always a mistake rather than an intent.
  if (voucher.kind === "gift_card" && voucher.purchaserId === userId) {
    throw new Error("You cannot redeem a gift card you bought");
  }

  voucher.redeemedBy = userId;
  voucher.redeemedAt = now.toISOString();
  return { voucher, creditedAmount: voucher.amount };
}

export function listVouchers(userId: string): Voucher[] {
  return [...state.vouchers.values()]
    .filter((v) => v.purchaserId === userId || v.redeemedBy === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Voucher view — the code reaches the purchaser only, never a third party. */
export function voucherView(v: Voucher, viewerId: string) {
  return {
    id: v.id,
    code: v.purchaserId === viewerId ? v.code : undefined,
    kind: v.kind,
    token: v.token,
    amount: v.amount,
    minSpend: v.minSpend,
    redeemed: Boolean(v.redeemedBy),
    redeemedByMe: v.redeemedBy === viewerId,
    redeemedAt: v.redeemedAt,
    createdAt: v.createdAt,
    expiresAt: v.expiresAt,
  };
}

/** Test seam — the in-memory maps are process-global otherwise. */
export function __resetGiftingForTests(): void {
  state.packets.clear();
  state.byCode.clear();
  state.vouchers.clear();
  state.voucherByCode.clear();
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
