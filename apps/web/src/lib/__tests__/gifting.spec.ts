import { describe, it, expect, beforeEach } from "vitest";
import {
  __resetGiftingForTests,
  splitAmount,
  createPacket,
  claimPacket,
  packetByCode,
  getPacket,
  claimedAmount,
  expirePacket,
  expireDuePackets,
  packetView,
  listPacketsSent,
  createVoucher,
  redeemVoucher,
  voucherByCode,
  voucherView,
  listVouchers,
  GIFTING_LIMITS,
} from "@/lib/services/gifting";

// A red packet is a conservation problem: the parts must sum to the whole,
// exactly, and the pot must never pay out more than was funded no matter how
// many people race at it. These specs pin that.

const SENDER = "user-sender";
const A = "user-a";
const B = "user-b";
const C = "user-c";

function packet(total = 100, slots = 3, split: "equal" | "random" = "equal") {
  return createPacket(SENDER, { token: "USDC", totalAmount: total, slots, split });
}

beforeEach(() => {
  __resetGiftingForTests();
});

describe("splitting", () => {
  it("splits evenly when it divides cleanly", () => {
    expect(splitAmount(90, 3, "equal")).toEqual([30, 30, 30]);
  });

  it("spreads the remainder a cent at a time rather than dumping it", () => {
    const shares = splitAmount(10, 3, "equal");
    expect(shares).toEqual([3.34, 3.33, 3.33]);
    expect(sum(shares)).toBe(10);
  });

  it("always sums to the total, for every shape", () => {
    for (const total of [1, 10, 33.33, 99.99, 1000, 7777.77]) {
      for (const slots of [1, 2, 3, 7, 13, 50]) {
        for (const mode of ["equal", "random"] as const) {
          const shares = splitAmount(total, slots, mode);
          expect(shares).toHaveLength(slots);
          expect(sum(shares), `${total}/${slots}/${mode}`).toBe(total);
        }
      }
    }
  });

  it("never produces a zero or negative share in a random split", () => {
    for (let i = 0; i < 200; i++) {
      const shares = splitAmount(50, 20, "random");
      expect(Math.min(...shares)).toBeGreaterThan(0);
      expect(sum(shares)).toBe(50);
    }
  });

  it("refuses to split into more slots than there are cents", () => {
    expect(() => splitAmount(0.05, 10, "equal")).toThrow(/too small/);
  });
});

describe("red packets", () => {
  it("funds the whole amount at creation", () => {
    const { packet: p, escrow } = packet(100, 3);
    expect(escrow).toEqual({ userId: SENDER, token: "USDC", amount: 100 });
    expect(p.status).toBe("open");
    expect(sum(p.shares)).toBe(100);
  });

  it("hands out one share per claim and empties exactly", () => {
    const { packet: p } = packet(90, 3);
    expect(claimPacket(p.code, A).amount).toBe(30);
    expect(claimPacket(p.code, B).amount).toBe(30);
    expect(claimPacket(p.code, C).amount).toBe(30);

    expect(getPacket(p.id)!.status).toBe("emptied");
    expect(claimedAmount(getPacket(p.id)!)).toBe(90);
  });

  it("never pays out more than was funded", () => {
    const { packet: p } = packet(100, 2);
    claimPacket(p.code, A);
    claimPacket(p.code, B);
    expect(() => claimPacket(p.code, C)).toThrow(/empty|emptied/);
    expect(claimedAmount(getPacket(p.id)!)).toBe(100);
  });

  it("refuses a second claim from the same person", () => {
    const { packet: p } = packet(100, 3);
    claimPacket(p.code, A);
    expect(() => claimPacket(p.code, A)).toThrow(/Already claimed/);
    expect(getPacket(p.id)!.claims).toHaveLength(1);
  });

  it("refuses the sender claiming their own packet", () => {
    const { packet: p } = packet();
    expect(() => claimPacket(p.code, SENDER)).toThrow(/your own packet/);
  });

  it("refuses an unknown code", () => {
    expect(() => claimPacket("ZZZZZZZZZZ", A)).toThrow(/not found/);
  });

  it("refuses a claim after expiry", () => {
    const { packet: p } = packet();
    const later = new Date(Date.now() + (GIFTING_LIMITS.packetTtlHours + 1) * 3600_000);
    expect(() => claimPacket(p.code, A, later)).toThrow(/expired/);
  });

  it("looks up case-insensitively", () => {
    const { packet: p } = packet();
    expect(packetByCode(p.code.toLowerCase())?.id).toBe(p.id);
  });
});

describe("expiry and refund", () => {
  it("returns exactly the unclaimed remainder to the sender", () => {
    const { packet: p } = packet(90, 3);
    claimPacket(p.code, A); // 30

    const later = new Date(Date.now() + (GIFTING_LIMITS.packetTtlHours + 1) * 3600_000);
    const result = expirePacket(p.id, later);
    expect(result!.refund).toEqual({ userId: SENDER, token: "USDC", amount: 60 });
    expect(getPacket(p.id)!.status).toBe("refunded");
  });

  it("refunds nothing for a fully claimed packet", () => {
    const { packet: p } = packet(90, 3);
    claimPacket(p.code, A);
    claimPacket(p.code, B);
    claimPacket(p.code, C);
    const later = new Date(Date.now() + (GIFTING_LIMITS.packetTtlHours + 1) * 3600_000);
    expect(expirePacket(p.id, later)).toBeNull();
  });

  it("does nothing before expiry", () => {
    const { packet: p } = packet();
    expect(expirePacket(p.id, new Date())).toBeNull();
    expect(getPacket(p.id)!.status).toBe("open");
  });

  it("is safe to sweep repeatedly", () => {
    packet(90, 3);
    const later = new Date(Date.now() + (GIFTING_LIMITS.packetTtlHours + 1) * 3600_000);
    expect(expireDuePackets(later)).toHaveLength(1);
    expect(expireDuePackets(later)).toHaveLength(0);
  });
});

describe("packet visibility", () => {
  it("returns the code to the sender and to nobody else", () => {
    const { packet: p } = packet();
    claimPacket(p.code, A);
    expect(packetView(p, SENDER).code).toBe(p.code);
    expect(packetView(p, A).code).toBeUndefined();
  });

  it("shows a claimant their own share only", () => {
    const { packet: p } = packet(90, 3);
    claimPacket(p.code, A);
    claimPacket(p.code, B);
    const view = packetView(p, A);
    expect(view.myClaim?.amount).toBe(30);
    expect(view.claimedCount).toBe(2);
    // No per-claimant breakdown of who got what.
    expect(JSON.stringify(view)).not.toContain(B);
  });

  it("lists a sender's own packets", () => {
    packet();
    packet();
    expect(listPacketsSent(SENDER)).toHaveLength(2);
    expect(listPacketsSent(A)).toHaveLength(0);
  });
});

describe("vouchers", () => {
  it("funds a gift card from the purchaser but never a coupon", () => {
    const card = createVoucher(SENDER, { kind: "gift_card", token: "USDC", amount: 50 });
    expect(card.escrow).toEqual({ userId: SENDER, token: "USDC", amount: 50 });

    const coupon = createVoucher(null, { kind: "coupon", token: "USDC", amount: 5 });
    expect(coupon.escrow).toBeNull();
  });

  it("redeems exactly once", () => {
    const { voucher } = createVoucher(SENDER, { kind: "gift_card", token: "USDC", amount: 50 });
    expect(redeemVoucher(voucher.code, A).creditedAmount).toBe(50);
    expect(() => redeemVoucher(voucher.code, B)).toThrow(/already redeemed/);
  });

  it("refuses the purchaser redeeming their own gift card", () => {
    const { voucher } = createVoucher(SENDER, { kind: "gift_card", token: "USDC", amount: 50 });
    expect(() => redeemVoucher(voucher.code, SENDER)).toThrow(/cannot redeem a gift card you bought/);
  });

  it("refuses an expired voucher", () => {
    const { voucher } = createVoucher(SENDER, { kind: "gift_card", token: "USDC", amount: 50 });
    const later = new Date(Date.now() + (GIFTING_LIMITS.voucherTtlDays + 1) * 86400_000);
    expect(() => redeemVoucher(voucher.code, A, later)).toThrow(/expired/);
  });

  it("gives the code to the purchaser only", () => {
    const { voucher } = createVoucher(SENDER, { kind: "gift_card", token: "USDC", amount: 50 });
    redeemVoucher(voucher.code, A);
    expect(voucherView(voucher, SENDER).code).toBe(voucher.code);
    expect(voucherView(voucher, A).code).toBeUndefined();
  });

  it("lists a voucher for both its buyer and its redeemer", () => {
    const { voucher } = createVoucher(SENDER, { kind: "gift_card", token: "USDC", amount: 50 });
    redeemVoucher(voucher.code, A);
    expect(listVouchers(SENDER)).toHaveLength(1);
    expect(listVouchers(A)).toHaveLength(1);
    expect(listVouchers(B)).toHaveLength(0);
  });

  it("looks up case-insensitively", () => {
    const { voucher } = createVoucher(SENDER, { kind: "gift_card", token: "USDC", amount: 50 });
    expect(voucherByCode(voucher.code.toLowerCase())?.id).toBe(voucher.id);
  });
});

/** Sum in cents so the assertion is not itself a float-rounding test. */
function sum(xs: number[]): number {
  return Math.round(xs.reduce((s, x) => s + Math.round(x * 100), 0)) / 100;
}
