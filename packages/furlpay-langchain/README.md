# FurlPay for LangChain

Give your [LangChain](https://python.langchain.com) agents a wallet. This package
exposes the [FurlPay](https://furlpay.com) API as a set of typed LangChain tools —
so an agent can **check balances, create checkouts, move stablecoins, place
investment orders, and pay for x402-protected APIs within a spending budget.**

FurlPay is the open-source financial OS for the agentic internet: stablecoin
payments + the first Solana-native **x402** facilitator. This is the LangChain
binding for it.

Maintained by [FurlPay](https://furlpay.com) · MIT licensed.

## Install

```sh
pip install furlpay-langchain
```

## Quickstart

```python
from furlpay_langchain import get_furlpay_tools

tools = get_furlpay_tools()          # reads FURLPAY_API_KEY from the environment
llm_with_tools = llm.bind_tools(tools)
```

Zero-config: **with no `FURLPAY_API_KEY` set, every tool runs in demo mode** —
reads return deterministic sample data and writes *simulate* without touching the
network. Wire up your agent and watch the tool calls before you ever create an
account. Set the key to go live against `https://api.furlpay.com/v1`.

```sh
export FURLPAY_API_KEY=fp_live_sk_...          # optional; omit for demo mode
export FURLPAY_API_BASE=https://sandbox.api.furlpay.com/v1   # optional sandbox
```

## Tools

| Tool | What the agent can do |
| --- | --- |
| `furlpay_get_wallet_balances` | Read stablecoin balances across Solana & Base |
| `furlpay_create_payment` | Create a hosted USDC checkout link |
| `furlpay_send_transfer` | Send USDC/USDT to an address or FurlPay handle |
| `furlpay_place_investment_order` | Buy/sell fractional stocks, ETFs, crypto in USDC |
| `furlpay_get_swap_quote` | Quote a swap, e.g. SOL → USDC |
| `furlpay_get_x402_config` | Discover x402 chains, tokens, and limits |
| **`furlpay_pay_for_resource`** ⚡ | **Autonomously pay for a 402-gated API within a USDC budget and return its content** |
| `furlpay_set_agent_budget` | Cap an agent's x402 spend per day/week/month |
| `furlpay_get_agent_budget` | Read an agent's budget and spend-to-date |
| `furlpay_create_x402_paywall` | Protect a resource so agents pay per call |
| `furlpay_verify_x402_payment` | Verify an inbound x402 proof (merchant side) |
| `furlpay_settle_x402_payment` | Settle a verified x402 payment (merchant side) |

⚡ `furlpay_pay_for_resource` is the headline: it lets an agent *buy* metered data
or API access over [x402](https://furlpay.com/docs/x402) — the payment primitive
API keys can't express — while `set_agent_budget` keeps it from overspending.

## Full agent example

```python
from langchain.agents import AgentExecutor, create_tool_calling_agent
from langchain_anthropic import ChatAnthropic
from langchain_core.prompts import ChatPromptTemplate
from furlpay_langchain import get_furlpay_tools

tools = get_furlpay_tools()
llm = ChatAnthropic(model="claude-sonnet-5", temperature=0)
prompt = ChatPromptTemplate.from_messages([
    ("system", "You are a treasury agent with a FurlPay wallet."),
    ("human", "{input}"),
    ("placeholder", "{agent_scratchpad}"),
])
executor = AgentExecutor(agent=create_tool_calling_agent(llm, tools, prompt), tools=tools)
executor.invoke({"input": "Buy $25 of VOO and cap my x402 budget at $50/day."})
```

A runnable version is in [`examples/agent.py`](examples/agent.py):

```sh
pip install "furlpay-langchain[examples]"
python examples/agent.py
```

## Use an explicit client

```python
from furlpay_langchain import FurlPayClient, get_furlpay_tools

client = FurlPayClient(api_key="fp_live_sk_...", base_url="https://api.furlpay.com/v1")
tools = get_furlpay_tools(client)
```

Also works with **LangGraph** and anything else that accepts `BaseTool` — the
tools are standard `StructuredTool`s with Pydantic argument schemas.

## Test

```sh
pip install "furlpay-langchain[dev]"
python -m pytest tests -q        # or, no pytest:  python tests/test_tools.py
```

The suite runs in demo mode and asserts the tool contract: every tool is a
well-formed `StructuredTool`, names are unique and namespaced, each is invocable
and returns serialisable output, and the x402 budget guard refuses to overspend.

## Scope

This package orchestrates FurlPay's public API into LangChain tools. It doesn't
custody funds or sign transactions itself — wallets, MPC custody, brokerage (via
Alpaca), and x402 settlement all happen in the FurlPay API. Point it at your own
FurlPay account and it operates on your data.

## License

MIT
