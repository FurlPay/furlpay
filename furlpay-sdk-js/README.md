# @furlpay/js

The official FurlPay JavaScript SDK.

## Installation

```bash
npm install @furlpay/js
```

## Quick Start

```javascript
import { FurlPay } from '@furlpay/js';

const furlpay = new FurlPay({
  apiKey: 'fp_test_123',
  environment: 'sandbox'
});

const payment = await furlpay.payments.create({
  amount: 10.0,
  currency: 'USDC',
  merchantId: 'merch_456'
});
console.log(payment);
```
