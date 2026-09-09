import httpx
from typing import Optional, Dict, Any

from .constants import API_BASE_URL_PRODUCTION, API_BASE_URL_SANDBOX
from .errors import AuthenticationError, InvalidRequestError, FurlPayError
from .resources.payments import PaymentsResource
from .resources.checkout import CheckoutResource
from .resources.merchants import MerchantsResource
from .resources.webhooks import WebhooksResource

class FurlPay:
    def __init__(self, api_key: str, environment: str = 'production', base_url: Optional[str] = None):
        if not api_key:
            raise AuthenticationError("No API key provided.")
        
        self.api_key = api_key
        
        if base_url:
            self.base_url = base_url
        else:
            self.base_url = API_BASE_URL_PRODUCTION if environment == 'production' else API_BASE_URL_SANDBOX
            
        self.client = httpx.Client(
            base_url=self.base_url,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
                "User-Agent": "FurlPay-Python/0.1.0"
            }
        )
        
        self._payments = PaymentsResource(self)
        self._checkout = CheckoutResource(self)
        self._merchants = MerchantsResource(self)
        self._webhooks = WebhooksResource(self)

    @property
    def payments(self) -> PaymentsResource:
        return self._payments

    @property
    def checkout(self) -> CheckoutResource:
        return self._checkout
        
    @property
    def merchants(self) -> MerchantsResource:
        return self._merchants
        
    @property
    def webhooks(self) -> WebhooksResource:
        return self._webhooks

    def _request(self, method: str, path: str, json: Optional[Dict[str, Any]] = None, params: Optional[Dict[str, Any]] = None) -> dict:
        try:
            response = self.client.request(method, path, json=json, params=params)
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 401:
                raise AuthenticationError("Invalid API key")
            elif e.response.status_code in [400, 422]:
                raise InvalidRequestError(e.response.text)
            raise FurlPayError(f"HTTP error: {e.response.status_code} - {e.response.text}")
        except httpx.RequestError as e:
            raise FurlPayError(f"Request error: {str(e)}")
