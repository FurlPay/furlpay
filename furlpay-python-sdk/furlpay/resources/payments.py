from typing import List, Optional
from ..types import Payment, CreatePaymentParams

class PaymentsResource:
    def __init__(self, client):
        self.client = client

    def create(self, params: CreatePaymentParams) -> Payment:
        response = self.client._request("POST", "/payments", json=params.model_dump(exclude_none=True))
        return Payment(**response)

    def get(self, payment_id: str) -> Payment:
        response = self.client._request("GET", f"/payments/{payment_id}")
        return Payment(**response)

    def list(self, limit: int = 10, cursor: Optional[str] = None) -> List[Payment]:
        params = {"limit": limit}
        if cursor:
            params["cursor"] = cursor
        response = self.client._request("GET", "/payments", params=params)
        return [Payment(**p) for p in response.get("data", [])]
        
    def refund(self, payment_id: str, amount: Optional[float] = None) -> Payment:
        data = {"amount": amount} if amount else {}
        response = self.client._request("POST", f"/payments/{payment_id}/refund", json=data)
        return Payment(**response)
