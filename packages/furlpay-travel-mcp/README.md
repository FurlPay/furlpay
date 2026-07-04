# @furlpay/travel-mcp — FurlPay Travels

The payment & orchestration layer for **agentic travel**. This MCP server composes
[Travala's Travel MCP](https://www.travala.com/blog/introducing-travalas-agentic-ai-travel-protocol/)
(search 2.2M+ hotels + flights) with [FurlPay](https://furlpay.com)'s payment rails
(pay), so an AI agent can **search, budget-check, pay, and book travel autonomously.**

Two payment routes, chosen per booking:

- **Travala / crypto-native** → an **x402 payment proof**, settled in gasless
  **USDC on Base**. Accrues the **10% cbBTC developer rebate** Travala pays on
  MCP-driven bookings.
- **Legacy Web2 merchant** (Airbnb, Skyscanner…) → a **single-use Visa virtual
  card**, **MCC-locked** to travel and limited to the booking total.

**Clone-and-run**: with no keys, search and payment simulate end-to-end (no
network) so you can drive the whole loop offline. Zero runtime dependencies.

Maintained by [FurlPay](https://furlpay.com) · MIT licensed.

## Use as an MCP server

```jsonc
{
  "mcpServers": {
    "furlpay-travels": {
      "command": "npx",
      "args": ["-y", "@furlpay/travel-mcp"],
      "env": {
        "FURLPAY_API_KEY": "fp_live_sk_...",     // omit for demo mode
        "TRAVALA_API_KEY": "...",                // omit for demo inventory
        "FURLPAY_DEVELOPER_WALLET": "0xYourWallet" // receives the 7% cbBTC split
      }
    }
  }
}
```

### Tools

| Tool | What it does |
| --- | --- |
| `travel_search_stays` | Search Travala hotels for a city + date range |
| `travel_search_flights` | Search flights for a route + date |
| `travel_set_agent_budget` | Cap an agent's USDC travel spend |
| **`travel_authorize_booking`** | Pay a booking — x402/USDC (Travala) **or** single-use MCC-locked Visa VCN (legacy) |
| `travel_confirm_booking` | Confirm after passkey step-up |
| `travel_cancel_booking` | Cancel & void the authorization |
| `travel_list_rebates` | Accumulated 10% cbBTC rebates (7% dev / 3% treasury) |

## Use as a library

```ts
import { TravelClient, MCC } from "@furlpay/travel-mcp";

const travel = new TravelClient({ developerWallet: "0xDev" });

const stays = await travel.searchStays({
  city: "London", checkIn: "2026-08-01", checkOut: "2026-08-04", maxNightlyUsd: 200,
});

travel.setAgentBudget("agent_1", 1000);

// Crypto-native route → x402/USDC on Base + 10% cbBTC rebate
const booking = await travel.authorizeBooking({
  amountUsd: stays[0].totalUsd, source: "travala", agentId: "agent_1", reference: stays[0].quoteId,
});
// booking.authorization.x402  ·  booking.rebate.developerUsd

// Legacy merchant route → single-use MCC-locked Visa VCN
const legacy = await travel.authorizeBooking({ amountUsd: 130, source: "legacy", mcc: MCC.LODGING });
// legacy.authorization.card = { last4, mccWhitelist, singleUse, limitUsd }

travel.listRebates();   // { developerTotalUsd, treasuryTotalUsd, accruals }
```

## How the routes map to reality

| Route | Rail | Why |
| --- | --- | --- |
| `travala` | x402 → gasless USDC on **Base**, ~$0.01/booking | The rail Travala's protocol accepts directly; earns the cbBTC rebate |
| `legacy` | Single-use **Visa VCN**, MCC-locked (7011 lodging, 4511 airlines, 7512 car rental) | Reaches Web2 travel merchants Travala doesn't cover; card can only spend on travel, up to the booking total |

FurlPay's value here is the layer Travala doesn't provide: **agent spend budgets,
multi-token funding, VCN issuing for legacy merchants, and rebate accounting.**

## Run the demo

```sh
npm run example        # full search → pay → book → rebate flow, demo mode
npm start              # run the MCP server on stdio
```

## Test

```sh
npm test               # tsc build + node --test (demo mode, no network)
```

The suite pins the contract: deterministic search, the x402 route's proof + exact
10%/(7/3) rebate math, the legacy route's single-use MCC-locked VCN, budget
enforcement, the confirm/cancel lifecycle, rebate aggregation (excluding
cancellations), and well-formed MCP tools.

## Scope

This server orchestrates Travala search and FurlPay payments — it does not custody
funds or settle on-chain itself; x402 settlement and card issuing happen in the
FurlPay API, and inventory/fulfilment in Travala. Point it at your own accounts and
it books on your behalf. Issuing travel cards and handling refunds carries
money-transmission/merchant-compliance obligations — wire in FurlPay's compliance
engine before going live.

## License

MIT
