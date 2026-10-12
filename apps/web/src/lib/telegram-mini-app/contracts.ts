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
  /** null = unknown (link storage unavailable); never guessed. */
  telegram: z.object({ linked: z.boolean().nullable() }),
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
    // People paste what they were sent: "/p/abc", "furlpay.com/p/abc" or the
    // full link. The first two are completed to the one origin this accepts;
    // nothing else is rewritten, so "//evil.test/p/abc" is still not a URL on
    // furlpay.com and still fails the origin check below.
    const typed = value.trim();
    const completed = /^\/p\//.test(typed)
      ? `https://furlpay.com${typed}`
      : /^(www\.)?furlpay\.com\//i.test(typed)
        ? `https://${typed}`
        : typed;
    const url = new URL(completed);
    if ((url.origin !== "https://furlpay.com" && url.origin !== "https://www.furlpay.com") || url.username || url.password || url.hash) return null;
    if (!/^\/p\/[A-Za-z0-9_-]{24}$/.test(url.pathname)) return null;
    // The payment ID owns the amount; untrusted query parameters cannot rewrite it.
    return url.pathname;
  } catch { return null; }
}

/**
 * The wallet address in a scanned QR code, or null.
 *
 * Accepts a bare address and the EIP-681 form wallets show ("ethereum:0x…",
 * optionally with "@chainId" and parameters). ONLY the address is taken: a
 * QR code is somebody else's input, and an amount or a chain read from it
 * would be pre-filling a payment on a stranger's say-so. The address still
 * goes through TransferDraftSchema and the review step like a typed one.
 */
export function addressFromQr(text: string): string | null {
  const m = /^(?:ethereum:(?:pay-)?)?(0x[0-9a-fA-F]{40})(?:[@/?].*)?$/.exec(text.trim());
  return m ? m[1] : null;
}

const ACTIVITY_FILTERS = ["all", "card", "transfer", "ramp", "bill"] as const;
export type ActivityFilter = (typeof ACTIVITY_FILTERS)[number];
/** The activity tab a deep link names; anything unknown opens "all". */
export function activityFilter(value: string | null | undefined): ActivityFilter {
  return (ACTIVITY_FILTERS as readonly string[]).includes(value ?? "") ? (value as ActivityFilter) : "all";
}

export const activityStatus = { settled: "Recorded", pending: "Pending", escrow: "In escrow", declined: "Declined" } as const;
