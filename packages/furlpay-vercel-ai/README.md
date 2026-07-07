# @furlpay/vercel-ai

**FurlPay tools for the [Vercel AI SDK](https://sdk.vercel.ai)** — add stablecoin payments, fractional investing, and [x402](https://furlpay.com/docs/mcp) agentic payment rails to any AI SDK app in three lines.

Runs in **demo mode out of the box** — no FurlPay account needed. Set `FURLPAY_API_KEY` to execute against the live API.

## Install

```bash
npm i @furlpay/vercel-ai ai zod
```

## Quickstart

```typescript
import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { furlpayTools } from "@furlpay/vercel-ai";

const { text } = await generateText({
  model: anthropic("claude-sonnet-5"),
  tools: furlpayTools(),                 // reads FURLPAY_API_KEY from the env
  maxSteps: 5,
  prompt: "What stablecoins do I hold? Then buy $25 of VOO and pay with USDC.",
});
```

## Tools

All 12 tools are typed AI SDK `tool()`s with Zod schemas: `furlpay_get_wallet_balances`, `furlpay_create_payment`, `furlpay_send_transfer`, `furlpay_place_investment_order`, `furlpay_get_swap_quote`, `furlpay_get_x402_config`, `furlpay_pay_for_resource`, `furlpay_set_agent_budget`, `furlpay_get_agent_budget`, `furlpay_create_x402_paywall`, `furlpay_verify_x402_payment`, `furlpay_settle_x402_payment`.

## Configuration

| Env var | Purpose |
|---|---|
| `FURLPAY_API_KEY` | Your key. Omit for demo mode. |
| `FURLPAY_API_BASE` | Override the API base (default `https://api.furlpay.com/v1`). |

Or pass an explicit client: `furlpayTools({ client: new FurlPayClient({ apiKey: "fp_live_sk_..." }) })`.

## License

MIT © FurlPay
