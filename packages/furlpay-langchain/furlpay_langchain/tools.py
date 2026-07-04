"""
FurlPay tools for LangChain.

    from furlpay_langchain import get_furlpay_tools
    tools = get_furlpay_tools()            # reads FURLPAY_API_KEY from the env
    # ...or bind an explicit client:
    from furlpay_langchain import FurlPayClient
    tools = get_furlpay_tools(FurlPayClient(api_key="fp_live_sk_..."))

Each tool is a `StructuredTool` with a typed Pydantic args schema, so it works
with `create_tool_calling_agent`, `llm.bind_tools(...)`, LangGraph, and any other
LangChain surface that consumes `BaseTool`.
"""

from __future__ import annotations

from typing import List, Optional

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from .client import FurlPayClient


# -- args schemas -----------------------------------------------------------

class _NoArgs(BaseModel):
    pass


class CreatePaymentArgs(BaseModel):
    amount: float = Field(..., description="Amount to charge, in the given currency.")
    currency: str = Field("USDC", description="Settlement currency, e.g. USDC or USDT.")
    description: str = Field("", description="Human-readable description shown on the checkout.")


class SendTransferArgs(BaseModel):
    to: str = Field(..., description="Recipient wallet address or FurlPay handle.")
    amount: float = Field(..., description="Amount of the token to send.")
    token: str = Field("USDC", description="Token symbol, e.g. USDC.")


class InvestmentOrderArgs(BaseModel):
    symbol: str = Field(..., description="Ticker to trade, e.g. AAPL, VOO, BTC.")
    side: str = Field(..., description="'buy' or 'sell'.")
    notional: float = Field(..., description="USD notional to buy/sell (fractional allowed).")


class SwapQuoteArgs(BaseModel):
    from_token: str = Field(..., description="Token to sell, e.g. SOL.")
    to_token: str = Field(..., description="Token to receive, e.g. USDC.")
    amount: float = Field(..., description="Amount of from_token to swap.")


class AgentIdArgs(BaseModel):
    agent_id: str = Field(..., description="Identifier of the AI agent.")


class SetAgentBudgetArgs(BaseModel):
    agent_id: str = Field(..., description="Identifier of the AI agent to cap.")
    limit: float = Field(..., description="Spend cap in USDC for the period.")
    period: str = Field("daily", description="'daily', 'weekly', or 'monthly'.")


class CreatePaywallArgs(BaseModel):
    resource: str = Field(..., description="Path/URL of the resource to protect, e.g. /api/premium/quote.")
    price: float = Field(..., description="Price per call, in USDC.")
    network: str = Field("solana", description="Settlement network: 'solana' or 'base'.")


class ProofArgs(BaseModel):
    payment_proof: str = Field(..., description="The x402 payment proof / X-PAYMENT header value.")


class PayForResourceArgs(BaseModel):
    url: str = Field(..., description="URL of the x402-protected (HTTP 402) resource to fetch.")
    max_amount: float = Field(1.0, description="Maximum USDC the agent may spend on this call.")
    agent_id: str = Field("agent_default", description="Agent identity for budget accounting.")


# -- factory ----------------------------------------------------------------

def get_furlpay_tools(client: Optional[FurlPayClient] = None) -> List[StructuredTool]:
    """Return the FurlPay LangChain toolset. Uses env config if no client is passed."""
    c = client or FurlPayClient.from_env()

    return [
        StructuredTool.from_function(
            name="furlpay_get_wallet_balances",
            description="Get the FurlPay account's stablecoin balances across chains (USDC/USDT on Solana, Base).",
            args_schema=_NoArgs,
            func=lambda: c.wallet_balances(),
        ),
        StructuredTool.from_function(
            name="furlpay_create_payment",
            description="Create a hosted stablecoin checkout and return a payment/checkout link.",
            args_schema=CreatePaymentArgs,
            func=lambda amount, currency="USDC", description="": c.create_payment(amount, currency, description),
        ),
        StructuredTool.from_function(
            name="furlpay_send_transfer",
            description="Send stablecoins from the FurlPay wallet to an address or FurlPay handle.",
            args_schema=SendTransferArgs,
            func=lambda to, amount, token="USDC": c.send_transfer(to, amount, token),
        ),
        StructuredTool.from_function(
            name="furlpay_place_investment_order",
            description="Place a fractional stock/ETF/crypto order funded in USDC (via Alpaca).",
            args_schema=InvestmentOrderArgs,
            func=lambda symbol, side, notional: c.place_investment_order(symbol, side, notional),
        ),
        StructuredTool.from_function(
            name="furlpay_get_swap_quote",
            description="Quote a stablecoin/crypto swap, e.g. SOL to USDC.",
            args_schema=SwapQuoteArgs,
            func=lambda from_token, to_token, amount: c.swap_quote(from_token, to_token, amount),
        ),
        StructuredTool.from_function(
            name="furlpay_get_x402_config",
            description="Get the x402 facilitator config: supported chains, tokens, limits, replay tolerance.",
            args_schema=_NoArgs,
            func=lambda: c.x402_config(),
        ),
        StructuredTool.from_function(
            name="furlpay_pay_for_resource",
            description=(
                "Autonomously pay for an x402-protected (HTTP 402) API/resource within a USDC budget and "
                "return its content. This is how an agent buys metered data or API calls."
            ),
            args_schema=PayForResourceArgs,
            func=lambda url, max_amount=1.0, agent_id="agent_default": c.pay_for_resource(url, max_amount, agent_id),
        ),
        StructuredTool.from_function(
            name="furlpay_set_agent_budget",
            description="Set a spending cap (USDC per period) for an AI agent's x402 payments.",
            args_schema=SetAgentBudgetArgs,
            func=lambda agent_id, limit, period="daily": c.set_agent_budget(agent_id, limit, period),
        ),
        StructuredTool.from_function(
            name="furlpay_get_agent_budget",
            description="Get an AI agent's x402 spending budget and amount spent so far.",
            args_schema=AgentIdArgs,
            func=lambda agent_id: c.agent_budget(agent_id),
        ),
        StructuredTool.from_function(
            name="furlpay_create_x402_paywall",
            description="Protect a resource with an x402 paywall so agents pay per call in USDC.",
            args_schema=CreatePaywallArgs,
            func=lambda resource, price, network="solana": c.create_x402_paywall(resource, price, network),
        ),
        StructuredTool.from_function(
            name="furlpay_verify_x402_payment",
            description="Verify an inbound x402 payment proof (merchant side).",
            args_schema=ProofArgs,
            func=lambda payment_proof: c.verify_x402_payment(payment_proof),
        ),
        StructuredTool.from_function(
            name="furlpay_settle_x402_payment",
            description="Settle a verified x402 payment on-chain (merchant side).",
            args_schema=ProofArgs,
            func=lambda payment_proof: c.settle_x402_payment(payment_proof),
        ),
    ]
