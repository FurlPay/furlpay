"""
Minimal OpenAI Agents SDK agent with a FurlPay wallet. Demo mode by default.

    pip install furlpay-openai-agents
    export OPENAI_API_KEY=sk-...
    export FURLPAY_API_KEY=fp_live_sk_...   # optional; omit for demo mode
    python examples/agent.py
"""

from agents import Agent, Runner

from furlpay_openai_agents import get_furlpay_tools

agent = Agent(
    name="Treasurer",
    instructions=(
        "You manage a FurlPay wallet. Check balances, pay for x402 resources within "
        "budget, place investment orders, and move stablecoins. Confirm amounts first."
    ),
    tools=get_furlpay_tools(),
)

if __name__ == "__main__":
    result = Runner.run_sync(
        agent,
        "What stablecoins do I hold? Then buy $25 of VOO and set my agent budget to $50/day.",
    )
    print("\n=== Final answer ===")
    print(result.final_output)
