import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { requireUser } from "@/lib/authz";
import { getQuotes, resolveQuote } from "@/lib/markets/quotes";
import { bySymbol } from "@/lib/markets/catalog";
import { flagState } from "@/lib/flags";
import { readBalances, type BalanceResult } from "@/lib/onchain/balances";
import { registryAudit, tradableTokens, type StockTokenEntry } from "@/lib/onchain/stockTokenRegistry";

export const dynamic = "force-dynamic";

// GET /api/investing/rwa — tokenized real-world-asset (RWA) equity positions
// held on-chain, unified with the user's traditional brokerage holdings.
//
// WHAT CHANGED, AND WHY IT MATTERED. This route used to return a constant:
//
//     const TOKENIZED = [
//       { symbol: "NVDA", token: "bNVDA", shares: 1.5, ... },
//       { symbol: "AAPL", token: "bAAPL", shares: 3.0, ... },
//     ];
//
// The same 1.5 bNVDA for every user who asked, marked to a real live price and
// summed into a real "total equity value". That is the most dangerous shape a
// placeholder can take: it is not obviously fake, it is per-user-looking, and
// every number around it is genuine, so the fabricated one inherits their
// credibility. Someone reading it had no way to know their tokenized position
// was a literal.
//
// It now reads the chain. Positions come from `readBalances` against the user's
// LINKED wallet, scoped to registry entries a person has verified. That means
// the route returns fewer positions than it used to — usually none, until the
// registry is verified and a wallet is linked — and every one it does return is
// a balance that exists on a public ledger anyone can check.
//
// THREE OUTCOMES, KEPT DISTINCT. "You hold nothing", "we could not read the
// chain" and "this capability is off" are different facts about someone's
// money, and the response models all three rather than flattening them into an
// empty array. An RPC timeout rendering as a zero position would tell a user
// their holdings had vanished.
//
// LEGAL BOUNDARY, unchanged: READ-ONLY. FurlPay displays tokenized positions
// the user holds in their own wallet; it does not custody them and does not
// place orders. There is deliberately no POST here — see docs/API-V1-SURFACE.md.

interface TokenizedPosition {
  symbol: string;
  token: string;
  issuer: string;
  chain: string;
  shares: number;
  price: number | null;
  marketValue: number | null;
  custody: "self-custody";
  /** Block or slot the balance was read at — the receipt for the number. */
  blockNumber: number | null;
  contract: string;
}

export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "investing.rwa", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const holdings = auth.account.holdings ?? [];
  const quotes = await getQuotes().catch(() => null);

  /** Mark a tokenized position to the UNDERLYING's price. Sound because each
   *  token is a 1:1 claim, and null when we have no quote — an unpriced
   *  position reports its share count and an em-dash, never a zero value. */
  const priceOf = (symbol: string): number | null => {
    const asset = bySymbol.get(symbol.toUpperCase());
    const q = asset && quotes ? resolveQuote(quotes, asset) : undefined;
    return q?.price ?? null;
  };

  // ── The tokenized side ────────────────────────────────────────────────
  const flag = flagState("ONCHAIN_BALANCES_LIVE");
  const audit = registryAudit();
  const linkedWallet = auth.account.user.linkedWallet ?? null;

  let positions: TokenizedPosition[] = [];
  /** Why the tokenized section is empty, when it is. Rendered by the client
   *  instead of a "no holdings" state that would be a false statement. */
  let unavailable: { reason: string; detail: string } | null = null;
  const chainReads: { chain: string; ok: boolean; detail?: string }[] = [];

  if (!flag.on) {
    unavailable = {
      reason: "capability_disabled",
      detail: flag.blocker?.detail ?? "On-chain balance reads are not enabled on this deployment.",
    };
  } else if (!audit.anyTradable) {
    // The registry ships with no verified addresses. Reporting "no positions"
    // here would claim we looked; we did not, because there is nothing
    // verified to look for.
    unavailable = {
      reason: "registry_unverified",
      detail:
        `No tokenized-equity contract has been verified yet (${audit.unverified} of ${audit.total} entries ` +
        "await verification). Positions cannot be read until an address is confirmed against its issuer.",
    };
  } else if (!linkedWallet?.address) {
    unavailable = {
      reason: "no_wallet_linked",
      detail: "Link a self-custodial wallet to see tokenized positions held in it.",
    };
  } else {
    // Group the verified registry by chain — one RPC round trip per chain
    // rather than one per token.
    const byChain = new Map<string, StockTokenEntry[]>();
    for (const entry of tradableTokens()) {
      const list = byChain.get(entry.chain) ?? [];
      list.push(entry);
      byChain.set(entry.chain, list);
    }

    const results = await Promise.all(
      [...byChain.entries()].map(async ([chain, entries]) => {
        const kind = chain === "solana" ? ("solana" as const) : ("evm" as const);
        const result = await readBalances(
          chain,
          kind,
          linkedWallet.address,
          entries.map((e) => e.address as string)
        );
        return { chain, entries, result };
      })
    );

    for (const { chain, entries, result } of results) {
      chainReads.push({
        chain,
        ok: result.ok,
        ...(result.ok ? {} : { detail: result.detail }),
      });
      if (!result.ok) continue;

      const byAddress = new Map(
        entries.map((e) => [(e.address as string).toLowerCase(), e] as const)
      );
      for (const balance of (result as Extract<BalanceResult, { ok: true }>).balances) {
        const entry = byAddress.get(balance.token.toLowerCase());
        if (!entry) continue;
        const price = priceOf(entry.symbol);
        positions.push({
          symbol: entry.symbol,
          token: entry.tokenSymbol,
          issuer: entry.issuer,
          chain: entry.chain,
          shares: balance.amount,
          price,
          marketValue: price == null ? null : round(balance.amount * price),
          custody: "self-custody",
          blockNumber: balance.blockNumber,
          contract: balance.token,
        });
      }
    }

    positions = positions.sort((a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0));

    // Every chain failed. Do not present that as an empty portfolio.
    if (chainReads.length > 0 && chainReads.every((c) => !c.ok)) {
      unavailable = {
        reason: "chain_unreachable",
        detail: "Tokenized positions could not be read from the chain right now.",
      };
    }
  }

  // Only positions we could actually price contribute to a total. Summing
  // `?? 0` would report a total that silently excludes real holdings while
  // looking complete.
  const pricedPositions = positions.filter((p) => p.marketValue != null);
  const tokenizedValue = round(pricedPositions.reduce((s, p) => s + (p.marketValue as number), 0));
  const tokenizedValueComplete = pricedPositions.length === positions.length;

  // ── The traditional side ──────────────────────────────────────────────
  const brokerageValue = round(holdings.reduce((s, h) => s + h.marketValue, 0));

  // ── Unified per-symbol view ───────────────────────────────────────────
  const bySymbolMap = new Map<
    string,
    { symbol: string; brokerageShares: number; tokenizedShares: number; price: number | null }
  >();
  for (const h of holdings) {
    bySymbolMap.set(h.symbol, {
      symbol: h.symbol,
      brokerageShares: h.shares,
      tokenizedShares: 0,
      price: h.price,
    });
  }
  for (const p of positions) {
    const e = bySymbolMap.get(p.symbol) ?? {
      symbol: p.symbol,
      brokerageShares: 0,
      tokenizedShares: 0,
      price: p.price,
    };
    e.tokenizedShares += p.shares;
    e.price = p.price ?? e.price;
    bySymbolMap.set(p.symbol, e);
  }

  const unified = [...bySymbolMap.values()]
    .map((e) => ({
      symbol: e.symbol,
      totalShares: round(e.brokerageShares + e.tokenizedShares),
      brokerageShares: round(e.brokerageShares),
      tokenizedShares: round(e.tokenizedShares),
      marketValue: e.price == null ? null : round((e.brokerageShares + e.tokenizedShares) * e.price),
    }))
    .sort((a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0));

  return NextResponse.json({
    tokenized: positions,
    /** Null when positions were genuinely read. Populated when they could not
     *  be, so the client shows a reason instead of an empty holdings list. */
    unavailable,
    summary: {
      tokenizedValue,
      /** False when at least one position could not be priced — the total is
       *  then a lower bound, and the UI must say so rather than present it as
       *  the whole picture. */
      tokenizedValueComplete,
      brokerageValue,
      totalEquityValue: round(tokenizedValue + brokerageValue),
    },
    unified,
    /** Provenance: what was actually consulted to produce this response. */
    provenance: {
      onChainReadsEnabled: flag.on,
      wallet: linkedWallet?.address ?? null,
      chains: chainReads,
      registry: audit,
      readAt: new Date().toISOString(),
    },
  });
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
