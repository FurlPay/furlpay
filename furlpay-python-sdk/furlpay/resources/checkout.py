from ..types import CheckoutSession

class CheckoutResource:
    def __init__(self, client):
        self.client = client

    def create_session(self, amount: float, currency: str, success_url: str, cancel_url: str) -> CheckoutSession:
        data = {
            "amount": amount,
            "currency": currency,
            "success_url": success_url,
            "cancel_url": cancel_url
        }
        response = self.client._request("POST", "/checkout/sessions", json=data)
        return CheckoutSession(**response)

    def get_session(self, session_id: str) -> CheckoutSession:
        response = self.client._request("GET", f"/checkout/sessions/{session_id}")
        return CheckoutSession(**response)
