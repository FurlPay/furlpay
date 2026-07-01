"""Furlpay API client (uses only the Python standard library)."""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any, Dict, Optional


class FurlpayError(Exception):
    def __init__(self, message: str, status_code: int, raw: Any = None):
        super().__init__(message)
        self.status_code = status_code
        self.raw = raw


class Furlpay:
    """Synchronous Furlpay client.

    Example:
        from furlpay import Furlpay
        client = Furlpay(api_key=os.environ["FURLPAY_API_KEY"])
        wallet = client.wallets_retrieve()
    """

    def __init__(self, api_key: str, base_url: str = "https://api.furlpay.app"):
        if not api_key:
            raise ValueError("api_key is required")
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")

    def _request(self, method: str, path: str, body: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(
            self.base_url + path,
            data=data,
            method=method,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(req) as resp:
                text = resp.read().decode()
                return json.loads(text) if text else {}
        except urllib.error.HTTPError as e:
            text = e.read().decode()
            payload = json.loads(text) if text else {}
            raise FurlpayError(payload.get("error", e.reason), e.code, payload)

    # --- Wallets ---
    def wallets_retrieve(self) -> Dict[str, Any]:
        return self._request("GET", "/api/wallets")

    def wallets_transfer(self, *, destination: str, amount: float, token: str, chain: str, signature: str) -> Dict[str, Any]:
        return self._request("POST", "/api/wallets/transfer", {
            "destination": destination, "amount": amount, "token": token, "chain": chain, "signature": signature,
        })

    # --- Banking ---
    def banking_provision(self, currency: str) -> Dict[str, Any]:
        return self._request("POST", "/api/banking", {"currency": currency})

    # --- Cards ---
    def cards_list(self) -> Dict[str, Any]:
        return self._request("GET", "/api/cards")

    def cards_update_settings(self, **kwargs: Any) -> Dict[str, Any]:
        return self._request("POST", "/api/cards/settings", kwargs)

    # --- Investing ---
    def investing_portfolio(self) -> Dict[str, Any]:
        return self._request("GET", "/api/investing/portfolio")

    def investing_create_order(self, *, symbol: str, side: str, notional: float, type: str = "market") -> Dict[str, Any]:
        return self._request("POST", "/api/investing/order", {
            "symbol": symbol, "side": side, "notional": notional, "type": type,
        })

    # --- Swaps ---
    def swaps_quote(self, **kwargs: Any) -> Dict[str, Any]:
        return self._request("POST", "/api/swaps", kwargs)

    # --- Compliance ---
    def compliance_verify_identity(self, **kwargs: Any) -> Dict[str, Any]:
        return self._request("POST", "/api/compliance/kyc", kwargs)
