# Furlpay Python SDK

```bash
pip install furlpay
```

```python
import os
from furlpay import Furlpay, construct_event

client = Furlpay(api_key=os.environ["FURLPAY_API_KEY"])

# Place a fractional order
order = client.investing_create_order(symbol="AAPL", side="buy", notional=25)

# Verify an incoming webhook (e.g. in a Flask route)
event = construct_event(
    request.data,
    request.headers.get("furlpay-signature"),
    os.environ["FURLPAY_ENDPOINT_SECRET"],
)
```

Uses only the Python standard library — no runtime dependencies.
