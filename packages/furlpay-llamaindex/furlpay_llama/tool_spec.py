"""
FurlPay tool spec for LlamaIndex.

    from furlpay_llama import FurlPayToolSpec
    tools = FurlPayToolSpec().to_tool_list()      # reads FURLPAY_API_KEY from the env

    from llama_index.core.agent import ReActAgent
    agent = ReActAgent.from_tools(tools, llm=llm)

Each public method below becomes a LlamaIndex FunctionTool; its docstring and type
hints are what the LLM sees when deciding to call it, so they are written for the
model. With no FURLPAY_API_KEY set, everything runs in demo mode.
"""

from __future__ import annotations

from typing import List, Optional

from llama_index.core.tools.tool_spec.base import BaseToolSpec

from .client import FurlPayClient


class FurlPayToolSpec(BaseToolSpec):
    """LlamaIndex tools for FurlPay — stablecoin payments, investing, and x402 agent rails."""

    spec_functions = [
        "get_wallet_balances",
        "create_payment",
        "send_transfer",
        "place_investment_order",
        "get_swap_quote",
        "get_x402_config",
        "pay_for_resource",
        "set_agent_budget",
        "get_agent_budget",
        "create_x402_paywall",
        "verify_x402_payment",
        "settle_x402_payment",
    ]

    def __init__(self, client: Optional[FurlPayClient] = None) -> None:
        self._client = client or FurlPayClient.from_env()

    # -- reads --------------------------------------------------------------

    def get_wallet_balances(self) -> List[dict]:
        """Get the FurlPay account's stablecoin balances across chains (USDC/USDT on Solana and Base)."""
        return self._client.wallet_balances()

    def get_x402_config(self) -> dict:
        """Get the x402 facilitator config: supported chains, tokens, max amount, and replay tolerance."""
        return self._client.x402_config()

    def get_agent_budget(self, agent_id: str) -> dict:
        """Get an AI agent's x402 spending budget and how much it has spent so far.

        Args:
            agent_id: Identifier of the AI agent.
        """
        return self._client.agent_budget(agent_id)

    def get_swap_quote(self, from_token: str, to_token: str, amount: float) -> dict:
        """Quote a stablecoin/crypto swap, e.g. SOL to USDC.

        Args:
            from_token: Token to sell, e.g. SOL.
            to_token: Token to receive, e.g. USDC.
            amount: Amount of from_token to swap.
        """
        return self._client.swap_quote(from_token, to_token, amount)

    # -- writes (execution) -------------------------------------------------

    def create_payment(self, amount: float, currency: str = "USDC", description: str = "") -> dict:
        """Create a hosted stablecoin checkout and return a payment link.

        Args:
            amount: Amount to charge, in the given currency.
            currency: Settlement currency, e.g. USDC or USDT.
            description: Human-readable description shown on the checkout.
        """
        return self._client.create_payment(amount, currency, description)

    def send_transfer(self, to: str, amount: float, token: str = "USDC") -> dict:
        """Send stablecoins from the FurlPay wallet to an address or FurlPay handle.

        Args:
            to: Recipient wallet address or FurlPay handle.
            amount: Amount of the token to send.
            token: Token symbol, e.g. USDC.
        """
        return self._client.send_transfer(to, amount, token)

    def place_investment_order(self, symbol: str, side: str, notional: float) -> dict:
        """Place a fractional stock/ETF/crypto order funded in USDC (via Alpaca).

        Args:
            symbol: Ticker to trade, e.g. AAPL, VOO, BTC.
            side: 'buy' or 'sell'.
            notional: USD notional to buy/sell (fractional allowed).
        """
        return self._client.place_investment_order(symbol, side, notional)

    def pay_for_resource(self, url: str, max_amount: float = 1.0, agent_id: str = "agent_default") -> dict:
        """Autonomously pay for an x402-protected (HTTP 402) API/resource within a USDC budget and return its content.

        This is how an agent buys metered data or API access that a plain API key can't express.

        Args:
            url: URL of the x402-protected resource to fetch.
            max_amount: Maximum USDC the agent may spend on this call.
            agent_id: Agent identity for budget accounting.
        """
        return self._client.pay_for_resource(url, max_amount, agent_id)

    def set_agent_budget(self, agent_id: str, limit: float, period: str = "daily") -> dict:
        """Set a spending cap (USDC per period) for an AI agent's x402 payments.

        Args:
            agent_id: Identifier of the AI agent to cap.
            limit: Spend cap in USDC for the period.
            period: 'daily', 'weekly', or 'monthly'.
        """
        return self._client.set_agent_budget(agent_id, limit, period)

    def create_x402_paywall(self, resource: str, price: float, network: str = "solana") -> dict:
        """Protect a resource with an x402 paywall so agents pay per call in USDC.

        Args:
            resource: Path/URL of the resource to protect, e.g. /api/premium/quote.
            price: Price per call, in USDC.
            network: Settlement network: 'solana' or 'base'.
        """
        return self._client.create_x402_paywall(resource, price, network)

    def verify_x402_payment(self, payment_proof: str) -> dict:
        """Verify an inbound x402 payment proof (merchant side).

        Args:
            payment_proof: The x402 payment proof / X-PAYMENT header value.
        """
        return self._client.verify_x402_payment(payment_proof)

    def settle_x402_payment(self, payment_proof: str) -> dict:
        """Settle a verified x402 payment on-chain (merchant side).

        Args:
            payment_proof: The x402 payment proof / X-PAYMENT header value.
        """
        return self._client.settle_x402_payment(payment_proof)
