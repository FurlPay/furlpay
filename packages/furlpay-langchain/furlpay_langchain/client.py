"""
Thin FurlPay REST client used by the LangChain tools.

Clone-and-run: with no FURLPAY_API_KEY set, every method returns deterministic
demo data (and forms *simulate* rather than touch the network), so an agent can
be wired up and its tool calls observed end-to-end without an account. Set
FURLPAY_API_KEY (and optionally FURLPAY_API_BASE) to hit the live API at
https://api.furlpay.com/v1 instead.

Only the endpoints the agent tools need are wrapped. Reads fail soft: on a
network/auth error they fall back to demo data and flag the payload with
`"_demo": true` so a tool never raises mid-conversation.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import httpx

DEFAULT_BASE = "https://api.furlpay.com/v1"
TIMEOUT = httpx.Timeout(15.0, connect=5.0)
USER_AGENT = "furlpay-langchain/0.1.0"


@dataclass
class FurlPayClient:
    api_key: str | None = None
    base_url: str = DEFAULT_BASE

    @classmethod
    def from_env(cls) -> "FurlPayClient":
        return cls(
            api_key=os.getenv("FURLPAY_API_KEY") or None,
            base_url=os.getenv("FURLPAY_API_BASE", DEFAULT_BASE).rstrip("/"),
        )

    @property
    def live(self) -> bool:
        """True when a key is configured; otherwise every call runs on demo data."""
        return bool(self.api_key)

    # -- transport ----------------------------------------------------------

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
        }

    def _get(self, path: str, params: dict | None = None) -> dict | list:
        with httpx.Client(timeout=TIMEOUT) as c:
            r = c.get(f"{self.base_url}{path}", headers=self._headers(), params=params)
            r.raise_for_status()
            return r.json()

    def _post(self, path: str, body: dict) -> dict:
        with httpx.Client(timeout=TIMEOUT) as c:
            r = c.post(f"{self.base_url}{path}", headers=self._headers(), json=body)
            r.raise_for_status()
            return r.json()

    # -- reads --------------------------------------------------------------

    def wallet_balances(self) -> list[dict]:
        if not self.live:
            return _DEMO_BALANCES
        try:
            data = self._get("/wallets/balances")
            return data if isinstance(data, list) else data.get("data", [])  # type: ignore[union-attr]
        except Exception:
            return _mark_demo(_DEMO_BALANCES)

    def x402_config(self) -> dict:
        if not self.live:
            return _DEMO_X402_CONFIG
        try:
            return self._get("/x402/config")  # type: ignore[return-value]
        except Exception:
            return {**_DEMO_X402_CONFIG, "_demo": True}

    def agent_budget(self, agent_id: str) -> dict:
        if not self.live:
            return {**_DEMO_AGENT_BUDGET, "agent_id": agent_id}
        try:
            return self._get(f"/x402/agent-budget/{agent_id}")  # type: ignore[return-value]
        except Exception:
            return {**_DEMO_AGENT_BUDGET, "agent_id": agent_id, "_demo": True}

    def swap_quote(self, from_token: str, to_token: str, amount: float) -> dict:
        body = {"fromToken": from_token.upper(), "toToken": to_token.upper(), "amountIn": amount}
        if not self.live:
            rate = _DEMO_RATES.get((from_token.upper(), to_token.upper()), 1.0)
            return {
                "from": from_token.upper(), "to": to_token.upper(),
                "amount_in": amount, "amount_out": round(amount * rate, 6),
                "rate": rate, "route": "demo", "_demo": True,
            }
        return self._post("/swaps/quote", body)

    # -- writes (execution) -------------------------------------------------

    def create_payment(self, amount: float, currency: str = "USDC", description: str = "") -> dict:
        body = {"amount": amount, "currency": currency.upper(), "description": description}
        if not self.live:
            return _simulated_ack("payment", {
                **body,
                "id": "pay_demo_" + _short_id(),
                "checkout_url": "https://checkout.furlpay.com/demo/" + _short_id(),
                "status": "requires_payment",
            })
        return self._post("/payments/checkout", body)

    def send_transfer(self, to: str, amount: float, token: str = "USDC") -> dict:
        body = {"to": to, "amount": amount, "token": token.upper()}
        if not self.live:
            return _simulated_ack("transfer", {**body, "id": "tr_demo_" + _short_id(), "status": "pending"})
        return self._post("/transfers", body)

    def place_investment_order(self, symbol: str, side: str, notional: float) -> dict:
        body = {"symbol": symbol.upper(), "side": side.lower(), "notional": notional, "currency": "USDC"}
        if not self.live:
            return _simulated_ack("order", {**body, "id": "ord_demo_" + _short_id(), "status": "accepted"})
        return self._post("/investing/orders", body)

    def set_agent_budget(self, agent_id: str, limit: float, period: str = "daily") -> dict:
        body = {"agent_id": agent_id, "limit": limit, "period": period, "currency": "USDC"}
        if not self.live:
            return _simulated_ack("agent-budget", {**body, "spent": 0.0, "remaining": limit})
        return self._post("/x402/agent-budget", body)

    def create_x402_paywall(self, resource: str, price: float, network: str = "solana") -> dict:
        body = {"resource": resource, "price_usdc": price, "network": network}
        if not self.live:
            return _simulated_ack("paywall", {
                **body, "id": "pw_demo_" + _short_id(),
                "pay_to": "FurLDemo11111111111111111111111111111111111",
            })
        return self._post("/x402/create-paywall", body)

    def verify_x402_payment(self, payment_proof: str) -> dict:
        body = {"proof": payment_proof}
        if not self.live:
            return {"valid": True, "amount": 0.01, "currency": "USDC", "simulated": True, "_demo": True}
        return self._post("/x402/verify", body)

    def settle_x402_payment(self, payment_proof: str) -> dict:
        body = {"proof": payment_proof}
        if not self.live:
            return {"settled": True, "tx": "demo_tx_" + _short_id(), "simulated": True, "_demo": True}
        return self._post("/x402/settle", body)

    def pay_for_resource(self, url: str, max_amount: float = 1.0, agent_id: str = "agent_default") -> dict:
        """Agent-side x402 flow: hit a 402-protected URL, pay within budget, return the content.

        Live: performs a GET; on HTTP 402 it reads the `accepts` challenge, settles a
        payment through the facilitator if within `max_amount`, then retries with the
        payment header. Demo: simulates the whole round-trip deterministically.
        """
        if not self.live:
            price = 0.01
            if price > max_amount:
                return {"paid": False, "reason": "price exceeds max_amount", "price": price, "max_amount": max_amount, "_demo": True}
            return {
                "paid": True, "simulated": True, "url": url, "price_usdc": price,
                "agent_id": agent_id, "settlement_tx": "demo_tx_" + _short_id(),
                "content": {"note": "Demo 402 payload — set FURLPAY_API_KEY to fetch real gated content."},
                "_demo": True,
            }
        with httpx.Client(timeout=TIMEOUT) as c:
            r = c.get(url, headers=self._headers())
            if r.status_code != 402:
                return {"paid": False, "status_code": r.status_code, "content": _safe_json(r)}
            challenge = r.json()
            accepts = (challenge.get("accepts") or [{}])[0]
            price = float(accepts.get("maxAmountRequired", accepts.get("amount", 0)) or 0)
            if price > max_amount:
                return {"paid": False, "reason": "price exceeds max_amount", "price": price, "max_amount": max_amount}
            settled = self._post("/x402/settle", {"challenge": challenge, "agent_id": agent_id})
            header = settled.get("payment_header") or settled.get("proof")
            r2 = c.get(url, headers={**self._headers(), "X-PAYMENT": header or ""})
            return {"paid": True, "url": url, "price_usdc": price, "settlement": settled,
                    "status_code": r2.status_code, "content": _safe_json(r2)}


# -- helpers ----------------------------------------------------------------

def _mark_demo(rows: list[dict]) -> list[dict]:
    return [{**r, "source": "demo"} for r in rows]


def _simulated_ack(kind: str, body: dict) -> dict:
    return {
        "success": True,
        "simulated": True,
        "kind": kind,
        "detail": "Demo mode — set FURLPAY_API_KEY to execute against the live API.",
        **body,
    }


def _safe_json(r: httpx.Response):
    try:
        return r.json()
    except Exception:
        return r.text[:2000]


def _short_id() -> str:
    return format(abs(hash(datetime.now(timezone.utc).isoformat())) % 0xFFFFFF, "06x")


# -- demo fixtures ----------------------------------------------------------

_DEMO_BALANCES = [
    {"token": "USDC", "network": "Solana", "balance": 3120.10, "usd_value": 3120.10},
    {"token": "USDC", "network": "Base", "balance": 480.00, "usd_value": 480.00},
    {"token": "SOL", "network": "Solana", "balance": 6.42, "usd_value": 1123.50},
]

_DEMO_X402_CONFIG = {
    "chains": ["solana", "base"],
    "tokens": ["USDC"],
    "facilitator": "https://api.furlpay.com/v1/x402",
    "max_amount_usdc": 100,
    "replay_tolerance_seconds": 300,
}

_DEMO_AGENT_BUDGET = {
    "agent_id": "agent_default",
    "period": "daily",
    "limit": 25.0,
    "spent": 4.37,
    "remaining": 20.63,
    "currency": "USDC",
}

_DEMO_RATES = {
    ("SOL", "USDC"): 175.0,
    ("USDC", "SOL"): 1 / 175.0,
    ("USDC", "USDT"): 0.9997,
    ("USDT", "USDC"): 1.0003,
}
