"""
FurlPay tools for the OpenAI Agents SDK.

    from furlpay_openai_agents import get_furlpay_tools
    from agents import Agent

    agent = Agent(name="Treasurer", tools=get_furlpay_tools())

Each tool is a `FunctionTool` whose JSON schema is derived from a typed Python
function, so the Agents SDK calls it with validated arguments. In demo mode
(no FURLPAY_API_KEY) every call returns deterministic sample data, so an agent
can be wired up and observed without an account.
"""

from __future__ import annotations

from typing import List, Optional

from agents import FunctionTool, function_tool

from .client import FurlPayClient


def get_furlpay_tools(client: Optional[FurlPayClient] = None) -> List[FunctionTool]:
    """Return the FurlPay OpenAI-Agents toolset. Uses env config if no client is passed."""
    c = client or FurlPayClient.from_env()

    # Inner functions close over the client; `function_tool` builds the schema
    # from their type hints + docstrings. Names are namespaced via override.

    def furlpay_get_wallet_balances() -> list:
        """Get the FurlPay account's stablecoin balances across chains (USDC/USDT on Solana, Base)."""
        return c.wallet_balances()

    def furlpay_create_payment(amount: float, currency: str = "USDC", description: str = "") -> dict:
        """Create a hosted stablecoin checkout and return a payment/checkout link.

        Args:
            amount: Amount to charge, in the given currency.
            currency: Settlement currency, e.g. USDC or USDT.
            description: Human-readable description shown on the checkout.
        """
        return c.create_payment(amount, currency, description)

    def furlpay_send_transfer(to: str, amount: float, token: str = "USDC") -> dict:
        """Send stablecoins from the FurlPay wallet to an address or FurlPay handle.

        Args:
            to: Recipient wallet address or FurlPay handle.
            amount: Amount of the token to send.
            token: Token symbol, e.g. USDC.
        """
        return c.send_transfer(to, amount, token)

    def furlpay_place_investment_order(symbol: str, side: str, notional: float) -> dict:
        """Place a fractional stock/ETF/crypto order funded in USDC (via Alpaca).

        Args:
            symbol: Ticker to trade, e.g. AAPL, VOO, BTC.
            side: 'buy' or 'sell'.
            notional: USD notional to buy/sell (fractional allowed).
        """
        return c.place_investment_order(symbol, side, notional)

    def furlpay_get_swap_quote(from_token: str, to_token: str, amount: float) -> dict:
        """Quote a stablecoin/crypto swap, e.g. SOL to USDC.

        Args:
            from_token: Token to sell, e.g. SOL.
            to_token: Token to receive, e.g. USDC.
            amount: Amount of from_token to swap.
        """
        return c.swap_quote(from_token, to_token, amount)

    def furlpay_get_x402_config() -> dict:
        """Get the x402 facilitator config: supported chains, tokens, limits, replay tolerance."""
        return c.x402_config()

    def furlpay_pay_for_resource(url: str, max_amount: float = 1.0, agent_id: str = "agent_default") -> dict:
        """Autonomously pay for an x402-protected (HTTP 402) API/resource within a USDC budget and return its content.

        Args:
            url: URL of the x402-protected (HTTP 402) resource to fetch.
            max_amount: Maximum USDC the agent may spend on this call.
            agent_id: Agent identity for budget accounting.
        """
        return c.pay_for_resource(url, max_amount, agent_id)

    def furlpay_set_agent_budget(agent_id: str, limit: float, period: str = "daily") -> dict:
        """Set a spending cap (USDC per period) for an AI agent's x402 payments.

        Args:
            agent_id: Identifier of the AI agent to cap.
            limit: Spend cap in USDC for the period.
            period: 'daily', 'weekly', or 'monthly'.
        """
        return c.set_agent_budget(agent_id, limit, period)

    def furlpay_get_agent_budget(agent_id: str) -> dict:
        """Get an AI agent's x402 spending budget and amount spent so far.

        Args:
            agent_id: Identifier of the AI agent.
        """
        return c.agent_budget(agent_id)

    def furlpay_create_x402_paywall(resource: str, price: float, network: str = "solana") -> dict:
        """Protect a resource with an x402 paywall so agents pay per call in USDC.

        Args:
            resource: Path/URL of the resource to protect, e.g. /api/premium/quote.
            price: Price per call, in USDC.
            network: Settlement network: 'solana' or 'base'.
        """
        return c.create_x402_paywall(resource, price, network)

    def furlpay_verify_x402_payment(payment_proof: str) -> dict:
        """Verify an inbound x402 payment proof (merchant side).

        Args:
            payment_proof: The x402 payment proof / X-PAYMENT header value.
        """
        return c.verify_x402_payment(payment_proof)

    def furlpay_settle_x402_payment(payment_proof: str) -> dict:
        """Settle a verified x402 payment on-chain (merchant side).

        Args:
            payment_proof: The x402 payment proof / X-PAYMENT header value.
        """
        return c.settle_x402_payment(payment_proof)

    fns = [
        furlpay_get_wallet_balances,
        furlpay_create_payment,
        furlpay_send_transfer,
        furlpay_place_investment_order,
        furlpay_get_swap_quote,
        furlpay_get_x402_config,
        furlpay_pay_for_resource,
        furlpay_set_agent_budget,
        furlpay_get_agent_budget,
        furlpay_create_x402_paywall,
        furlpay_verify_x402_payment,
        furlpay_settle_x402_payment,
    ]
    return [function_tool(fn) for fn in fns]
