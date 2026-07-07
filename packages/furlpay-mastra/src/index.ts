/**
 * FurlPay tools for Mastra.
 *
 *   import { furlpayTools } from "furlpay-mastra";
 *   import { Agent } from "@mastra/core/agent";
 *
 *   const treasurer = new Agent({
 *     name: "Treasurer",
 *     instructions: "You manage a FurlPay wallet.",
 *     model: openai("gpt-4o"),
 *     tools: furlpayTools(),            // reads FURLPAY_API_KEY from the env
 *   });
 *
 * Each entry is a Mastra `createTool` with a Zod inputSchema. Demo mode (no
 * FURLPAY_API_KEY) returns deterministic sample data so you can wire up and
 * observe tool calls without an account.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { FurlPayClient } from "./client";

export { FurlPayClient } from "./client";

export interface FurlPayToolsOptions {
  client?: FurlPayClient;
}

export function furlpayTools(options: FurlPayToolsOptions = {}) {
  const c = options.client ?? FurlPayClient.fromEnv();

  return {
    furlpay_get_wallet_balances: createTool({
      id: "furlpay_get_wallet_balances",
      description:
        "Get the FurlPay account's stablecoin balances across chains (USDC/USDT on Solana, Base).",
      inputSchema: z.object({}),
      execute: async () => c.walletBalances(),
    }),

    furlpay_create_payment: createTool({
      id: "furlpay_create_payment",
      description: "Create a hosted stablecoin checkout and return a payment/checkout link.",
      inputSchema: z.object({
        amount: z.number().describe("Amount to charge, in the given currency."),
        currency: z.string().default("USDC").describe("Settlement currency, e.g. USDC or USDT."),
        description: z.string().default("").describe("Human-readable description shown on the checkout."),
      }),
      execute: async ({ context }) => c.createPayment(context.amount, context.currency, context.description),
    }),

    furlpay_send_transfer: createTool({
      id: "furlpay_send_transfer",
      description: "Send stablecoins from the FurlPay wallet to an address or FurlPay handle.",
      inputSchema: z.object({
        to: z.string().describe("Recipient wallet address or FurlPay handle."),
        amount: z.number().describe("Amount of the token to send."),
        token: z.string().default("USDC").describe("Token symbol, e.g. USDC."),
      }),
      execute: async ({ context }) => c.sendTransfer(context.to, context.amount, context.token),
    }),

    furlpay_place_investment_order: createTool({
      id: "furlpay_place_investment_order",
      description: "Place a fractional stock/ETF/crypto order funded in USDC (via Alpaca).",
      inputSchema: z.object({
        symbol: z.string().describe("Ticker to trade, e.g. AAPL, VOO, BTC."),
        side: z.enum(["buy", "sell"]).describe("'buy' or 'sell'."),
        notional: z.number().describe("USD notional to buy/sell (fractional allowed)."),
      }),
      execute: async ({ context }) => c.placeInvestmentOrder(context.symbol, context.side, context.notional),
    }),

    furlpay_get_swap_quote: createTool({
      id: "furlpay_get_swap_quote",
      description: "Quote a stablecoin/crypto swap, e.g. SOL to USDC.",
      inputSchema: z.object({
        from_token: z.string().describe("Token to sell, e.g. SOL."),
        to_token: z.string().describe("Token to receive, e.g. USDC."),
        amount: z.number().describe("Amount of from_token to swap."),
      }),
      execute: async ({ context }) => c.swapQuote(context.from_token, context.to_token, context.amount),
    }),

    furlpay_get_x402_config: createTool({
      id: "furlpay_get_x402_config",
      description: "Get the x402 facilitator config: supported chains, tokens, limits, replay tolerance.",
      inputSchema: z.object({}),
      execute: async () => c.x402Config(),
    }),

    furlpay_pay_for_resource: createTool({
      id: "furlpay_pay_for_resource",
      description:
        "Autonomously pay for an x402-protected (HTTP 402) API/resource within a USDC budget and return its content.",
      inputSchema: z.object({
        url: z.string().describe("URL of the x402-protected (HTTP 402) resource to fetch."),
        max_amount: z.number().default(1.0).describe("Maximum USDC the agent may spend on this call."),
        agent_id: z.string().default("agent_default").describe("Agent identity for budget accounting."),
      }),
      execute: async ({ context }) => c.payForResource(context.url, context.max_amount, context.agent_id),
    }),

    furlpay_set_agent_budget: createTool({
      id: "furlpay_set_agent_budget",
      description: "Set a spending cap (USDC per period) for an AI agent's x402 payments.",
      inputSchema: z.object({
        agent_id: z.string().describe("Identifier of the AI agent to cap."),
        limit: z.number().describe("Spend cap in USDC for the period."),
        period: z.enum(["daily", "weekly", "monthly"]).default("daily").describe("Budget period."),
      }),
      execute: async ({ context }) => c.setAgentBudget(context.agent_id, context.limit, context.period),
    }),

    furlpay_get_agent_budget: createTool({
      id: "furlpay_get_agent_budget",
      description: "Get an AI agent's x402 spending budget and amount spent so far.",
      inputSchema: z.object({
        agent_id: z.string().describe("Identifier of the AI agent."),
      }),
      execute: async ({ context }) => c.agentBudget(context.agent_id),
    }),

    furlpay_create_x402_paywall: createTool({
      id: "furlpay_create_x402_paywall",
      description: "Protect a resource with an x402 paywall so agents pay per call in USDC.",
      inputSchema: z.object({
        resource: z.string().describe("Path/URL of the resource to protect, e.g. /api/premium/quote."),
        price: z.number().describe("Price per call, in USDC."),
        network: z.enum(["solana", "base"]).default("solana").describe("Settlement network."),
      }),
      execute: async ({ context }) => c.createX402Paywall(context.resource, context.price, context.network),
    }),

    furlpay_verify_x402_payment: createTool({
      id: "furlpay_verify_x402_payment",
      description: "Verify an inbound x402 payment proof (merchant side).",
      inputSchema: z.object({
        payment_proof: z.string().describe("The x402 payment proof / X-PAYMENT header value."),
      }),
      execute: async ({ context }) => c.verifyX402Payment(context.payment_proof),
    }),

    furlpay_settle_x402_payment: createTool({
      id: "furlpay_settle_x402_payment",
      description: "Settle a verified x402 payment on-chain (merchant side).",
      inputSchema: z.object({
        payment_proof: z.string().describe("The x402 payment proof / X-PAYMENT header value."),
      }),
      execute: async ({ context }) => c.settleX402Payment(context.payment_proof),
    }),
  };
}
