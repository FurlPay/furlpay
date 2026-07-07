# furlpay-openai-agents

**FurlPay tools for the [OpenAI Agents SDK](https://openai.github.io/openai-agents-python/)** — stablecoin payments, fractional investing, and [x402](https://furlpay.com/docs/mcp) agentic payment rails as native `FunctionTool`s.

Runs in **demo mode out of the box** — no FurlPay account needed. Set `FURLPAY_API_KEY` to execute against the live API.

## Install

```bash
pip install furlpay-openai-agents
```

## Quickstart

```python
from agents import Agent, Runner
from furlpay_openai_agents import get_furlpay_tools

agent = Agent(
    name="Treasurer",
    instructions="You manage a FurlPay wallet. Confirm amounts before spending.",
    tools=get_furlpay_tools(),          # reads FURLPAY_API_KEY from the env
)

result = Runner.run_sync(agent, "What stablecoins do I hold? Then buy $25 of VOO.")
print(result.final_output)
```

## Tools

All 12 tools are typed `FunctionTool`s: `furlpay_get_wallet_balances`, `furlpay_create_payment`, `furlpay_send_transfer`, `furlpay_place_investment_order`, `furlpay_get_swap_quote`, `furlpay_get_x402_config`, `furlpay_pay_for_resource`, `furlpay_set_agent_budget`, `furlpay_get_agent_budget`, `furlpay_create_x402_paywall`, `furlpay_verify_x402_payment`, `furlpay_settle_x402_payment`.

## Configuration

| Env var | Purpose |
|---|---|
| `FURLPAY_API_KEY` | Your key. Omit for demo mode. |
| `FURLPAY_API_BASE` | Override the API base (default `https://api.furlpay.com/v1`). |

Or pass an explicit client: `get_furlpay_tools(FurlPayClient(api_key="fp_live_sk_..."))`.

## Related

[`furlpay-langchain`](https://pypi.org/project/furlpay-langchain/) · [`furlpay-llamaindex`](https://pypi.org/project/furlpay-llamaindex/) · [`furlpay-crewai`](https://pypi.org/project/furlpay-crewai/)

## License

MIT © FurlPay
