"""Webhook signature verification for Furlpay (HMAC-SHA256)."""
from __future__ import annotations

import hashlib
import hmac
import json
import time
from typing import Any, Dict, Union

TOLERANCE_SECONDS = 300


class WebhookVerificationError(Exception):
    """Raised when a webhook signature cannot be verified."""


def sign_payload(body: str, secret: str, timestamp: int | None = None) -> str:
    ts = timestamp if timestamp is not None else int(time.time())
    signed = f"{ts}.{body}"
    v1 = hmac.new(secret.encode(), signed.encode(), hashlib.sha256).hexdigest()
    return f"t={ts},v1={v1}"


def construct_event(
    payload: Union[str, bytes],
    signature_header: str | None,
    secret: str,
) -> Dict[str, Any]:
    """Verify a signature header and return the parsed event dict.

    Example:
        event = furlpay.construct_event(
            request.data, request.headers.get("furlpay-signature"),
            os.environ["FURLPAY_ENDPOINT_SECRET"],
        )
    """
    body = payload.decode() if isinstance(payload, (bytes, bytearray)) else payload
    if not signature_header:
        raise WebhookVerificationError("Missing furlpay-signature header")

    parts = {}
    for kv in signature_header.split(","):
        if "=" in kv:
            k, v = kv.split("=", 1)
            parts[k.strip()] = v.strip()

    if "t" not in parts or "v1" not in parts:
        raise WebhookVerificationError("Malformed furlpay-signature header")

    ts = int(parts["t"])
    if abs(int(time.time()) - ts) > TOLERANCE_SECONDS:
        raise WebhookVerificationError("Signature timestamp outside tolerance (possible replay)")

    expected = hmac.new(secret.encode(), f"{ts}.{body}".encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, parts["v1"]):
        raise WebhookVerificationError("Signature verification failed")

    return json.loads(body)
