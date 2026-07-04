"""
Minimal LlamaIndex agent that can pay, invest, and transact with FurlPay.

Runs in demo mode out of the box (no FurlPay account needed) so you can watch the
tool calls. To execute for real, set FURLPAY_API_KEY. The LLM step needs a model
key (this example uses Anthropic):

    pip install "furlpay-llamaindex[examples]"
    export ANTHROPIC_API_KEY=sk-ant-...
    export FURLPAY_API_KEY=fp_live_sk_...        # optional; omit for demo mode
    python examples/agent.py
"""

from llama_index.core.agent import ReActAgent
from llama_index.llms.anthropic import Anthropic

from furlpay_llama import FurlPayToolSpec

tools = FurlPayToolSpec().to_tool_list()
llm = Anthropic(model="claude-sonnet-5")

agent = ReActAgent.from_tools(tools, llm=llm, verbose=True)

if __name__ == "__main__":
    response = agent.chat(
        "What stablecoins do I hold? Then buy $25 of VOO and set my agent budget "
        "to $50/day for x402 payments."
    )
    print("\n=== Final answer ===")
    print(response)
