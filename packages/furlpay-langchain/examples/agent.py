"""
Minimal LangChain agent that can pay, invest, and transact with FurlPay.

Runs in demo mode out of the box (no FurlPay account needed) so you can watch
the tool calls. To execute for real, set FURLPAY_API_KEY. The LLM step needs a
model key (this example uses Anthropic):

    pip install furlpay-langchain[examples]
    export ANTHROPIC_API_KEY=sk-ant-...
    export FURLPAY_API_KEY=fp_live_sk_...        # optional; omit for demo mode
    python examples/agent.py
"""

from langchain.agents import AgentExecutor, create_tool_calling_agent
from langchain_anthropic import ChatAnthropic
from langchain_core.prompts import ChatPromptTemplate

from furlpay_langchain import get_furlpay_tools

tools = get_furlpay_tools()

llm = ChatAnthropic(model="claude-sonnet-5", temperature=0)

prompt = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            "You are a treasury agent with a FurlPay wallet. Use the FurlPay tools to "
            "check balances, pay for resources over x402 within budget, place investment "
            "orders, and move stablecoins. Always confirm amounts before spending.",
        ),
        ("human", "{input}"),
        ("placeholder", "{agent_scratchpad}"),
    ]
)

agent = create_tool_calling_agent(llm, tools, prompt)
executor = AgentExecutor(agent=agent, tools=tools, verbose=True)

if __name__ == "__main__":
    result = executor.invoke(
        {
            "input": "What stablecoins do I hold? Then buy $25 of VOO and set my agent "
            "budget to $50/day for x402 payments."
        }
    )
    print("\n=== Final answer ===")
    print(result["output"])
