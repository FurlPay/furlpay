import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/authz";
import { cardIssuingLive } from "@/lib/cardIssuer";
import { MiniAccountSchema } from "@/lib/telegram-mini-app/contracts";
import { privateHeaders, telegramLinkFor } from "@/lib/telegram-mini-app/auth";

export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const { user, tokenBalances, transactions, cards } = auth.account;
  const cardsLive = cardIssuingLive();
  // Whether THIS account has a Telegram link (the Telegram id itself is not returned).
  let telegramLinked: boolean | null = null;
  try { telegramLinked = (await telegramLinkFor(user.id)) !== null; } catch { telegramLinked = null; }
  // Whitelist a narrow mobile view of the SAME authorized account. No placeholder deposit address,
  // full profile, PAN, security object, simulated cards or fabricated blockchain receipt.
  const data = MiniAccountSchema.safeParse({
    profile: { name: user.name, verification: user.kycStatus },
    wallet: {
      kind: "internal_ledger",
      balances: tokenBalances.map(b => ({ asset: b.token, chain: b.chain, amount: b.amount, usdValue: b.usdValue })),
      connectedAddress: user.linkedWallet?.address ?? null,
    },
    cards: cardsLive ? cards.filter(c => c.providerCardRef).map(c => ({ id: c.id, label: c.label, last4: c.last4, network: c.network, frozen: c.frozen, dailyLimit: c.limits.daily })) : [],
    activity: transactions.slice().sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 200).map(t => ({ id: t.id, title: t.title, category: t.category, amountUsd: t.amountUsd, direction: t.direction, timestamp: t.timestamp, status: t.status, asset: t.token ?? null, chain: t.chain ?? null })),
    capabilities: { cards: cardsLive, transfers: false },
    telegram: { linked: telegramLinked },
  });
  if (!data.success) return NextResponse.json({ error: "Your account data could not be loaded. Please try again." }, { status: 503, headers: privateHeaders });
  return NextResponse.json(data.data, { headers: privateHeaders });
}
