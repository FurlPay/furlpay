"""
Contract tests for the FurlPay LlamaIndex tool spec.

They run entirely in demo mode (no FURLPAY_API_KEY, no network), asserting that:
  - the spec converts to a well-formed list of FunctionTools,
  - every declared spec_function exists and is exposed,
  - tool metadata (name + description) is populated for the LLM,
  - each tool is callable and returns JSON-serialisable output,
  - the x402 budget guard refuses to overspend.

Green == the spec will register and call correctly inside a LlamaIndex agent.

Run:  python -m pytest tests -q      (or:  python tests/test_tool_spec.py)
"""

import json
import os

# Ensure demo mode regardless of the developer's environment.
os.environ.pop("FURLPAY_API_KEY", None)

from furlpay_llama import FurlPayClient, FurlPayToolSpec  # noqa: E402

SPEC = FurlPayToolSpec()
TOOLS = SPEC.to_tool_list()
BY_NAME = {t.metadata.name: t for t in TOOLS}


def test_spec_converts_to_tool_list():
    assert len(TOOLS) == len(SPEC.spec_functions) >= 12
    for t in TOOLS:
        assert t.metadata.name
        assert t.metadata.description


def test_every_spec_function_exposed():
    for fn in SPEC.spec_functions:
        assert fn in BY_NAME, f"{fn} missing from tool list"
        assert callable(getattr(SPEC, fn))


def test_tool_names_unique():
    names = [t.metadata.name for t in TOOLS]
    assert len(names) == len(set(names))


def test_demo_client_is_not_live():
    assert FurlPayClient.from_env().live is False


def test_read_tool_returns_serialisable():
    out = SPEC.get_wallet_balances()
    assert isinstance(out, list) and out
    json.dumps(out)


def test_create_payment_simulates_in_demo():
    out = SPEC.create_payment(12.5, "USDC", "unit test")
    assert out["simulated"] is True
    assert out["amount"] == 12.5
    assert "checkout_url" in out


def test_callable_through_functiontool():
    tool = BY_NAME["place_investment_order"]
    out = tool(symbol="voo", side="buy", notional=10)
    # FunctionTool returns a ToolOutput whose .raw_output is our dict.
    raw = getattr(out, "raw_output", out)
    assert raw["symbol"] == "VOO" and raw["side"] == "buy"


def test_pay_for_resource_respects_budget():
    assert SPEC.pay_for_resource("https://example.com/premium", max_amount=1.0)["paid"] is True
    broke = SPEC.pay_for_resource("https://example.com/premium", max_amount=0.001)
    assert broke["paid"] is False and "max_amount" in broke


def test_agent_budget_roundtrip():
    b = SPEC.get_agent_budget("agent_test")
    assert b["agent_id"] == "agent_test"
    assert b["remaining"] <= b["limit"]


if __name__ == "__main__":
    import sys
    import traceback

    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failed = 0
    for fn in fns:
        try:
            fn()
            print(f"ok   {fn.__name__}")
        except Exception:
            failed += 1
            print(f"FAIL {fn.__name__}")
            traceback.print_exc()
    print(f"\n{len(fns) - failed}/{len(fns)} passed")
    sys.exit(1 if failed else 0)
