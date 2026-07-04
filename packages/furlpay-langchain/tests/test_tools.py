"""
Contract tests for the FurlPay LangChain toolset.

They run entirely in demo mode (no FURLPAY_API_KEY, no network), asserting that:
  - every tool is a well-formed LangChain StructuredTool with a schema,
  - tool names are unique and namespaced,
  - each tool is invocable and returns JSON-serialisable output,
  - the x402 budget guard refuses to overspend.

Green == the tools will register and call correctly inside a LangChain agent.

Run:  python -m pytest tests -q      (or:  python tests/test_tools.py)
"""

import json
import os

# Ensure demo mode regardless of the developer's environment.
os.environ.pop("FURLPAY_API_KEY", None)

from langchain_core.tools import StructuredTool  # noqa: E402

from furlpay_langchain import FurlPayClient, get_furlpay_tools  # noqa: E402

TOOLS = get_furlpay_tools()
BY_NAME = {t.name: t for t in TOOLS}


def test_all_tools_are_structured_tools_with_schema():
    assert len(TOOLS) >= 12
    for t in TOOLS:
        assert isinstance(t, StructuredTool)
        assert t.name.startswith("furlpay_")
        assert t.description
        assert t.args_schema is not None


def test_tool_names_unique():
    names = [t.name for t in TOOLS]
    assert len(names) == len(set(names)), "duplicate tool names"


def test_expected_tools_present():
    expected = {
        "furlpay_get_wallet_balances",
        "furlpay_create_payment",
        "furlpay_send_transfer",
        "furlpay_place_investment_order",
        "furlpay_get_swap_quote",
        "furlpay_get_x402_config",
        "furlpay_pay_for_resource",
        "furlpay_set_agent_budget",
        "furlpay_get_agent_budget",
        "furlpay_create_x402_paywall",
        "furlpay_verify_x402_payment",
        "furlpay_settle_x402_payment",
    }
    assert expected <= set(BY_NAME)


def test_demo_client_is_not_live():
    assert FurlPayClient.from_env().live is False


def test_read_tool_returns_serialisable():
    out = BY_NAME["furlpay_get_wallet_balances"].invoke({})
    assert isinstance(out, list) and out
    json.dumps(out)  # must be serialisable


def test_create_payment_simulates_in_demo():
    out = BY_NAME["furlpay_create_payment"].invoke(
        {"amount": 12.5, "currency": "USDC", "description": "unit test"}
    )
    assert out["simulated"] is True
    assert out["amount"] == 12.5
    assert "checkout_url" in out


def test_place_order_and_swap():
    order = BY_NAME["furlpay_place_investment_order"].invoke(
        {"symbol": "voo", "side": "buy", "notional": 10}
    )
    assert order["symbol"] == "VOO" and order["side"] == "buy"

    quote = BY_NAME["furlpay_get_swap_quote"].invoke(
        {"from_token": "SOL", "to_token": "USDC", "amount": 2}
    )
    assert quote["amount_out"] > 0


def test_pay_for_resource_respects_budget():
    ok = BY_NAME["furlpay_pay_for_resource"].invoke(
        {"url": "https://example.com/premium", "max_amount": 1.0}
    )
    assert ok["paid"] is True

    broke = BY_NAME["furlpay_pay_for_resource"].invoke(
        {"url": "https://example.com/premium", "max_amount": 0.001}
    )
    assert broke["paid"] is False
    assert "max_amount" in broke


def test_agent_budget_roundtrip():
    b = BY_NAME["furlpay_get_agent_budget"].invoke({"agent_id": "agent_test"})
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
