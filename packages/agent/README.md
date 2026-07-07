# 🤖 FurlPay x402 AI Agent Demo

> **Built for:** Arbitrum Founder House London — July 10-12, 2026
> **Track:** Best Agentic Project ($10K / $6K / $4K)

## What This Is

An AI agent that **autonomously books hotel rooms** by paying USDC on Arbitrum via the **x402 protocol** — the first open HTTP payment standard for machine-to-machine payments.

## How It Works

```
┌─────────────┐     GET /rooms/101      ┌──────────────────┐
│   AI Agent   │ ──────────────────────→ │  Hotel x402 API  │
│  (bookHotel) │                         │  (hotelServer)   │
│              │ ←────────────────────── │                  │
│              │   HTTP 402 + headers:   │                  │
│              │   X-Payment-Amount      │                  │
│              │   X-Payment-Token       │                  │
│              │   X-Payment-Recipient   │                  │
│              │   X-Payment-Facilitator │                  │
│              │                         │                  │
│  Signs EIP-  │                         │                  │
│  3009 USDC   │                         │                  │
│  authz       │                         │                  │
│              │   settle()              │                  │
│              │ ──────────────────────→ ┌──────────────────┐
│              │                         │ X402Facilitator  │
│              │ ←────────────────────── │ (Arbitrum)       │
│              │   tx confirmed (~1s)    └──────────────────┘
│              │                         │                  │
│              │  GET /rooms/101         │                  │
│              │  + X-Payment-Proof: tx  │                  │
│              │ ──────────────────────→ │                  │
│              │ ←────────────────────── │                  │
│              │   200 OK + booking! 🎉  │                  │
└─────────────┘                         └──────────────────┘
```

**Total time: ~3 seconds.** No human intervention. No credit card. No chargebacks.

## Quick Start

```bash
# 1. Install dependencies
cd packages/agent
npm install

# 2. Copy env and fill in your keys
cp .env.example .env
# Edit .env with your Arbitrum Sepolia private key + deployed contract addresses

# 3. Deploy contracts first (from packages/contracts)
cd ../contracts
npm run deploy:sepolia

# 4. Start the hotel demo server
cd ../agent
npx tsx src/hotelServer.ts

# 5. In another terminal, run the AI agent
npx tsx src/bookHotel.ts
```

## Demo Output

```
╔══════════════════════════════════════════════════════════════╗
║   🤖  FurlPay x402 AI Agent                                 ║
║   Protocol: x402/1.0                                         ║
║   Network:  Arbitrum Sepolia                                 ║
║   Task:     Book a hotel room autonomously                   ║
╚══════════════════════════════════════════════════════════════╝

📋 Step 1: Listing available hotels...
   • Tokyo Grand Hotel (Tokyo, Japan) — 250 USDC/night
   • Shoreditch Boutique Hotel (London, UK) — 180 USDC/night
   • Dubai Marina Luxury Resort (Dubai, UAE) — 450 USDC/night

🏨 Step 2: Requesting tokyo-grand room 101...

💳 Step 3: Received HTTP 402 — Payment Required!
   Protocol:    x402/1.0
   Amount:      250 USDC
   Recipient:   0x7099...79C8

🔐 Step 4: Signing EIP-3009 USDC authorization...
   Authorization signed!

⛓️  Step 5: Settling on X402Facilitator (Arbitrum Sepolia)...
   ✅ Settled in block 12345678!

🔄 Step 6: Retrying request with payment proof...

🎉 BOOKING CONFIRMED!
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Booking ID:  BK-1720281600-101
   Hotel:       Tokyo Grand Hotel
   Room:        Deluxe King (#101)
   Paid:        250 USDC
   Settled on:  Arbitrum (Sepolia)
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   The AI agent autonomously booked a hotel room
   by paying USDC on Arbitrum via the x402 protocol.
   No human intervention required. 🤖
```

## x402 Protocol Specification

| Header | Value | Description |
|---|---|---|
| `X-Payment-Required` | `true` | Signals payment is needed |
| `X-Payment-Amount` | `250000000` | Amount in USDC smallest unit (6 decimals) |
| `X-Payment-Token` | `0x75fa...AA4d` | USDC contract address |
| `X-Payment-Recipient` | `0x7099...79C8` | Hotel's wallet address |
| `X-Payment-Network` | `arbitrum-sepolia` | Settlement network |
| `X-Payment-Facilitator` | `0x...` | X402Facilitator contract |
| `X-Payment-Resource-Hash` | `0x...` | keccak256 of the resource URL |
| `X-Payment-Protocol` | `x402/1.0` | Protocol version |

## Contract Architecture

| Contract | Purpose | On-chain |
|---|---|---|
| **X402Facilitator** | Settles EIP-3009 USDC authorizations + indexes by resource | Arbitrum |
| **FurlPayRouter** | EIP-712 signed payment routing with 0.5% fee | Arbitrum |
| **FurlPayEscrow** | Hotel booking escrow with oracle check-in | Arbitrum |
| **BookingReceipt** | ERC-721 proof-of-purchase NFT | Arbitrum |

## Why x402?

HTTP status code **402 Payment Required** was reserved in 1999 for "future use." 
25 years later, FurlPay implements it — enabling any HTTP API to require payment, 
and any AI agent to pay, using stablecoins on Arbitrum.

**This is how the agentic economy pays for things.**

---

*Built with 🖤 for Arbitrum Founder House London 2026*
