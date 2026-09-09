# FurlPay Python SDK

Python client library for the FurlPay API.

## Installation

```bash
pip install furlpay
```

## Usage

```python
from furlpay import FurlPay

client = FurlPay(api_key="fp_live_...")

payment = client.payments.create(
    amount=100.0,
    currency="USDC"
)
print(payment.id)
```
