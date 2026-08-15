import type { McpClaims, Scope } from "./oauth";
import { hasScope } from "./oauth";

// ---------------------------------------------------------------------------
// The FurlPay connector's tool registry.
//
// THREE RULES, all learned the hard way in this codebase:
//
//  1. Every tool maps to an API route that ACTUALLY EXISTS in apps/web. No tool
//     is listed for a capability we don't ship — a connector that advertises
//     Amadeus/Tenderly/multi-sig we don't have is a directory rejection and a
//     lie to the user.
//  2. A money-moving tool NEVER settles inside the tool call. It returns a
//     prepared, quoted intent plus a confirmation URL the human opens. The
//     model proposes; the human (with a passkey/biometric) disposes. This is
//     the same HITL boundary the mobile co-pilot enforces via lib/copilotActions.
//  3. Responses are bounded. A tool that can return an unbounded list paginates
//     and truncates — an over-large payload evicts the conversation's context
//     and gets the connector rejected for context exhaustion.
// ---------------------------------------------------------------------------

/** Anthropic's cap is 25k tokens; ~4 chars/token, and we stay well under. */
const MAX_RESULT_CHARS = 60_000;

export interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface McpTool {
  name: string;
  title: string;
  description: string;
  scope: Scope;
  inputSchema: Record<string, unknown>;
  annotations: ToolAnnotations;
  /** Runs server-side with the caller's own session token. */
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

export interface ToolContext {
  claims: McpClaims;
  /** Calls our own API as the authenticated user (never as a service role). */
  api: (method: "GET" | "POST" | "PATCH", path: string, body?: unknown) => Promise<unknown>;
  origin: string;
}

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const str = (description: string, extra: Record<string, unknown> = {}) => ({ type: "string", description, ...extra });
const num = (description: string, extra: Record<string, unknown> = {}) => ({ type: "number", description, ...extra });

const EVM_ADDRESS = "^0x[0-9a-fA-F]{40}$";

const READ: ToolAnnotations = { readOnlyHint: true, idempotentHint: true, openWorldHint: false };
const READ_EXTERNAL: ToolAnnotations = { readOnlyHint: true, idempotentHint: true, openWorldHint: true };
/** Prepares an action for human approval; changes nothing by itself. */
const PREPARE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

export const TOOLS: McpTool[] = [
  {
    name: "get_financial_overview",
    title: "Financial overview",
    description:
      "Summarize the signed-in FurlPay account: stablecoin balances by token and chain, recent transactions, and cards. Start here when the user asks 'how am I doing' or about their money in general.",
    scope: "wallets:read",
    inputSchema: obj({}),
    annotations: READ,
    run: (_a, ctx) => ctx.api("GET", "/api/overview"),
  },
  {
    name: "get_wallet_balances",
    title: "Wallet balances",
    description:
      "Stablecoin balances for the signed-in account across supported chains (Arbitrum, Base, Polygon, Ethereum, Solana), with USD values.",
    scope: "wallets:read",
    inputSchema: obj({}),
    annotations: READ,
    run: (_a, ctx) => ctx.api("GET", "/api/wallets"),
  },
  {
    name: "list_transactions",
    title: "List transactions",
    description:
      "Recent transactions for the signed-in account, newest first. Use `category` to filter (e.g. card, transfer, swap) and `limit` to bound the result.",
    scope: "transactions:read",
    inputSchema: obj({
      category: str("Optional category filter, e.g. 'card' or 'transfer'."),
      limit: num("Max rows to return (1-50, default 20).", { minimum: 1, maximum: 50 }),
    }),
    annotations: READ,
    run: async (a, ctx) => {
      const limit = Math.min(Math.max(Number(a.limit ?? 20) || 20, 1), 50);
      const qs = a.category ? `?category=${encodeURIComponent(String(a.category))}` : "";
      const res = (await ctx.api("GET", `/api/transactions${qs}`)) as { transactions?: unknown[] };
      const all = res.transactions ?? [];
      return { transactions: all.slice(0, limit), returned: Math.min(all.length, limit), total: all.length };
    },
  },
  {
    name: "get_portfolio",
    title: "Investment portfolio",
    description:
      "Holdings, performance and dividend entitlements for the signed-in account, projected from the trade-lot ledger. Read-only: an agent can monitor a portfolio with this, but no tool places, changes or cancels orders — trading requires the human in the app. Dividend entitlements marked 'pending' have not reached their payment date; 'paid' means payable, and actual settlement (cash or reinvestment) is the user's action, not the agent's.",
    scope: "investing:read",
    inputSchema: obj({}),
    annotations: READ,
    run: (_a, ctx) => ctx.api("GET", "/api/investing/portfolio"),
  },
  {
    name: "get_wallet_risk",
    title: "Screen a wallet address",
    description:
      "AML/risk screening for a destination address BEFORE sending to it. Returns a verdict and the reasons. Always call this before preparing a payment to an address the user has not paid before.",
    scope: "wallets:read",
    inputSchema: obj({ address: str("The address to screen (EVM 0x… or Solana base58).") }, ["address"]),
    annotations: READ_EXTERNAL,
    run: (a, ctx) => ctx.api("GET", `/api/compliance?address=${encodeURIComponent(String(a.address))}`),
  },
  {
    name: "get_swap_quote",
    title: "Quote a stablecoin swap",
    description:
      "Best route and price for swapping/bridging stablecoins across chains (via the LI.FI aggregator). Read-only: quoting never moves funds.",
    scope: "wallets:read",
    inputSchema: obj(
      {
        fromToken: str("Source token symbol, e.g. USDC."),
        toToken: str("Destination token symbol, e.g. EURC."),
        fromChain: str("Source chain, e.g. arbitrum, base, polygon, ethereum, solana."),
        amountIn: num("Amount of fromToken to swap.", { exclusiveMinimum: 0 }),
      },
      ["fromToken", "toToken", "fromChain", "amountIn"]
    ),
    annotations: READ_EXTERNAL,
    run: (a, ctx) => ctx.api("POST", "/api/swaps", a),
  },
  {
    name: "prepare_payment",
    title: "Prepare a stablecoin payment (needs human approval)",
    description:
      "Prepare a USDC payment to an address and return a quote plus an approval link. This DOES NOT send money: the user must open the link and approve with their passkey/biometric. Screen the recipient with get_wallet_risk first. Report the approval link to the user verbatim.",
    scope: "payments:write",
    inputSchema: obj(
      {
        recipient: str("Destination EVM address (0x…).", { pattern: EVM_ADDRESS }),
        amountUsd: num("Amount in USD (max 10000 via the connector).", {
          exclusiveMinimum: 0,
          maximum: 10_000,
        }),
        memo: str("Optional note shown to the user on the approval screen.", { maxLength: 140 }),
      },
      ["recipient", "amountUsd"]
    ),
    annotations: PREPARE,
    run: async (a, ctx) => {
      const intent = (await ctx.api("POST", "/api/payments/create", {
        amount: a.amountUsd,
        recipient: a.recipient,
        sourceChain: "arbitrum",
        ...(a.memo ? { memo: a.memo } : {}),
      })) as { id?: string; paymentId?: string };
      const id = intent.id ?? intent.paymentId;
      return {
        status: "awaiting_human_approval",
        payment: intent,
        approvalUrl: id ? `${ctx.origin}/pay/confirm?intent=${encodeURIComponent(id)}` : `${ctx.origin}/dashboard`,
        note: "No funds have moved. The user must open approvalUrl and approve with their passkey.",
      };
    },
  },
  {
    name: "create_invoice",
    title: "Create a payment request",
    description:
      "Create a shareable payment request (invoice) that someone can pay in stablecoins. Returns the invoice and its payment link. Receives money; never sends it.",
    scope: "payments:write",
    inputSchema: obj(
      {
        amountUsd: num("Amount to request in USD.", { exclusiveMinimum: 0, maximum: 100_000 }),
        description: str("What the payment is for.", { maxLength: 200 }),
      },
      ["amountUsd", "description"]
    ),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: (a, ctx) =>
      ctx.api("POST", "/api/payments", { amount: a.amountUsd, description: a.description, type: "request" }),
  },
  {
    name: "search_travel",
    title: "Search stays",
    description:
      "Search hotels/stays payable in stablecoins. Returns options with nightly price. Use book_travel_link afterwards to hand the user a booking link — the connector never books autonomously.",
    scope: "travel:read",
    inputSchema: obj(
      {
        city: str("Destination city, e.g. 'Dubai'."),
        limit: num("Max results (1-10, default 5).", { minimum: 1, maximum: 10 }),
      },
      ["city"]
    ),
    annotations: READ_EXTERNAL,
    run: async (a, ctx) => {
      const res = (await ctx.api("GET", "/api/travel/deals")) as { deals?: Array<Record<string, unknown>> };
      const city = String(a.city).toLowerCase();
      const limit = Math.min(Math.max(Number(a.limit ?? 5) || 5, 1), 10);
      const deals = (res.deals ?? []).filter((d) => String(d.city ?? "").toLowerCase().includes(city));
      return { city: a.city, stays: deals.slice(0, limit), returned: Math.min(deals.length, limit) };
    },
  },
  {
    name: "list_trips",
    title: "List booked trips",
    description: "The signed-in user's upcoming, past, and cancelled trips.",
    scope: "travel:read",
    inputSchema: obj({}),
    annotations: READ,
    run: (_a, ctx) => ctx.api("GET", "/api/travel/trips"),
  },
  {
    name: "book_travel_link",
    title: "Hand off a booking to the user (needs human approval)",
    description:
      "Return an authenticated deep link where the user completes and pays for a booking themselves. The connector never books or charges autonomously — travel bookings are irreversible and supplier-priced.",
    scope: "travel:write",
    inputSchema: obj({ city: str("Destination city to open the booking flow for.") }, ["city"]),
    annotations: PREPARE,
    run: async (a, ctx) => ({
      status: "awaiting_human_approval",
      bookingUrl: `${ctx.origin}/travel/stays?query=${encodeURIComponent(String(a.city))}`,
      note: "Nothing was booked or charged. The user completes payment and confirmation in FurlPay.",
    }),
  },
  {
    name: "get_treasury_insights",
    title: "Treasury & spending insights",
    description:
      "Spending analytics for the signed-in account: totals by category over a period, useful for burn-rate and budget questions.",
    scope: "transactions:read",
    inputSchema: obj({ days: num("Look-back window in days (1-365, default 30).", { minimum: 1, maximum: 365 }) }),
    annotations: READ,
    run: (a, ctx) => {
      const days = Math.min(Math.max(Number(a.days ?? 30) || 30, 1), 365);
      return ctx.api("GET", `/api/analytics?days=${days}`);
    },
  },
  {
    name: "open_support_ticket",
    title: "Open a support ticket",
    description:
      "File a FurlPay support ticket for the signed-in user. Replies arrive in the app and by email. Never include seed phrases, private keys, or full card numbers — they are stripped server-side.",
    scope: "profile:read",
    inputSchema: obj(
      {
        category: str("One of: stablecoins, cards, kyc, travel, developers, other.", {
          enum: ["stablecoins", "cards", "kyc", "travel", "developers", "other"],
        }),
        subject: str("Short subject (4-120 chars).", { minLength: 4, maxLength: 120 }),
        body: str("What happened (10-5000 chars).", { minLength: 10, maxLength: 5000 }),
      },
      ["category", "subject", "body"]
    ),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    run: (a, ctx) => ctx.api("POST", "/api/support/tickets", a),
  },
];

export function toolByName(name: string): McpTool | undefined {
  return TOOLS.find((t) => t.name === name);
}

/** The tools this token may see. A client that never asked for payments:write
 *  should not even be shown the money tools — an unusable tool in the list is
 *  a tool the model will try and fail with. */
export function visibleTools(claims: McpClaims): McpTool[] {
  return TOOLS.filter((t) => hasScope(claims, t.scope));
}

/** Serialize a tool result, hard-capping the payload so one call can never
 *  exhaust the conversation's context window. */
export function serializeResult(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(value, null, 2) ?? "null";
  } catch {
    text = String(value);
  }
  if (text.length <= MAX_RESULT_CHARS) return text;
  return (
    text.slice(0, MAX_RESULT_CHARS) +
    `\n\n… truncated (${text.length} chars). Narrow the request (filters, smaller limit) for the full result.`
  );
}
