"""
FurlPay tools for CrewAI.

    from furlpay_crewai import get_furlpay_tools
    tools = get_furlpay_tools()              # reads FURLPAY_API_KEY from the env
    # ...or bind an explicit client:
    from furlpay_crewai import FurlPayClient
    tools = get_furlpay_tools(FurlPayClient(api_key="fp_live_sk_..."))

    # Give a crew member a wallet:
    from crewai import Agent
    treasurer = Agent(role="Treasurer", goal="...", backstory="...", tools=tools)

Each tool is a `crewai.tools.BaseTool` with a typed Pydantic `args_schema`, so it
registers with any CrewAI Agent/Crew and is called by the LLM with validated
arguments. In demo mode (no FURLPAY_API_KEY) every call returns deterministic
sample data, so a crew can be wired up and observed without an account.
"""

from __future__ import annotations

import json
from typing import List, Optional, Type

from crewai.tools import BaseTool
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


# -- base wrapper -----------------------------------------------------------

def _dump(result) -> str:
    """CrewAI tools return strings to the LLM; serialise dict/list results as JSON."""
    if isinstance(result, str):
        return result
    try:
        return json.dumps(result, default=str)
    except TypeError:
        return str(result)


class _FurlPayTool(BaseTool):
    """Base for FurlPay CrewAI tools — carries the shared client."""

    client: FurlPayClient
    # Subclasses set name / description / args_schema and implement _call.

    def _run(self, **kwargs) -> str:  # noqa: D401 - CrewAI entrypoint
        return _dump(self._call(**kwargs))

    def _call(self, **kwargs):  # pragma: no cover - overridden
        raise NotImplementedError


# -- concrete tools ---------------------------------------------------------

class GetWalletBalancesTool(_FurlPayTool):
    name: str = "furlpay_get_wallet_balances"
    description: str = "Get the FurlPay account's stablecoin balances across chains (USDC/USDT on Solana, Base)."
    args_schema: Type[BaseModel] = _NoArgs

    def _call(self):
        return self.client.wallet_balances()


class CreatePaymentTool(_FurlPayTool):
    name: str = "furlpay_create_payment"
    description: str = "Create a hosted stablecoin checkout and return a payment/checkout link."
    args_schema: Type[BaseModel] = CreatePaymentArgs

    def _call(self, amount: float, currency: str = "USDC", description: str = ""):
        return self.client.create_payment(amount, currency, description)


class SendTransferTool(_FurlPayTool):
    name: str = "furlpay_send_transfer"
    description: str = "Send stablecoins from the FurlPay wallet to an address or FurlPay handle."
    args_schema: Type[BaseModel] = SendTransferArgs

    def _call(self, to: str, amount: float, token: str = "USDC"):
        return self.client.send_transfer(to, amount, token)


class PlaceInvestmentOrderTool(_FurlPayTool):
    name: str = "furlpay_place_investment_order"
    description: str = "Place a fractional stock/ETF/crypto order funded in USDC (via Alpaca)."
    args_schema: Type[BaseModel] = InvestmentOrderArgs

    def _call(self, symbol: str, side: str, notional: float):
        return self.client.place_investment_order(symbol, side, notional)


class GetSwapQuoteTool(_FurlPayTool):
    name: str = "furlpay_get_swap_quote"
    description: str = "Quote a stablecoin/crypto swap, e.g. SOL to USDC."
    args_schema: Type[BaseModel] = SwapQuoteArgs

    def _call(self, from_token: str, to_token: str, amount: float):
        return self.client.swap_quote(from_token, to_token, amount)


class GetX402ConfigTool(_FurlPayTool):
    name: str = "furlpay_get_x402_config"
    description: str = "Get the x402 facilitator config: supported chains, tokens, limits, replay tolerance."
    args_schema: Type[BaseModel] = _NoArgs

    def _call(self):
        return self.client.x402_config()


class PayForResourceTool(_FurlPayTool):
    name: str = "furlpay_pay_for_resource"
    description: str = (
        "Autonomously pay for an x402-protected (HTTP 402) API/resource within a USDC budget and "
        "return its content. This is how an agent buys metered data or API calls."
    )
    args_schema: Type[BaseModel] = PayForResourceArgs

    def _call(self, url: str, max_amount: float = 1.0, agent_id: str = "agent_default"):
        return self.client.pay_for_resource(url, max_amount, agent_id)


class SetAgentBudgetTool(_FurlPayTool):
    name: str = "furlpay_set_agent_budget"
    description: str = "Set a spending cap (USDC per period) for an AI agent's x402 payments."
    args_schema: Type[BaseModel] = SetAgentBudgetArgs

    def _call(self, agent_id: str, limit: float, period: str = "daily"):
        return self.client.set_agent_budget(agent_id, limit, period)


class GetAgentBudgetTool(_FurlPayTool):
    name: str = "furlpay_get_agent_budget"
    description: str = "Get an AI agent's x402 spending budget and amount spent so far."
    args_schema: Type[BaseModel] = AgentIdArgs

    def _call(self, agent_id: str):
        return self.client.agent_budget(agent_id)


class CreateX402PaywallTool(_FurlPayTool):
    name: str = "furlpay_create_x402_paywall"
    description: str = "Protect a resource with an x402 paywall so agents pay per call in USDC."
    args_schema: Type[BaseModel] = CreatePaywallArgs

    def _call(self, resource: str, price: float, network: str = "solana"):
        return self.client.create_x402_paywall(resource, price, network)


class VerifyX402PaymentTool(_FurlPayTool):
    name: str = "furlpay_verify_x402_payment"
    description: str = "Verify an inbound x402 payment proof (merchant side)."
    args_schema: Type[BaseModel] = ProofArgs

    def _call(self, payment_proof: str):
        return self.client.verify_x402_payment(payment_proof)


class SettleX402PaymentTool(_FurlPayTool):
    name: str = "furlpay_settle_x402_payment"
    description: str = "Settle a verified x402 payment on-chain (merchant side)."
    args_schema: Type[BaseModel] = ProofArgs

    def _call(self, payment_proof: str):
        return self.client.settle_x402_payment(payment_proof)


# -- factory ----------------------------------------------------------------

_TOOL_CLASSES = [
    GetWalletBalancesTool,
    CreatePaymentTool,
    SendTransferTool,
    PlaceInvestmentOrderTool,
    GetSwapQuoteTool,
    GetX402ConfigTool,
    PayForResourceTool,
    SetAgentBudgetTool,
    GetAgentBudgetTool,
    CreateX402PaywallTool,
    VerifyX402PaymentTool,
    SettleX402PaymentTool,
]


def get_furlpay_tools(client: Optional[FurlPayClient] = None) -> List[BaseTool]:
    """Return the FurlPay CrewAI toolset. Uses env config if no client is passed."""
    c = client or FurlPayClient.from_env()
    return [cls(client=c) for cls in _TOOL_CLASSES]


class FurlPayTools:
    """Convenience accessor mirroring the roadmap ergonomics: ``FurlPayTools.all()``."""

    @staticmethod
    def all(client: Optional[FurlPayClient] = None) -> List[BaseTool]:
        return get_furlpay_tools(client)
