# FurlPay for LlamaIndex

Give your [LlamaIndex](https://docs.llamaindex.ai) agents a wallet. This package
exposes the [FurlPay](https://furlpay.com) API as a LlamaIndex **tool spec** — so
an agent can **check balances, create checkouts, move stablecoins, place
investment orders, and pay for x402-protected APIs within a spending budget.**

FurlPay is the open-source financial OS for the agentic internet: stablecoin
payments + the first Solana-native **x402** facilitator. This is the LlamaIndex
binding for it.

Maintained by [FurlPay](https://furlpay.com) · MIT licensed.

## Install

```sh
pip install furlpay-llamaindex
```

## Quickstart

```python
from furlpay_llama import FurlPayToolSpec
from llama_index.core.agent import ReActAgent

tools = FurlPayToolSpec().to_tool_list()   # reads FURLPAY_API_KEY from the environment
agent = ReActAgent.from_tools(tools, llm=llm)
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
| `get_wallet_balances` | Read stablecoin balances across Solana & Base |
| `create_payment` | Create a hosted USDC checkout link |
| `send_transfer` | Send USDC/USDT to an address or FurlPay handle |
| `place_investment_order` | Buy/sell fractional stocks, ETFs, crypto in USDC |
| `get_swap_quote` | Quote a swap, e.g. SOL → USDC |
| `get_x402_config` | Discover x402 chains, tokens, and limits |
| **`pay_for_resource`** ▸ | **Autonomously pay for a 402-gated API within a USDC budget and return its content** |
| `set_agent_budget` | Cap an agent's x402 spend per day/week/month |
| `get_agent_budget` | Read an agent's budget and spend-to-date |
| `create_x402_paywall` | Protect a resource so agents pay per call |
| `verify_x402_payment` | Verify an inbound x402 proof (merchant side) |
| `settle_x402_payment` | Settle a verified x402 payment (merchant side) |

▸ `pay_for_resource` is the headline: it lets an agent *buy* metered data or API
access over [x402](https://furlpay.com/docs/x402) — the payment primitive API keys
can't express — while `set_agent_budget` keeps it from overspending.

## Full agent example

```python
from llama_index.core.agent import ReActAgent
from llama_index.llms.anthropic import Anthropic
from furlpay_llama import FurlPayToolSpec

tools = FurlPayToolSpec().to_tool_list()
agent = ReActAgent.from_tools(tools, llm=Anthropic(model="claude-sonnet-5"), verbose=True)
agent.chat("Buy $25 of VOO and cap my x402 budget at $50/day.")
```

A runnable version is in [`examples/agent.py`](examples/agent.py):

```sh
pip install "furlpay-llamaindex[examples]"
python examples/agent.py
```

## Use an explicit client

```python
from furlpay_llama import FurlPayClient, FurlPayToolSpec

client = FurlPayClient(api_key="fp_live_sk_...", base_url="https://api.furlpay.com/v1")
tools = FurlPayToolSpec(client).to_tool_list()
```

The spec subclasses `BaseToolSpec`, so it also plugs into LlamaIndex workflows,
`FunctionCallingAgent`, and anything else that consumes a tool list.

## Test

```sh
pip install "furlpay-llamaindex[dev]"
python -m pytest tests -q        # or, no pytest:  python tests/test_tool_spec.py
```

The suite runs in demo mode and asserts the tool contract: the spec converts to a
well-formed `FunctionTool` list, every declared `spec_function` is exposed with
metadata, each is callable and returns serialisable output, and the x402 budget
guard refuses to overspend.

## Scope

This package orchestrates FurlPay's public API into LlamaIndex tools. It doesn't
custody funds or sign transactions itself — wallets, MPC custody, brokerage (via
Alpaca), and x402 settlement all happen in the FurlPay API. Point it at your own
FurlPay account and it operates on your data.

## License

MIT
