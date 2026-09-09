import hmac
import hashlib
import json
from ..types import WebhookEvent
from ..errors import FurlPayError

class WebhooksResource:
    def __init__(self, client):
        self.client = client

    def verify_signature(self, payload: str, signature: str, secret: str) -> bool:
        if not payload or not signature or not secret:
            return False
            
        computed_signature = hmac.new(
            secret.encode('utf-8'),
            payload.encode('utf-8'),
            hashlib.sha256
        ).hexdigest()
        
        return hmac.compare_digest(computed_signature, signature)

    def construct_event(self, payload: str, signature: str, secret: str) -> WebhookEvent:
        if not self.verify_signature(payload, signature, secret):
            raise FurlPayError("Invalid webhook signature")
            
        data = json.loads(payload)
        return WebhookEvent(**data)
