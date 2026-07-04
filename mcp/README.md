# @furlpay/mcp-server

Model Context Protocol server exposing Furlpay tools to AI assistants — let Claude, Cursor, and any MCP client check balances, quote swaps, place orders, and run compliance checks against your Furlpay account.

[![npm](https://img.shields.io/npm/v/%40furlpay%2Fmcp-server)](https://www.npmjs.com/package/@furlpay/mcp-server)

Self-contained: stdio transport, JSON-RPC 2.0, zero dependencies, no SDK required.

## Setup

### Claude Desktop / Claude Code

Add to `claude_desktop_config.json` (or `.mcp.json` in a Claude Code project):

```json
{
  "mcpServers": {
    "furlpay": {
      "command": "npx",
      "args": ["-y", "@furlpay/mcp-server"],
      "env": {
        "FURLPAY_API_KEY": "sk_sandbox_...",
        "FURLPAY_BASE_URL": "https://api.furlpay.app"
      }
    }
  }
}
```

### Cursor

Settings → MCP → Add server, command: `npx -y @furlpay/mcp-server`.

## Tools

| Tool | What it does |
| --- | --- |
| `get_wallet_balances` | Safe smart-account stablecoin balances and active modules |
| `quote_swap` | Cheapest cross-chain stablecoin swap route (Li.Fi / 1inch) |
| `place_investment_order` | Fractional stock/ETF order (Alpaca) — `symbol`, `side`, `notional` |
| `screen_wallet_risk` | AML-screen a wallet address (Chainalysis / TRM), returns a risk verdict |
| `verify_identity` | KYC identity check (Persona / Sumsub) |

## Try it

Ask your assistant:

> "What's my Furlpay wallet balance?"
>
> "Quote swapping 100 USDT on Base to USDC."
>
> "Screen wallet `9x…` for AML risk before I pay it."

## Safety

- Use a **sandbox key** (`sk_sandbox_...`) while experimenting — the agent inherits every permission the key has.
- For real funds, pair with bounded allowances ([Account Kit escrow](https://www.npmjs.com/package/@furlpay/account-kit)) and spend caps — never hand an agent an unlimited key.
- `FURLPAY_BASE_URL` defaults to `http://localhost:3000` for local development; point it at production explicitly.

## Related

[furlpay-examples/ai-agent-mcp](https://github.com/furlpay/furlpay-examples/tree/main/ai-agent-mcp) — full agent setup walkthrough · [furlpay-x402](https://github.com/furlpay/furlpay-x402) — per-request agent payments over HTTP 402.

## Security

Report vulnerabilities to hello@furlpay.com — please don't open public issues.

## License

MIT
