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

// ---------------------------------------------------------------------------
// Risk classification of AI-proposed actions.
//
// The co-pilot registry permits transfers up to $25,000. Before every action
// carried a `risk` classification, this path authenticated with
// confirmWithBiometrics — which returns TRUE when the user has switched
// biometric approvals off or has none enrolled. On such a device an
// AI-proposed transfer executed with no authentication at all.
//
// These tests pin the classification so a new action cannot be added without
// deciding how it is authenticated.
// ---------------------------------------------------------------------------
describe("every co-pilot action is risk-classified", () => {
  const { RISK } = require("../security/riskPolicy");
  const src = require("fs").readFileSync(
    require("path").join(__dirname, "..", "copilotActions.ts"),
    "utf8"
  );

  /** [actionId, riskAction] for every entry in the registry. */
  const entries: [string, string][] = [
    ...src.matchAll(/id: "(\w+)",\s*\n\s*risk: "(\w+)"/g),
  ].map((m: RegExpMatchArray) => [m[1], m[2]] as [string, string]);

  it("finds every registry entry", () => {
    // If the registry grows and this count does not, the regex has drifted and
    // the rest of these assertions are silently checking nothing.
    const ids = [...src.matchAll(/^\s{4}id: "(\w+)",$/gm)].map((m: RegExpMatchArray) => m[1]);
    expect(entries.length).toBe(ids.length);
    expect(entries.length).toBeGreaterThanOrEqual(7);
  });

  it("classifies every action with a risk action the policy knows", () => {
    for (const [id, risk] of entries) {
      expect(RISK[risk]).toBeDefined();
      expect(`${id}:${RISK[risk]}`).toMatch(/:(low|medium|high)$/);
    }
  });

  it("classifies every money-moving action as high risk", () => {
    const moneyMoving = ["earn_deposit", "schedule_dca", "place_order", "execute_swap", "send_payment"];
    for (const id of moneyMoving) {
      const found = entries.find(([e]) => e === id);
      expect(found).toBeDefined();
      expect(RISK[found![1]]).toBe("high");
    }
  });

  it("does not gate a support ticket as if it moved money", () => {
    const ticket = entries.find(([e]) => e === "create_support_ticket");
    expect(RISK[ticket![1]]).not.toBe("high");
  });
});

describe("the AI execution path authenticates centrally", () => {
  const rawChat = require("fs").readFileSync(
    require("path").join(__dirname, "..", "..", "app", "chat.tsx"),
    "utf8"
  );
  // Strip comments before asserting on CODE — the same convention outbox.test.ts
  // uses. Without it, a comment merely NAMING the old bypassable helper would
  // fail the assertion that the helper is no longer called.
  const chat: string = rawChat
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("uses the shared authorization boundary, not the bypassable biometric gate", () => {
    // Same function manual Send and Swap call, so the AI has no privileged
    // path around the risk engine or authentication.
    expect(chat).toContain("authorizeMoneyMove");
    // confirmWithBiometrics returns true when biometrics are off/unenrolled.
    expect(chat).not.toContain("confirmWithBiometrics");
  });

  it("keys authentication off the REGISTRY's risk, not the model's payload", () => {
    // A model-supplied risk level would be self-authorization.
    expect(chat).toContain("resolved.spec.risk");
  });

  it("surfaces the boundary's refusal message rather than inventing its own", () => {
    // The no-screen-lock case is handled once, inside authorizeMoneyMove, so
    // Send, Swap and the co-pilot all say the same thing and none of them can
    // forget the case. The screen just renders `auth.message`.
    expect(chat).toContain("auth.message");
    const authorize = require("fs").readFileSync(
      require("path").join(__dirname, "..", "money", "authorize.ts"),
      "utf8"
    );
    expect(authorize).toContain("no_device_lock");
    expect(authorize).toMatch(/screen lock/i);
  });

  it("authenticates BEFORE the request is sent", () => {
    const authAt = chat.indexOf("authorizeMoneyMove");
    const sendAt = chat.indexOf("await api(resolved.endpoint");
    expect(authAt).toBeGreaterThan(-1);
    expect(sendAt).toBeGreaterThan(-1);
    expect(authAt).toBeLessThan(sendAt);
  });
});


// ---------------------------------------------------------------------------
// The AI shares the manual money path.
// ---------------------------------------------------------------------------
describe("AI money actions take the same path as manual Send", () => {
  const fs = require("fs");
  const path = require("path");
  const strip = (x: string) =>
    x.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const read = (...p: string[]) => strip(fs.readFileSync(path.join(__dirname, "..", ...p), "utf8"));

  const chat = strip(fs.readFileSync(path.join(__dirname, "..", "..", "app", "chat.tsx"), "utf8"));
  const send = read("send", "useSend.ts");
  const swap = read("swap", "useSwap.ts");

  it("all three call the identical authorization function", () => {
    for (const src of [chat, send, swap]) expect(src).toContain("authorizeMoneyMove");
  });

  it("none of them retains the bypassable biometric gate", () => {
    for (const src of [chat, send, swap]) expect(src).not.toContain("confirmWithBiometrics");
  });

  it("the AI amount comes from the VALIDATED body, not the model's own claim", () => {
    // `Confirmation.amountUsd` is unvalidated free-form from the server/model
    // and could understate the amount to dodge a risk threshold.
    expect(chat).toContain("resolved.amountUsd");
    expect(chat).not.toMatch(/amountUsd:\s*c\.amountUsd/);
  });

  it("the resolver derives amountUsd from a usd-marked validated field", () => {
    const actions = read("copilotActions.ts");
    expect(actions).toMatch(/if \(field\.usd && field\.type === "number"\) amountUsd = value/);
  });

  it("the AI cannot declare its own risk level", () => {
    // The classification is looked up from the registry by action id.
    expect(chat).toContain("resolved.spec.risk");
    expect(chat).not.toMatch(/action:\s*c\.(risk|action)/);
  });
});
