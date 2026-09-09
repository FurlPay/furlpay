from ..types import MerchantBalance

class MerchantsResource:
    def __init__(self, client):
        self.client = client

    def get_balance(self) -> MerchantBalance:
        response = self.client._request("GET", "/merchants/balance")
        return MerchantBalance(**response)

    def create_payout(self, amount: float, currency: str, destination: str) -> dict:
        data = {
            "amount": amount,
            "currency": currency,
            "destination": destination
        }
        response = self.client._request("POST", "/merchants/payouts", json=data)
        return response
