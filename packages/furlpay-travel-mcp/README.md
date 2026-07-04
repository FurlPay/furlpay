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
        "DUFFEL_API_KEY": "duffel_test_...",     // live flight offers (free test token, duffel.com)
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

## Trusted-agent mode (new in 0.2.0)

Visa's [Trusted Agent Protocol](https://github.com/visa/trusted-agent-protocol) went
production-live in July 2026: agent-initiated payments carry cryptographic proof of
agent identity **and** user consent. This server supports the same model via
[`@furlpay/agent-trust`](https://github.com/FurlPay/agent-trust) — configure a
`MandateVerifier` and every `travel_authorize_booking` call must present a
`mandateToken`: an agent-signed intent under a user-signed spend mandate
(budget cap, MCC allowlist, expiry, single-use, replay-safe).

```ts
import { TravelClient } from "@furlpay/travel-mcp";
import { AgentTrust, generateKeypair, issueMandate, createBookingToken } from "@furlpay/agent-trust";

const trust = new AgentTrust();
trust.registerUser(user.publicKeyPem);
trust.registerAgent(agent.publicKeyPem);

const travel = new TravelClient({ trust }); // bookings now REQUIRE a valid mandateToken

const mandate = issueMandate({ /* user signs: $500 cap, MCC 7011+4511, 7-day expiry */ });
const mandateToken = createBookingToken({ mandate, /* agent signs THIS exact intent */
  intent: { amountUsd: 320, source: "legacy", mcc: "7011" } });

const booking = await travel.authorizeBooking({ amountUsd: 320, source: "legacy", mandateToken });
// booking.trust = { agentKeyId, mandateId, remainingUsd }
```

The verifier checks the full chain — user signed the mandate, mandate names this
agent, agent signed this exact amount/mcc/source, constraints hold, nonce never
seen — before any x402 proof or virtual card is issued. Without a verifier
configured, behavior is unchanged (back-compat).

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

## Live flight data (new in 0.3.0)

Set `DUFFEL_API_KEY` and `travel_search_flights` returns **live real-time
offers** — NDC + GDS + LCC content from 300+ airlines via
[Duffel](https://duffel.com/docs), cheapest first. Free test tokens
(`duffel_test_…`) work out of the box against Duffel's sandbox inventory.
Any Duffel failure falls back to Travala/demo, so the agent loop never breaks.

Why Duffel in mid-2026: Amadeus Self-Service shuts down July 17 2026, Kiwi's
Tequila is closed to new partners, and Expedia/Booking gate API access behind
commercial review — Duffel is the one top-1% supplier a developer can start
on today with no contract.

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
