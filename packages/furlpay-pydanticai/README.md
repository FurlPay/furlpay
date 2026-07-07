# furlpay-pydanticai

**FurlPay tools for [Pydantic AI](https://ai.pydantic.dev)** — stablecoin payments, fractional investing, and [x402](https://furlpay.com/docs/mcp) agentic payment rails as native, type-safe `Tool`s.

Runs in **demo mode out of the box** — no FurlPay account needed. Set `FURLPAY_API_KEY` to execute against the live API.

## Install

```bash
pip install furlpay-pydanticai
```

## Quickstart

```python
from pydantic_ai import Agent
from furlpay_pydanticai import get_furlpay_tools

agent = Agent(
    "openai:gpt-4o",
    system_prompt="You manage a FurlPay wallet. Confirm amounts before spending.",
    tools=get_furlpay_tools(),          # reads FURLPAY_API_KEY from the env
)

print(agent.run_sync("What stablecoins do I hold? Then buy $25 of VOO.").output)
```

## Tools

All 12 tools are typed `pydantic_ai.Tool`s: `furlpay_get_wallet_balances`, `furlpay_create_payment`, `furlpay_send_transfer`, `furlpay_place_investment_order`, `furlpay_get_swap_quote`, `furlpay_get_x402_config`, `furlpay_pay_for_resource`, `furlpay_set_agent_budget`, `furlpay_get_agent_budget`, `furlpay_create_x402_paywall`, `furlpay_verify_x402_payment`, `furlpay_settle_x402_payment`.

## Configuration

| Env var | Purpose |
|---|---|
| `FURLPAY_API_KEY` | Your key. Omit for demo mode. |
| `FURLPAY_API_BASE` | Override the API base (default `https://api.furlpay.com/v1`). |

Or pass an explicit client: `get_furlpay_tools(FurlPayClient(api_key="fp_live_sk_..."))`.

## Related

[`furlpay-langchain`](https://pypi.org/project/furlpay-langchain/) · [`furlpay-llamaindex`](https://pypi.org/project/furlpay-llamaindex/) · [`furlpay-crewai`](https://pypi.org/project/furlpay-crewai/) · [`furlpay-openai-agents`](https://pypi.org/project/furlpay-openai-agents/)

## License

MIT © FurlPay
