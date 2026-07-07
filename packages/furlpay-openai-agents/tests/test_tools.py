"""
Contract tests for the FurlPay OpenAI-Agents toolset (demo mode, no network).

Asserts the tools are well-formed FunctionTools with unique namespaced names and
JSON schemas, and that the underlying client behaves in demo mode (including the
x402 budget guard). Green == the tools register and call inside an Agents SDK agent.

Run:  python -m pytest tests -q
"""

import os

os.environ.pop("FURLPAY_API_KEY", None)

from agents import FunctionTool  # noqa: E402

from furlpay_openai_agents import FurlPayClient, get_furlpay_tools  # noqa: E402

TOOLS = get_furlpay_tools()
BY_NAME = {t.name: t for t in TOOLS}

EXPECTED = {
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


def test_tools_are_function_tools_with_schema():
    assert len(TOOLS) == 12
    for t in TOOLS:
        assert isinstance(t, FunctionTool)
        assert t.name.startswith("furlpay_")
        assert t.description
        assert isinstance(t.params_json_schema, dict)


def test_tool_names_unique_and_expected():
    names = [t.name for t in TOOLS]
    assert len(names) == len(set(names))
    assert EXPECTED <= set(BY_NAME)


def test_demo_client_is_not_live():
    assert FurlPayClient.from_env().live is False


def test_client_demo_behaviour():
    c = FurlPayClient.from_env()
    assert c.wallet_balances()
    pay = c.create_payment(12.5, "USDC", "unit test")
    assert pay["simulated"] is True and pay["amount"] == 12.5
    order = c.place_investment_order("voo", "buy", 10)
    assert order["symbol"] == "VOO" and order["side"] == "buy"


def test_pay_for_resource_respects_budget():
    c = FurlPayClient.from_env()
    assert c.pay_for_resource("https://example.com/premium", 1.0)["paid"] is True
    broke = c.pay_for_resource("https://example.com/premium", 0.001)
    assert broke["paid"] is False and "max_amount" in broke


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
