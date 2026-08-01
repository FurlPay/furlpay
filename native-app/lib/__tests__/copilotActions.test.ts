import { resolveConfirmation, type Confirmation } from "../copilotActions";

// The security rule under test: AI output may propose an action, but it must
// never define arbitrary executable authority. Only registry-listed
// action/endpoint/method/schema combinations may execute.

const VALID_TRANSFER: Confirmation = {
  action: "send_payment",
  method: "POST",
  endpoint: "/api/payments/create",
  body: { amount: 50, recipient: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", sourceChain: "arbitrum" },
  summary: "Send $50 USDC",
  amountUsd: 50,
};

describe("resolveConfirmation — allowlist", () => {
  it("accepts a well-formed known action and rebuilds the request from the registry", () => {
    const r = resolveConfirmation(VALID_TRANSFER);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.endpoint).toBe("/payments/create"); // registry value, /api stripped
    expect(r.method).toBe("POST");
    expect(r.body).toEqual(VALID_TRANSFER.body);
    expect(r.details.map((d) => d.label)).toEqual(["Amount", "Recipient", "Chain"]);
  });

  it("rejects an unknown action id", () => {
    const r = resolveConfirmation({ ...VALID_TRANSFER, action: "drain_wallet" });
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/unknown/i) });
  });

  it("rejects a missing action id", () => {
    const r = resolveConfirmation({ ...VALID_TRANSFER, action: undefined });
    expect(r.ok).toBe(false);
  });

  it("rejects a summary/endpoint mismatch — innocent summary cannot smuggle a mutating endpoint", () => {
    // The attack from the audit: "Check balance" summary, transfer endpoint,
    // under a NON-transfer action id.
    const spoofed: Confirmation = {
      action: "create_support_ticket",
      method: "POST",
      endpoint: "/api/payments/create", // != registry endpoint for this action
      body: { amount: 9999, recipient: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", sourceChain: "arbitrum" },
      summary: "Check balance",
    };
    const r = resolveConfirmation(spoofed);
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/endpoint mismatch/i) });
  });

  it("rejects a wrong method", () => {
    const r = resolveConfirmation({ ...VALID_TRANSFER, method: "DELETE" });
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/method mismatch/i) });
  });

  it("rejects a schema mismatch — missing required field", () => {
    const r = resolveConfirmation({
      ...VALID_TRANSFER,
      body: { amount: 50, sourceChain: "arbitrum" }, // no recipient
    });
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/missing "recipient"/i) });
  });

  it("rejects a schema mismatch — wrong type", () => {
    const r = resolveConfirmation({
      ...VALID_TRANSFER,
      body: { ...VALID_TRANSFER.body, amount: "50" }, // string, not number
    });
    expect(r.ok).toBe(false);
  });

  it("rejects an invalid recipient address", () => {
    const r = resolveConfirmation({
      ...VALID_TRANSFER,
      body: { ...VALID_TRANSFER.body, recipient: "not-an-address" },
    });
    expect(r.ok).toBe(false);
  });

  it("rejects non-finite and out-of-range amounts", () => {
    for (const amount of [NaN, Infinity, -5, 0, 25_001]) {
      const r = resolveConfirmation({ ...VALID_TRANSFER, body: { ...VALID_TRANSFER.body, amount } });
      expect(r.ok).toBe(false);
    }
  });

  it("drops extra keys the server sent — they never reach the request", () => {
    const r = resolveConfirmation({
      ...VALID_TRANSFER,
      body: { ...VALID_TRANSFER.body, adminOverride: true, note: "x" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.body).not.toHaveProperty("adminOverride");
    expect(r.body).not.toHaveProperty("note");
  });

  it("rejects a malformed body", () => {
    for (const body of [undefined, null, [], "x"] as unknown[]) {
      const r = resolveConfirmation({ ...VALID_TRANSFER, body: body as never });
      expect(r.ok).toBe(false);
    }
  });

  it("accepts every action shape the server co-pilot actually emits", () => {
    const real: Confirmation[] = [
      {
        action: "card_control",
        method: "POST",
        endpoint: "/api/cards/settings",
        body: { cardId: "card_1", freeze: true },
        summary: "Freeze card",
      },
      {
        action: "earn_deposit",
        method: "POST",
        endpoint: "/api/earn/deposit",
        body: { token: "USDC", amountUsd: 1200 },
        summary: "Deposit",
      },
      {
        action: "schedule_dca",
        method: "POST",
        endpoint: "/api/investing/schedule",
        body: { symbol: "AAPL", side: "buy", notional: 50, cadence: "week" },
        summary: "DCA",
      },
      {
        action: "place_order",
        method: "POST",
        endpoint: "/api/investing/order",
        body: { symbol: "TSLA", side: "buy", notional: 100 },
        summary: "Order",
      },
      {
        action: "execute_swap",
        method: "POST",
        endpoint: "/api/swaps",
        body: {
          quoteId: "3f1a2b4c-5d6e-4f70-8a91-b2c3d4e5f607",
          fromToken: "USDC",
          toToken: "EURC",
          amountIn: 100,
        },
        summary: "Swap",
      },
      {
        action: "create_support_ticket",
        method: "POST",
        endpoint: "/api/support/tickets",
        body: { category: "other", subject: "Help me", body: "Something broke here" },
        summary: "Ticket",
      },
    ];
    for (const c of real) {
      expect(resolveConfirmation(c).ok).toBe(true);
    }
  });

  // --- the swap settle discriminator ------------------------------------

  it("injects execute:true on a swap, so it settles instead of re-quoting", () => {
    const r = resolveConfirmation({
      action: "execute_swap",
      method: "POST",
      endpoint: "/api/swaps",
      body: { quoteId: "3f1a2b4c-5d6e-4f70-8a91-b2c3d4e5f607" },
      summary: "Swap",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Without this the request takes the quote branch of /api/swaps and nothing
    // moves, which is what the previous registry did.
    expect(r.body.execute).toBe(true);
    expect(r.body.quoteId).toBe("3f1a2b4c-5d6e-4f70-8a91-b2c3d4e5f607");
  });

  it("will not let a payload override a registry constant", () => {
    const r = resolveConfirmation({
      action: "execute_swap",
      method: "POST",
      endpoint: "/api/swaps",
      // A model asking for the quote branch on a settle action.
      body: { quoteId: "3f1a2b4c-5d6e-4f70-8a91-b2c3d4e5f607", execute: false },
      summary: "Swap",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.body.execute).toBe(true);
  });

  it("rejects a swap with no quote id — there is nothing to settle", () => {
    const r = resolveConfirmation({
      action: "execute_swap",
      method: "POST",
      endpoint: "/api/swaps",
      body: { fromToken: "USDC", toToken: "EURC", amountIn: 100 },
      summary: "Swap",
    });
    expect(r.ok).toBe(false);
  });

  it("rejects a quote id that is not a uuid", () => {
    const r = resolveConfirmation({
      action: "execute_swap",
      method: "POST",
      endpoint: "/api/swaps",
      body: { quoteId: "../../admin" },
      summary: "Swap",
    });
    expect(r.ok).toBe(false);
  });

  it("rejects a support body under the server's 10-character minimum", () => {
    const r = resolveConfirmation({
      action: "create_support_ticket",
      method: "POST",
      endpoint: "/api/support/tickets",
      body: { category: "other", subject: "Help me", body: "broke" },
      summary: "Ticket",
    });
    expect(r.ok).toBe(false);
  });
});
