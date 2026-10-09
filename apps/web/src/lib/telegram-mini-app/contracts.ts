import { z } from "zod";

export const MiniAccountSchema = z.object({
  profile: z.object({ name: z.string(), verification: z.enum(["verified", "pending", "unverified"]) }),
  wallet: z.object({
    kind: z.literal("internal_ledger"),
    balances: z.array(z.object({ asset: z.string(), chain: z.string(), amount: z.number().finite().nonnegative(), usdValue: z.number().finite().nonnegative() })),
    connectedAddress: z.string().nullable(),
  }),
  cards: z.array(z.object({ id: z.string(), label: z.string(), last4: z.string().regex(/^\d{4}$/), network: z.enum(["Visa", "Mastercard"]), frozen: z.boolean(), dailyLimit: z.number() })),
  activity: z.array(z.object({ id: z.string(), title: z.string(), category: z.string(), amountUsd: z.number().finite(), direction: z.enum(["in", "out"]), timestamp: z.string(), status: z.enum(["settled", "pending", "escrow", "declined"]), asset: z.string().nullable(), chain: z.string().nullable() })),
  capabilities: z.object({ cards: z.boolean(), transfers: z.literal(false) }),
});
export type MiniAccount = z.infer<typeof MiniAccountSchema>;

export const TransferDraftSchema = z.object({
  destination: z.string().trim().regex(/^0x[0-9a-fA-F]{40}$/, "Enter a valid EVM wallet address (0x followed by 40 characters)."),
  amount: z.string().regex(/^\d+(\.\d{1,6})?$/, "Use up to 6 decimal places.").refine(v => Number(v) > 0 && Number(v) <= 1_000_000, "Enter an amount between 0 and 1,000,000 USDC."),
  chain: z.enum(["arbitrum", "base", "ethereum"]),
});
export type TransferDraft = z.infer<typeof TransferDraftSchema>;

/** Only FurlPay's existing hosted merchant checkout. No arbitrary redirects or script URLs. */
export function checkoutPath(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.origin !== "https://furlpay.com" || url.username || url.password || url.hash) return null;
    if (!/^\/p\/[A-Za-z0-9_-]{24}$/.test(url.pathname)) return null;
    // The payment ID owns the amount; untrusted query parameters cannot rewrite it.
    return url.pathname;
  } catch { return null; }
}

export const activityStatus = { settled: "Recorded", pending: "Pending", escrow: "In escrow", declined: "Declined" } as const;
