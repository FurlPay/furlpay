import type { UserAccount } from "@/lib/store";
import { trackCost } from "@/lib/costTracker";
import { getAccountBalanceUsd } from "@/lib/services/account";
import { planIntent } from "@/lib/services/intentRouter";
import { earnIsLive, selectVault } from "@/lib/services/morpho";
import { capabilityMode } from "@/lib/capabilityGate";
import type { Chain, Stablecoin } from "@furlpay/types";

// ---------------------------------------------------------------------------
// FurlPay AI Co-Pilot — a conversational financial assistant that reads the
// user's real FurlPay state and calls the SAME tool surface the MCP server and
// /api/* routes expose (balances, spend analytics, travel, investing, earn,
// swaps, pay). This is the differentiator: no competitor's assistant can pay,
// book travel AND invest in one turn.
//
// Design mirrors the rest of the app: fully deterministic and demo-safe by
// default (no external key required). When ANTHROPIC_API_KEY is present the
// deterministic tools still produce the *facts* — the LLM only phrases the
// reply over grounded data, so it can never hallucinate a balance or move
// money on its own. Any money movement is returned as `requiresConfirmation`
// and is NEVER executed inside the co-pilot; the client re-submits to the
// guarded /api/* route after the human confirms (HITL).
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ToolCall {
  tool: string;
  args: Record<string, unknown>;
}

export interface Confirmation {
  /** The guarded route the client should call after the human confirms. */
  action: string;
  method: "POST";
  endpoint: string;
  body: Record<string, unknown>;
  summary: string;
  amountUsd?: number;
}

export interface CopilotResult {
  intent: string;
  reply: string;
  toolCalls: ToolCall[];
  data?: unknown;
  suggestions: string[];
  requiresConfirmation?: Confirmation;
}

// ---- entity extraction -----------------------------------------------------

/** Parse the first dollar/amount token: "$50", "50 usdc", "1,250.5". */
function parseAmount(text: string): number | undefined {
  const m = text.match(/\$?\s*([0-9][0-9,]*(?:\.[0-9]+)?)/);
  if (!m) return undefined;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

const STABLES: Stablecoin[] = ["USDC", "USDT", "EURC", "PYUSD", "DAI"];
const CHAINS: Chain[] = ["ethereum", "polygon", "base", "arbitrum", "solana", "gnosis"];

function parseToken(text: string): Stablecoin | undefined {
  const up = text.toUpperCase();
  return STABLES.find((t) => new RegExp(`\\b${t}\\b`).test(up));
}

function parseChain(text: string): Chain | undefined {
  const low = text.toLowerCase();
  return CHAINS.find((c) => low.includes(c));
}

/** Ticker like AAPL / NVDA / VOO — 1-5 uppercase letters that aren't a stable. */
function parseTicker(text: string): string | undefined {
  const matches = text.toUpperCase().match(/\b[A-Z]{1,5}\b/g) ?? [];
  return matches.find((m) => !STABLES.includes(m as Stablecoin) && m !== "DCA" && m !== "USD");
}

function parseCadence(text: string): "day" | "week" | "month" | undefined {
  const t = text.toLowerCase();
  if (/\bday|daily\b/.test(t)) return "day";
  if (/\bweek|weekly\b/.test(t)) return "week";
  if (/\bmonth|monthly\b/.test(t)) return "month";
  return undefined;
}

// ---- deterministic tools (read the real store) -----------------------------

function toolNetWorth(account: UserAccount) {
  const crypto = account.tokenBalances.reduce((s, b) => s + b.usdValue, 0);
  const fiat = account.fiatBalances.reduce((s, b) => s + b.usdValue, 0);
  const equities = account.holdings.reduce((s, h) => s + h.marketValue, 0);
  return {
    netWorth: round(crypto + fiat + equities),
    spendable: getAccountBalanceUsd(account.user.id),
    breakdown: { crypto: round(crypto), fiat: round(fiat), equities: round(equities) },
  };
}

/** Spend-by-category over a window (default: current calendar month). */
function toolSpend(account: UserAccount, category?: string, sinceIso?: string) {
  const since = sinceIso ? new Date(sinceIso) : startOfMonth();
  const out = account.transactions.filter(
    (t) => t.direction === "out" && new Date(t.timestamp) >= since && t.status !== "declined"
  );
  const byCat: Record<string, number> = {};
  for (const t of out) byCat[t.category] = round((byCat[t.category] ?? 0) + t.amountUsd);
  const total = round(out.reduce((s, t) => s + t.amountUsd, 0));

  // "travel" is a virtual category: card spend at lodging/airline merchants.
  const travel = round(
    out
      .filter((t) => /hotel|flight|stay|travel|airline|booking/i.test(t.title + t.subtitle))
      .reduce((s, t) => s + t.amountUsd, 0)
  );
  const matched = category
    ? category === "travel"
      ? travel
      : byCat[category] ?? 0
    : undefined;
  return { since: since.toISOString(), total, byCategory: byCat, travel, matched };
}

/**
 * Earn, quoted from the vault the deposit route would actually use.
 *
 * This used to be a hardcoded table (USDC 8.2%, USDT 9.5%, EURC 6.4%) labelled
 * "FurlPay Earn · Aave v3" — none of which was read from anywhere, and the
 * deposit route it offered to confirm into is Morpho-only and 503s when Earn is
 * not live. Quoting a rate we cannot source, then offering a confirmation the
 * route will refuse, is two misstatements in one reply.
 */
type EarnFacts =
  | { available: false; idleUsdc: number }
  | { available: true; idleUsdc: number; vault: string; apy: number; projectedYearly: number };

async function toolEarn(account: UserAccount): Promise<EarnFacts> {
  const idleUsdc = round(account.tokenBalances.find((b) => b.token === "USDC")?.usdValue ?? 0);
  if (!earnIsLive()) return { available: false, idleUsdc };
  try {
    const vault = await selectVault();
    return {
      available: true,
      idleUsdc,
      vault: vault.name,
      apy: round(vault.netApy),
      projectedYearly: round((idleUsdc * vault.netApy) / 100),
    };
  } catch {
    // The rate source is down. Saying so beats quoting a remembered number.
    return { available: false, idleUsdc };
  }
}

function toolPortfolio(account: UserAccount) {
  const marketValue = round(account.holdings.reduce((s, h) => s + h.marketValue, 0));
  const costBasis = round(account.holdings.reduce((s, h) => s + (h.costBasis ?? 0), 0));
  return {
    holdings: account.holdings.map((h) => ({ symbol: h.symbol, shares: h.shares, marketValue: round(h.marketValue) })),
    marketValue,
    totalReturn: round(marketValue - costBasis),
  };
}

// ---- support tools -----------------------------------------------------------

/** Status of recent outgoing/incoming money that a user would ask about. */
function toolTransactionStatus(account: UserAccount, idFragment?: string) {
  const txs = idFragment
    ? account.transactions.filter((t) => t.id.includes(idFragment)).slice(0, 3)
    : account.transactions.filter((t) => t.status === "pending").slice(0, 5);
  return {
    matched: txs.map((t) => ({
      id: t.id,
      title: t.title,
      amountUsd: t.amountUsd,
      direction: t.direction,
      status: t.status,
      timestamp: t.timestamp,
    })),
    pendingCount: account.transactions.filter((t) => t.status === "pending").length,
  };
}

function toolKycStatus(account: UserAccount) {
  const u = account.user;
  const missing =
    u.kycStatus === "verified"
      ? []
      : u.kycTier === 0
        ? ["Government ID photo", "Proof of address"]
        : ["Proof of address"];
  return { kycStatus: u.kycStatus, kycTier: u.kycTier, region: u.region, missing };
}

// ---- the router ------------------------------------------------------------

export async function runCopilot(messages: ChatMessage[], account: UserAccount): Promise<CopilotResult> {
  const last = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const t = last.toLowerCase();
  const result = await route(last, t, account);

  // Optional LLM phrasing over grounded facts. Never invents data or actions.
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      result.reply = await phraseWithClaude(messages, result);
    } catch {
      /* fall back to the deterministic reply */
    }
  }
  return result;
}

async function route(raw: string, t: string, account: UserAccount): Promise<CopilotResult> {
  // --- card freeze / unfreeze (support action, HITL like all mutations) ---
  if (/\b(freeze|unfreeze|lock|unlock)\b.*\bcard\b|\bcard\b.*\b(freeze|frozen|unfreeze|lock|unlock)\b/.test(t)) {
    const unfreeze = /\b(unfreeze|unlock)\b/.test(t);
    const card = account.cards.find((c) => (unfreeze ? c.frozen : !c.frozen)) ?? account.cards[0];
    if (!card) {
      return {
        intent: "card_control",
        reply: "You don't have any cards yet — create one from the Cards page first.",
        toolCalls: [{ tool: "card_control", args: { action: unfreeze ? "unfreeze" : "freeze" } }],
        suggestions: ["Show my cards", "Check my balance"],
      };
    }
    return {
      intent: "card_control",
      reply: `${unfreeze ? "Unfreezing" : "Freezing"} ${card.label} (…${card.last4}) blocks ${
        unfreeze ? "nothing — it restores" : "every new authorization until you unfreeze — existing subscriptions will decline too. It takes effect"
      } immediately. Confirm to proceed.`,
      toolCalls: [{ tool: "card_control", args: { cardId: card.id, action: unfreeze ? "unfreeze" : "freeze" } }],
      requiresConfirmation: {
        action: "card_control",
        method: "POST",
        endpoint: "/api/cards/settings",
        body: { cardId: card.id, freeze: !unfreeze },
        summary: `${unfreeze ? "Unfreeze" : "Freeze"} ${card.label} ending ${card.last4}`,
      },
      data: { cardId: card.id, label: card.label, last4: card.last4, frozen: card.frozen },
      suggestions: unfreeze
        ? ["Show recent card transactions", "Change my card limits"]
        : ["Report the card stolen", "Show recent card transactions"],
    };
  }

  // --- transaction / deposit status (support lookup) ---
  if (/\b(where('| i)?s|status of|stuck|delayed|not (arrived|credited|received)|track)\b.*\b(deposit|transaction|payment|transfer|money)\b/.test(t)) {
    const idFragment = raw.match(/\b(tx_[a-zA-Z0-9-]+|0x[a-fA-F0-9]{8,})\b/)?.[0];
    const d = toolTransactionStatus(account, idFragment);
    return {
      intent: "transaction_status",
      reply: d.matched.length
        ? `${d.matched.length === 1 ? "Found it" : `Found ${d.matched.length}`}: ${d.matched
            .map((x) => `${x.title} $${x.amountUsd.toLocaleString()} — ${x.status}`)
            .join("; ")}. ${d.pendingCount ? `${d.pendingCount} payment(s) still pending — on-chain deposits usually settle within minutes; bridged transfers can take longer.` : ""}`
        : "Nothing is pending right now — your recent transactions have all settled. If a deposit is missing, share its transaction hash and I'll check it.",
      toolCalls: [{ tool: "check_transaction_status", args: { id: idFragment ?? "recent_pending" } }],
      data: d,
      suggestions: ["Show all transactions", "Check network status", "Open a support ticket"],
    };
  }

  // --- KYC / verification status (support lookup) ---
  if (/\b(kyc|verification|verified|identity|onboarding tier)\b/.test(t)) {
    const d = toolKycStatus(account);
    return {
      intent: "kyc_status",
      reply:
        d.kycStatus === "verified"
          ? `You're fully verified (tier ${d.kycTier}, ${d.region}) — no documents outstanding.`
          : `Your verification is ${d.kycStatus} at tier ${d.kycTier}. Still needed: ${d.missing.join(" and ")}. Upload them from Profile → Verification.`,
      toolCalls: [{ tool: "check_kyc_status", args: {} }],
      data: d,
      suggestions: ["What does tier 2 unlock?", "Open my profile", "Open a support ticket"],
    };
  }

  // --- balance / net worth ---
  if (/\b(balance|net worth|how much.*(have|got)|portfolio value|spendable)\b/.test(t)) {
    const d = toolNetWorth(account);
    return {
      intent: "balance",
      reply: `Your net worth is $${d.netWorth.toLocaleString()} — $${d.spendable.toLocaleString()} spendable now, with $${d.breakdown.crypto.toLocaleString()} in stablecoins, $${d.breakdown.equities.toLocaleString()} in equities and $${d.breakdown.fiat.toLocaleString()} in fiat.`,
      toolCalls: [{ tool: "get_net_worth", args: {} }],
      data: d,
      suggestions: ["Earn yield on idle USDC", "How much did I spend this month?", "Show my stocks"],
    };
  }

  // --- spending analytics ---
  if (/\b(spend|spent|spending|how much did i)\b/.test(t)) {
    const category = /travel|hotel|flight/.test(t) ? "travel" : undefined;
    const d = toolSpend(account, category);
    const headline = category
      ? `You've spent $${d.travel.toLocaleString()} on travel this month.`
      : `You've spent $${d.total.toLocaleString()} this month across ${Object.keys(d.byCategory).length} categories.`;
    return {
      intent: "spend_analytics",
      reply: headline,
      toolCalls: [{ tool: "get_spend", args: { category: category ?? "all" } }],
      data: d,
      suggestions: ["Break it down by category", "Set a travel budget", "Show recent transactions"],
    };
  }

  // --- earn / yield ---
  if (/\b(earn|yield|apy|interest|idle|passive)\b/.test(t)) {
    const d = await toolEarn(account);
    if (!d.available) {
      return {
        intent: "earn",
        reply: `You have $${d.idleUsdc.toLocaleString()} idle USDC. Earn isn't available on your account right now, so I can't quote a rate or move funds into it.`,
        toolCalls: [{ tool: "get_earn", args: {} }],
        data: d,
        suggestions: ["Check my balance", "How much did I spend this month?"],
      };
    }
    return {
      intent: "earn",
      reply: `You have $${d.idleUsdc.toLocaleString()} idle USDC. ${d.vault} currently pays ${d.apy}% net APY (variable), about $${d.projectedYearly.toLocaleString()}/yr at today's rate. Want me to move it into Earn?`,
      toolCalls: [{ tool: "get_earn", args: {} }],
      data: d,
      requiresConfirmation:
        d.idleUsdc > 0
          ? {
              action: "earn_deposit",
              method: "POST",
              endpoint: "/api/earn/deposit",
              body: { token: "USDC", amountUsd: d.idleUsdc },
              summary: `Deposit $${d.idleUsdc.toLocaleString()} USDC into ${d.vault} (${d.apy}% variable APY)`,
              amountUsd: d.idleUsdc,
            }
          : undefined,
      suggestions: ["Deposit idle USDC", "What's the risk?"],
    };
  }

  // --- invest / DCA ---
  if (/\b(buy|invest|dca|stock|shares?|etf|dollar.?cost)\b/.test(t)) {
    const amount = parseAmount(raw);
    const symbol = parseTicker(raw) ?? "VOO";
    const cadence = parseCadence(raw);
    const side = /\bsell\b/.test(t) ? "sell" : "buy";
    if (cadence && capabilityMode("RECURRING_INVESTING_LIVE") === null) {
      // Nothing executes recurring orders (see api/investing/schedule). Offering
      // "Confirm to activate the schedule" would activate nothing.
      return {
        intent: "invest_dca",
        reply: `Recurring investments aren't available yet, so I can't set up a ${cadence} ${side} of ${symbol}. You can place a one-off order instead.`,
        toolCalls: [{ tool: "schedule_investment", args: { symbol, notional: amount ?? 50, cadence } }],
        data: { symbol, cadence, notional: amount ?? 50, available: false },
        suggestions: [`Buy $${amount ?? 50} of ${symbol} now`, "Show my portfolio"],
      };
    }
    if (cadence) {
      return {
        intent: "invest_dca",
        reply: `I can set up a recurring ${side} of $${amount ?? 50}/${cadence} into ${symbol}. Confirm to activate the schedule.`,
        toolCalls: [{ tool: "schedule_investment", args: { symbol, notional: amount ?? 50, cadence } }],
        requiresConfirmation: {
          action: "schedule_dca",
          method: "POST",
          endpoint: "/api/investing/schedule",
          body: { symbol, side, notional: amount ?? 50, cadence },
          summary: `DCA $${amount ?? 50} into ${symbol} every ${cadence}`,
          amountUsd: amount ?? 50,
        },
        data: { symbol, cadence, notional: amount ?? 50 },
        suggestions: ["Change the amount", "Pick a different stock", "Show my portfolio"],
      };
    }
    return {
      intent: "invest",
      reply: `Ready to ${side} $${amount ?? 100} of ${symbol} (fractional). Confirm to place the order.`,
      toolCalls: [{ tool: "place_investment_order", args: { symbol, side, notional: amount ?? 100 } }],
      requiresConfirmation: {
        action: "place_order",
        method: "POST",
        endpoint: "/api/investing/order",
        body: { symbol, side, notional: amount ?? 100 },
        summary: `${side === "buy" ? "Buy" : "Sell"} $${amount ?? 100} of ${symbol}`,
        amountUsd: amount ?? 100,
      },
      data: { symbol, side, notional: amount ?? 100 },
      suggestions: ["Buy a different amount", "Set up a weekly DCA", "Show my portfolio"],
    };
  }

  // --- swap ---
  if (/\b(swap|convert|exchange|bridge)\b/.test(t)) {
    const amount = parseAmount(raw) ?? 100;
    const chain = parseChain(raw) ?? "arbitrum";
    const tokens = (raw.toUpperCase().match(/\b(USDC|USDT|EURC|PYUSD|DAI)\b/g) ?? []) as Stablecoin[];
    const fromToken = tokens[0] ?? "USDC";
    const toToken = tokens[1] ?? (fromToken === "USDC" ? "EURC" : "USDC");
    let plan;
    try {
      plan = await planIntent({ fromToken, toToken, fromChain: chain, toChain: chain, amount });
    } catch {
      plan = null;
    }
    return {
      intent: "swap",
      reply: plan
        ? `Best route to swap ${amount} ${fromToken} → ${toToken} on ${chain}: ${plan.rail} (${plan.reason}). You'd receive ~${round(plan.amountOut)} ${toToken}, fee $${round(plan.feeUsd)}, ETA ${plan.etaSeconds}s.`
        : `I couldn't find a route for ${fromToken} → ${toToken} on ${chain}.`,
      toolCalls: [{ tool: "quote_swap", args: { fromToken, toToken, fromChain: chain, amountIn: amount } }],
      data: plan,
      // Deliberately NO `requiresConfirmation`.
      //
      // Settling a swap needs the single-use `quoteId` the server issued for the
      // exact price the user was shown — that is what makes re-pricing at
      // execution time unrepresentable. `runCopilot` has no authenticated user
      // in scope (this route is session-gated by middleware, not by
      // requireUser), so it cannot call issueQuote and cannot produce one.
      //
      // What it used to send was a quote-shaped body with no `execute` flag, so
      // approving it took the QUOTE branch of /api/swaps: the user confirmed a
      // swap, saw no error, and nothing moved. A confirmation that cannot settle
      // must not be offered as one. The number above is a route estimate; the
      // swap screen does the real quote → confirm → execute.
      requiresConfirmation: undefined,
      suggestions: ["Open swap", "Swap a different amount", "Show my balances"],
    };
  }

  // --- travel booking ---
  if (/\b(book|hotel|stay|flight|travel|trip|vacation|holiday)\b/.test(t)) {
    // No stays are listed here. This branch used to call generateStays(), which
    // invents hotel names and nightly prices from a hash of the city, and
    // presented them as "top stays". Real availability comes from the travel
    // search, which reports honestly when no live inventory provider exists.
    const city = extractCity(raw);
    return {
      intent: "travel",
      reply: `Search stays${city ? ` in ${city}` : ""} from Travel with your dates — I only quote prices the live inventory returns.`,
      toolCalls: [{ tool: "search_stays", args: { city } }],
      data: { city },
      suggestions: ["Open travel search", "Check my balance"],
    };
  }

  // --- pay / send ---
  if (/\b(pay|send|transfer|remit|payout)\b/.test(t)) {
    const amount = parseAmount(raw) ?? 0;
    const addr = raw.match(/0x[a-fA-F0-9]{6,}/)?.[0];
    return {
      intent: "pay",
      reply: amount
        ? `Ready to send $${amount} USDC${addr ? ` to ${short(addr)}` : ""}. Confirm to sign and settle on Arbitrum.`
        : `Who should I pay, and how much? e.g. "send $20 USDC to 0xabc…".`,
      toolCalls: amount ? [{ tool: "send_payment", args: { amountUsd: amount, to: addr } }] : [],
      requiresConfirmation:
        amount && addr
          ? {
              action: "send_payment",
              method: "POST",
              endpoint: "/api/payments/create",
              body: { amount, recipient: addr, sourceChain: "arbitrum" },
              summary: `Send $${amount} USDC to ${short(addr)}`,
              amountUsd: amount,
            }
          : undefined,
      suggestions: ["Send to a saved payee", "Pay a bill instead", "Check my balance"],
    };
  }

  // --- support / open a ticket ---
  if (/\b(support|ticket|complaint|refund|chargeback|human|agent|talk to (someone|a person)|report (a )?(bug|problem|issue))\b/.test(t)) {
    const subject = raw.slice(0, 100).trim();
    return {
      intent: "support",
      reply:
        "I can open a support ticket for you — a human follows up by email, and you can track it on the Support page. Confirm and I'll file it with what you've told me.",
      toolCalls: [{ tool: "create_support_ticket", args: { category: "other" } }],
      requiresConfirmation: {
        action: "create_support_ticket",
        method: "POST",
        endpoint: "/api/support/tickets",
        body: { category: "other", subject: subject.length >= 4 ? subject : "Support request", body: raw },
        summary: `Open a support ticket: "${subject.length >= 4 ? subject : "Support request"}"`,
      },
      suggestions: ["Where is my deposit?", "Freeze my card", "Check my KYC status"],
    };
  }

  // --- help / fallback ---
  return {
    intent: "help",
    reply:
      "I'm your FurlPay co-pilot. I can check balances, analyze spending, book travel, invest in stocks/ETFs, earn yield, swap stablecoins, send payments — and handle support: transaction status, card freezes, KYC checks, or opening a ticket.",
    toolCalls: [],
    data: toolNetWorth(account),
    suggestions: [
      "How much did I spend on travel this month?",
      "Earn yield on my idle USDC",
      "Set up a $50/week DCA into AAPL",
      "Book a hotel in Tokyo",
    ],
  };
}

// ---- optional Claude phrasing ----------------------------------------------

async function phraseWithClaude(messages: ChatMessage[], grounded: CopilotResult): Promise<string> {
  const system =
    "You are FurlPay's financial co-pilot. Answer in ≤2 short sentences. You are given GROUNDED_FACTS computed from the user's real account — use ONLY these numbers, never invent balances or amounts. If an action needs confirmation, invite the user to confirm; never claim you already executed it.";
  const body = {
    model: process.env.COPILOT_MODEL || "claude-haiku-4-5-20251001",
    max_tokens: 300,
    system,
    messages: [
      ...messages.slice(-6).map((m) => ({ role: m.role, content: m.content })),
      {
        role: "user" as const,
        content: `GROUNDED_FACTS (JSON): ${JSON.stringify({
          intent: grounded.intent,
          data: grounded.data,
          proposedAction: grounded.requiresConfirmation?.summary,
        })}\n\nWrite the reply.`,
      },
    ],
  };
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}`);
  const json = (await res.json()) as { content?: { text?: string }[] };
  const text = json.content?.map((c) => c.text ?? "").join("").trim();
  if (!text) throw new Error("empty");
  trackCost("anthropic", "copilot_message");
  return text;
}

// ---- helpers ---------------------------------------------------------------

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
function startOfMonth(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function short(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}
function extractCity(text: string): string | undefined {
  const m = text.match(/\b(?:in|to|at)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)/);
  return m?.[1];
}
