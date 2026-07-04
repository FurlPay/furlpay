// FurlPay Travels gift cards — in-memory demo store.
// Codes never expire; redeemable for travel credit. A live build persists these
// and settles the purchase via the FurlPay API.

export interface GiftCard {
  code: string;
  amountUsd: number;
  recipientEmail?: string;
  message?: string;
  createdAt: string;
  redeemed: boolean;
}

// Shared across route bundles in the same process (see store.ts note).
const cards: Map<string, GiftCard> = ((globalThis as any).__furlpayGiftCards ??= new Map<string, GiftCard>());

function genCode(): string {
  const part = () => Math.random().toString(36).slice(2, 6).toUpperCase();
  return `FURL-${part()}-${part()}-${part()}`;
}

export function issueGiftCard(amountUsd: number, recipientEmail?: string, message?: string): GiftCard {
  let code = genCode();
  while (cards.has(code)) code = genCode();
  const card: GiftCard = {
    code,
    amountUsd,
    recipientEmail,
    message,
    createdAt: new Date().toISOString(),
    redeemed: false,
  };
  cards.set(code, card);
  return card;
}

export function redeemGiftCard(code: string): { ok: true; amountUsd: number } | { ok: false; error: string } {
  if (!/^FURL-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) {
    return { ok: false, error: "Invalid gift card code format." };
  }
  const card = cards.get(code);
  // Demo: unknown-but-well-formed codes are treated as a valid $50 sample card.
  if (!card) {
    return { ok: true, amountUsd: 50 };
  }
  if (card.redeemed) return { ok: false, error: "This gift card has already been redeemed." };
  card.redeemed = true;
  return { ok: true, amountUsd: card.amountUsd };
}
