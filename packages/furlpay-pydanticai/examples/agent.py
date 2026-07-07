"""
Minimal Pydantic AI agent with a FurlPay wallet. Demo mode by default.

    pip install furlpay-pydanticai
    export OPENAI_API_KEY=sk-...
    export FURLPAY_API_KEY=fp_live_sk_...   # optional; omit for demo mode
    python examples/agent.py
"""

from pydantic_ai import Agent

from furlpay_pydanticai import get_furlpay_tools

agent = Agent(
    "openai:gpt-4o",
    system_prompt=(
        "You manage a FurlPay wallet. Check balances, pay for x402 resources within "
        "budget, place investment orders, and move stablecoins. Confirm amounts first."
    ),
    tools=get_furlpay_tools(),
)

if __name__ == "__main__":
    result = agent.run_sync(
        "What stablecoins do I hold? Then buy $25 of VOO and set my agent budget to $50/day."
    )
    print("\n=== Final answer ===")
    print(result.output)
