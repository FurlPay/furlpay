import { isOrderLive, timeRemainingMs, whoseTurn, type P2POrder } from "../types";
import { rankOrders } from "@/app/p2p/orders";

// ---------------------------------------------------------------------------
// The two pieces of P2P logic that live on the client, both of which decide
// what a user is shown about a trade with someone else's money in it.
//
// `whoseTurn` is the question the order screen exists to answer. Getting it
// backwards tells a buyer who has already paid that they still owe money, or
// tells a seller to release before payment has been claimed.
//
// `rankOrders` decides what a user sees first. An order with an expiring
// payment window buried under last week's settled trades is a cancelled order
// and, often, a dispute.
// ---------------------------------------------------------------------------

function order(over: Partial<P2POrder> = {}): P2POrder {
  return {
    id: "o1",
    sn: "P2P-1",
    adId: "a1",
    takerSide: "buy",
    asset: "USDT",
    fiat: "INR",
    price: 90,
    amount: 100,
    fiatAmount: 9000,
    status: "pending_payment",
    createdAt: new Date("2026-01-01T00:00:00Z").toISOString(),
    expiresAt: new Date("2026-01-01T00:15:00Z").toISOString(),
    role: "buyer",
    ...over,
  };
}

describe("whoseTurn", () => {
  it("puts the buyer on the hook before payment", () => {
    expect(whoseTurn(order({ status: "pending_payment", role: "buyer" }))).toBe("you");
    expect(whoseTurn(order({ status: "pending_payment", role: "seller" }))).toBe("them");
  });

  // The inversion. After payment is claimed the SELLER must act.
  it("switches to the seller once payment is claimed", () => {
    expect(whoseTurn(order({ status: "paid", role: "seller" }))).toBe("you");
    expect(whoseTurn(order({ status: "paid", role: "buyer" }))).toBe("them");
  });

  // An operator holds the escrow during an appeal. Telling either party it is
  // their turn would be false, and would invite them to keep trying actions
  // the server will refuse.
  it("says nobody during an appeal", () => {
    expect(whoseTurn(order({ status: "appealed", role: "buyer" }))).toBe("nobody");
    expect(whoseTurn(order({ status: "appealed", role: "seller" }))).toBe("nobody");
  });

  it("says nobody once settled", () => {
    for (const status of ["released", "cancelled"] as const) {
      expect(whoseTurn(order({ status, role: "buyer" }))).toBe("nobody");
      expect(whoseTurn(order({ status, role: "seller" }))).toBe("nobody");
    }
  });
});

describe("isOrderLive", () => {
  // Drives whether the detail screen polls. A settled order polled forever is
  // battery spent on a question with a known answer.
  it("is true only while the order can still move", () => {
    expect(isOrderLive("pending_payment")).toBe(true);
    expect(isOrderLive("paid")).toBe(true);
    expect(isOrderLive("appealed")).toBe(true);
    expect(isOrderLive("released")).toBe(false);
    expect(isOrderLive("cancelled")).toBe(false);
  });
});

describe("timeRemainingMs", () => {
  it("counts down to the payment deadline", () => {
    const now = Date.parse("2026-01-01T00:05:00Z");
    expect(timeRemainingMs(order(), now)).toBe(10 * 60_000);
  });

  it("goes negative once the window has passed", () => {
    const now = Date.parse("2026-01-01T00:20:00Z");
    expect(timeRemainingMs(order(), now)).toBeLessThan(0);
  });
});

describe("rankOrders", () => {
  it("puts orders needing the user first", () => {
    const mine = order({ id: "mine", status: "pending_payment", role: "buyer" });
    const theirs = order({ id: "theirs", status: "pending_payment", role: "seller" });
    const done = order({ id: "done", status: "released", role: "buyer" });

    expect(rankOrders([done, theirs, mine]).map((o) => o.id)).toEqual(["mine", "theirs", "done"]);
  });

  it("keeps live orders above settled ones", () => {
    const live = order({ id: "live", status: "paid", role: "buyer" });
    const settled = order({ id: "settled", status: "released", role: "buyer" });
    expect(rankOrders([settled, live]).map((o) => o.id)).toEqual(["live", "settled"]);
  });

  it("sorts by recency within a group", () => {
    const older = order({
      id: "older",
      status: "released",
      createdAt: new Date("2026-01-01T00:00:00Z").toISOString(),
    });
    const newer = order({
      id: "newer",
      status: "released",
      createdAt: new Date("2026-02-01T00:00:00Z").toISOString(),
    });
    expect(rankOrders([older, newer]).map((o) => o.id)).toEqual(["newer", "older"]);
  });

  it("does not mutate its input", () => {
    const input = [order({ id: "a", status: "released" }), order({ id: "b", status: "paid", role: "seller" })];
    const copy = [...input];
    rankOrders(input);
    expect(input).toEqual(copy);
  });

  it("handles an empty list", () => {
    expect(rankOrders([])).toEqual([]);
  });
});
