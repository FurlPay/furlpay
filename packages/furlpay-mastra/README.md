# furlpay-mastra

**FurlPay tools for [Mastra](https://mastra.ai)** — give your Mastra agents stablecoin payments, fractional investing, and [x402](https://furlpay.com/docs/mcp) agentic payment rails.

Runs in **demo mode out of the box** — no FurlPay account needed. Set `FURLPAY_API_KEY` to execute against the live API.

## Install

```bash
npm i furlpay-mastra @mastra/core zod
```

## Quickstart

```typescript
import { Agent } from "@mastra/core/agent";
import { openai } from "@ai-sdk/openai";
import { furlpayTools } from "furlpay-mastra";

const treasurer = new Agent({
  name: "Treasurer",
  instructions: "You manage a FurlPay wallet. Confirm amounts before spending.",
  model: openai("gpt-4o"),
  tools: furlpayTools(),                 // reads FURLPAY_API_KEY from the env
});
```

## Tools

All 12 tools are typed Mastra `createTool`s with Zod schemas: `furlpay_get_wallet_balances`, `furlpay_create_payment`, `furlpay_send_transfer`, `furlpay_place_investment_order`, `furlpay_get_swap_quote`, `furlpay_get_x402_config`, `furlpay_pay_for_resource`, `furlpay_set_agent_budget`, `furlpay_get_agent_budget`, `furlpay_create_x402_paywall`, `furlpay_verify_x402_payment`, `furlpay_settle_x402_payment`.

## Configuration

| Env var | Purpose |
|---|---|
| `FURLPAY_API_KEY` | Your key. Omit for demo mode. |
| `FURLPAY_API_BASE` | Override the API base (default `https://api.furlpay.com/v1`). |

Or pass an explicit client: `furlpayTools({ client: new FurlPayClient({ apiKey: "fp_live_sk_..." }) })`.

## License

MIT © FurlPay
