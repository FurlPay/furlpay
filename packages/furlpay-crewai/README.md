# furlpay-crewai

**FurlPay tools for [CrewAI](https://crewai.com)** — give your multi-agent crews a wallet. Stablecoin payments, fractional investing, and [x402](https://furlpay.com/docs/mcp) agentic payment rails as native CrewAI tools.

Runs in **demo mode out of the box** — no FurlPay account needed. Every tool returns deterministic sample data (and writes *simulate* rather than touch the network), so you can wire a crew up and watch the tool calls end-to-end. Set `FURLPAY_API_KEY` to execute against the live API.

## Install

```bash
pip install furlpay-crewai
```

## Quickstart

```python
from crewai import Agent, Crew, Task
from furlpay_crewai import get_furlpay_tools

treasurer = Agent(
    role="Treasurer",
    goal="Manage the crew's FurlPay wallet.",
    backstory="A meticulous on-chain treasurer.",
    tools=get_furlpay_tools(),        # reads FURLPAY_API_KEY from the env
)

task = Task(
    description="Check our balances, buy $25 of VOO, and cap x402 spend at $50/day.",
    expected_output="Balances, the placed order, and the configured budget.",
    agent=treasurer,
)

Crew(agents=[treasurer], tasks=[task]).kickoff()
```

Or the roadmap ergonomics:

```python
from furlpay_crewai import FurlPayTools

agent = Agent(role="Treasurer", goal="...", backstory="...", tools=FurlPayTools.all())
```

## Tools

All 12 tools are typed CrewAI `BaseTool`s with Pydantic arg schemas:

| Tool | What it does |
|---|---|
| `furlpay_get_wallet_balances` | Stablecoin balances across chains (USDC/USDT on Solana, Base) |
| `furlpay_create_payment` | Create a hosted stablecoin checkout link |
| `furlpay_send_transfer` | Send stablecoins to an address or FurlPay handle |
| `furlpay_place_investment_order` | Fractional stock/ETF/crypto order funded in USDC |
| `furlpay_get_swap_quote` | Quote a crypto/stablecoin swap (e.g. SOL→USDC) |
| `furlpay_get_x402_config` | x402 facilitator config: chains, tokens, limits |
| `furlpay_pay_for_resource` | Autonomously pay an x402 (HTTP 402) resource within a USDC budget |
| `furlpay_set_agent_budget` | Cap an agent's x402 spend per period |
| `furlpay_get_agent_budget` | Read an agent's budget and spend-so-far |
| `furlpay_create_x402_paywall` | Protect a resource behind an x402 paywall |
| `furlpay_verify_x402_payment` | Verify an inbound x402 payment proof (merchant) |
| `furlpay_settle_x402_payment` | Settle a verified x402 payment on-chain (merchant) |

## Configuration

| Env var | Purpose |
|---|---|
| `FURLPAY_API_KEY` | Your key. Omit for demo mode. |
| `FURLPAY_API_BASE` | Override the API base (default `https://api.furlpay.com/v1`). |

Or pass an explicit client:

```python
from furlpay_crewai import FurlPayClient, get_furlpay_tools
tools = get_furlpay_tools(FurlPayClient(api_key="fp_live_sk_..."))
```

## Related

- [`furlpay-langchain`](https://pypi.org/project/furlpay-langchain/) — the same toolset for LangChain / LangGraph
- [`furlpay-llamaindex`](https://pypi.org/project/furlpay-llamaindex/) — the same toolset for LlamaIndex

## License

MIT © FurlPay
