import { describe, it, expect } from "vitest";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Regression: POST /api/cards/spend used to destructure { cardId, amountUsd, … }
// straight out of req.json() with no validation, then run
//     card.limits.dailySpent += amountUsd
// on the authenticated user's own card. A negative amountUsd therefore SUBTRACTED
// from the daily-spend counter, minting unlimited daily headroom, and wrote a
// negative-amount row into transaction history. NaN corrupted the counter
// permanently (NaN poisons every later comparison).
//
// This pins the schema that closes it. Kept in lockstep with SpendSchema in
// src/app/api/cards/spend/route.ts.
// ---------------------------------------------------------------------------

const SpendSchema = z.object({
  cardId: z.string().min(1).max(64),
  amountUsd: z.number().positive().max(1_000_000),
  merchant: z.string().max(200).optional(),
  mcc: z.string().max(8).optional(),
  destinationAddress: z.string().max(128).optional(),
});

describe("card spend body validation", () => {
  it("accepts a well-formed authorization", () => {
    const parsed = SpendSchema.safeParse({
      cardId: "card_virtual_1",
      amountUsd: 42.5,
      merchant: "Blue Bottle Coffee",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a negative amount (the daily-limit bypass)", () => {
    const parsed = SpendSchema.safeParse({ cardId: "card_virtual_1", amountUsd: -100_000 });
    expect(parsed.success).toBe(false);
  });

  it("rejects a zero amount", () => {
    const parsed = SpendSchema.safeParse({ cardId: "card_virtual_1", amountUsd: 0 });
    expect(parsed.success).toBe(false);
  });

  it("rejects NaN, which would poison dailySpent irrecoverably", () => {
    const parsed = SpendSchema.safeParse({ cardId: "card_virtual_1", amountUsd: Number.NaN });
    expect(parsed.success).toBe(false);
  });

  it("rejects a non-numeric amount", () => {
    const parsed = SpendSchema.safeParse({ cardId: "card_virtual_1", amountUsd: "100" });
    expect(parsed.success).toBe(false);
  });

  it("bounds absurdly large authorizations", () => {
    const parsed = SpendSchema.safeParse({ cardId: "card_virtual_1", amountUsd: 5_000_000 });
    expect(parsed.success).toBe(false);
  });

  it("requires a card id", () => {
    expect(SpendSchema.safeParse({ cardId: "", amountUsd: 10 }).success).toBe(false);
    expect(SpendSchema.safeParse({ amountUsd: 10 }).success).toBe(false);
  });
});
