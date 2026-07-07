"""
Contract tests for the FurlPay Pydantic AI toolset (demo mode, no network).

Asserts the tools are well-formed pydantic_ai.Tools with unique namespaced names,
and that the underlying client behaves in demo mode (incl. the x402 budget guard).

Run:  python -m pytest tests -q
"""

import os

os.environ.pop("FURLPAY_API_KEY", None)

from pydantic_ai import Tool  # noqa: E402

from furlpay_pydanticai import FurlPayClient, get_furlpay_tools  # noqa: E402

TOOLS = get_furlpay_tools()
NAMES = [t.name for t in TOOLS]

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


def test_tools_are_pydantic_ai_tools():
    assert len(TOOLS) == 12
    for t in TOOLS:
        assert isinstance(t, Tool)
        assert t.name.startswith("furlpay_")


def test_tool_names_unique_and_expected():
    assert len(NAMES) == len(set(NAMES))
    assert EXPECTED <= set(NAMES)


def test_demo_client_is_not_live():
    assert FurlPayClient.from_env().live is False


def test_client_demo_behaviour():
    c = FurlPayClient.from_env()
    assert c.wallet_balances()
    pay = c.create_payment(12.5, "USDC", "unit test")
    assert pay["simulated"] is True and pay["amount"] == 12.5
    quote = c.swap_quote("SOL", "USDC", 2)
    assert quote["amount_out"] > 0


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
