import { describe, expect, it } from "vitest";
import {
  CheckoutSchema,
  IntentSchema,
  MAX_MONEY_AMOUNT,
  MAX_ORDER_QUANTITY,
  OrderSchema,
  TransferSchema,
} from "@/lib/schemas";

describe("public money-input ceilings", () => {
  const transfer = {
    destination: "0x1111111111111111111111111111111111111111",
    token: "USDC",
    chain: "arbitrum",
    signature: "signed",
  } as const;
  const intent = { fromToken: "USDC", toToken: "USDT", fromChain: "base", toChain: "arbitrum" } as const;

  it("accepts the documented request ceilings", () => {
    expect(TransferSchema.safeParse({ ...transfer, amount: MAX_MONEY_AMOUNT }).success).toBe(true);
    expect(IntentSchema.safeParse({ ...intent, amount: MAX_MONEY_AMOUNT, settleWithinSec: 86_400 }).success).toBe(true);
    expect(CheckoutSchema.safeParse({ amount: MAX_MONEY_AMOUNT }).success).toBe(true);
    expect(OrderSchema.safeParse({ symbol: "AAPL", side: "buy", notional: MAX_MONEY_AMOUNT, qty: MAX_ORDER_QUANTITY }).success).toBe(true);
  });

  it("rejects zero, non-finite, and over-ceiling funds requests before route logic", () => {
    for (const amount of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, MAX_MONEY_AMOUNT + 0.01]) {
      expect(TransferSchema.safeParse({ ...transfer, amount }).success).toBe(false);
      expect(IntentSchema.safeParse({ ...intent, amount }).success).toBe(false);
      expect(CheckoutSchema.safeParse({ amount }).success).toBe(false);
      expect(OrderSchema.safeParse({ symbol: "AAPL", side: "buy", notional: amount }).success).toBe(false);
    }
    expect(OrderSchema.safeParse({ symbol: "AAPL", side: "buy", qty: MAX_ORDER_QUANTITY + 1 }).success).toBe(false);
  });
});
