"""
Minimal CrewAI crew whose Treasurer agent can pay, invest, and transact with FurlPay.

Runs in demo mode out of the box (no FurlPay account needed) so you can watch the
tool calls. To execute for real, set FURLPAY_API_KEY. The LLM step needs a model
key (CrewAI defaults to OpenAI):

    pip install furlpay-crewai
    export OPENAI_API_KEY=sk-...
    export FURLPAY_API_KEY=fp_live_sk_...        # optional; omit for demo mode
    python examples/crew.py
"""

from crewai import Agent, Crew, Task

from furlpay_crewai import get_furlpay_tools

tools = get_furlpay_tools()

treasurer = Agent(
    role="Treasurer",
    goal="Manage the crew's FurlPay wallet: check balances, pay for resources over x402 "
    "within budget, place investment orders, and move stablecoins.",
    backstory="A meticulous on-chain treasurer who always confirms amounts before spending.",
    tools=tools,
    verbose=True,
)

task = Task(
    description=(
        "What stablecoins do we hold? Then buy $25 of VOO and set the agent budget to "
        "$50/day for x402 payments."
    ),
    expected_output="A summary of balances, the placed order, and the configured budget.",
    agent=treasurer,
)

crew = Crew(agents=[treasurer], tasks=[task], verbose=True)

if __name__ == "__main__":
    result = crew.kickoff()
    print("\n=== Final answer ===")
    print(result)
