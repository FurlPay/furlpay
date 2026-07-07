/**
 * FurlPay tools for the Vercel AI SDK.
 *
 *   import { furlpayTools } from "@furlpay/vercel-ai";
 *   import { generateText } from "ai";
 *
 *   const { text } = await generateText({
 *     model: anthropic("claude-sonnet-5"),
 *     tools: furlpayTools(),            // reads FURLPAY_API_KEY from the env
 *     prompt: "Book a hotel in Tokyo for $200/night, pay with USDC",
 *   });
 *
 * Each entry is an AI SDK `tool()` with a Zod parameter schema, so the model
 * calls it with validated arguments. Demo mode (no FURLPAY_API_KEY) returns
 * deterministic sample data so you can wire up and observe tool calls.
 */

import { tool } from "ai";
import { z } from "zod";

import { FurlPayClient } from "./client";

export { FurlPayClient } from "./client";

export interface FurlPayToolsOptions {
  client?: FurlPayClient;
}

export function furlpayTools(options: FurlPayToolsOptions = {}) {
  const c = options.client ?? FurlPayClient.fromEnv();

  return {
    furlpay_get_wallet_balances: tool({
      description:
        "Get the FurlPay account's stablecoin balances across chains (USDC/USDT on Solana, Base).",
      parameters: z.object({}),
      execute: async () => c.walletBalances(),
    }),

    furlpay_create_payment: tool({
      description: "Create a hosted stablecoin checkout and return a payment/checkout link.",
      parameters: z.object({
        amount: z.number().describe("Amount to charge, in the given currency."),
        currency: z.string().default("USDC").describe("Settlement currency, e.g. USDC or USDT."),
        description: z.string().default("").describe("Human-readable description shown on the checkout."),
      }),
      execute: async ({ amount, currency, description }) => c.createPayment(amount, currency, description),
    }),

    furlpay_send_transfer: tool({
      description: "Send stablecoins from the FurlPay wallet to an address or FurlPay handle.",
      parameters: z.object({
        to: z.string().describe("Recipient wallet address or FurlPay handle."),
        amount: z.number().describe("Amount of the token to send."),
        token: z.string().default("USDC").describe("Token symbol, e.g. USDC."),
      }),
      execute: async ({ to, amount, token }) => c.sendTransfer(to, amount, token),
    }),

    furlpay_place_investment_order: tool({
      description: "Place a fractional stock/ETF/crypto order funded in USDC (via Alpaca).",
      parameters: z.object({
        symbol: z.string().describe("Ticker to trade, e.g. AAPL, VOO, BTC."),
        side: z.enum(["buy", "sell"]).describe("'buy' or 'sell'."),
        notional: z.number().describe("USD notional to buy/sell (fractional allowed)."),
      }),
      execute: async ({ symbol, side, notional }) => c.placeInvestmentOrder(symbol, side, notional),
    }),

    furlpay_get_swap_quote: tool({
      description: "Quote a stablecoin/crypto swap, e.g. SOL to USDC.",
      parameters: z.object({
        from_token: z.string().describe("Token to sell, e.g. SOL."),
        to_token: z.string().describe("Token to receive, e.g. USDC."),
        amount: z.number().describe("Amount of from_token to swap."),
      }),
      execute: async ({ from_token, to_token, amount }) => c.swapQuote(from_token, to_token, amount),
    }),

    furlpay_get_x402_config: tool({
      description: "Get the x402 facilitator config: supported chains, tokens, limits, replay tolerance.",
      parameters: z.object({}),
      execute: async () => c.x402Config(),
    }),

    furlpay_pay_for_resource: tool({
      description:
        "Autonomously pay for an x402-protected (HTTP 402) API/resource within a USDC budget and return its content.",
      parameters: z.object({
        url: z.string().describe("URL of the x402-protected (HTTP 402) resource to fetch."),
        max_amount: z.number().default(1.0).describe("Maximum USDC the agent may spend on this call."),
        agent_id: z.string().default("agent_default").describe("Agent identity for budget accounting."),
      }),
      execute: async ({ url, max_amount, agent_id }) => c.payForResource(url, max_amount, agent_id),
    }),

    furlpay_set_agent_budget: tool({
      description: "Set a spending cap (USDC per period) for an AI agent's x402 payments.",
      parameters: z.object({
        agent_id: z.string().describe("Identifier of the AI agent to cap."),
        limit: z.number().describe("Spend cap in USDC for the period."),
        period: z.enum(["daily", "weekly", "monthly"]).default("daily").describe("Budget period."),
      }),
      execute: async ({ agent_id, limit, period }) => c.setAgentBudget(agent_id, limit, period),
    }),

    furlpay_get_agent_budget: tool({
      description: "Get an AI agent's x402 spending budget and amount spent so far.",
      parameters: z.object({
        agent_id: z.string().describe("Identifier of the AI agent."),
      }),
      execute: async ({ agent_id }) => c.agentBudget(agent_id),
    }),

    furlpay_create_x402_paywall: tool({
      description: "Protect a resource with an x402 paywall so agents pay per call in USDC.",
      parameters: z.object({
        resource: z.string().describe("Path/URL of the resource to protect, e.g. /api/premium/quote."),
        price: z.number().describe("Price per call, in USDC."),
        network: z.enum(["solana", "base"]).default("solana").describe("Settlement network."),
      }),
      execute: async ({ resource, price, network }) => c.createX402Paywall(resource, price, network),
    }),

    furlpay_verify_x402_payment: tool({
      description: "Verify an inbound x402 payment proof (merchant side).",
      parameters: z.object({
        payment_proof: z.string().describe("The x402 payment proof / X-PAYMENT header value."),
      }),
      execute: async ({ payment_proof }) => c.verifyX402Payment(payment_proof),
    }),

    furlpay_settle_x402_payment: tool({
      description: "Settle a verified x402 payment on-chain (merchant side).",
      parameters: z.object({
        payment_proof: z.string().describe("The x402 payment proof / X-PAYMENT header value."),
      }),
      execute: async ({ payment_proof }) => c.settleX402Payment(payment_proof),
    }),
  };
}
