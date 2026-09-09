import { FurlPay } from '../src/index';

async function main() {
  const furlpay = new FurlPay({
    apiKey: 'fp_sandbox_123',
    environment: 'sandbox'
  });

  const session = await furlpay.checkout.createSession({
    amount: 100.0,
    currency: 'USDC',
    merchantId: 'merch_test_1',
    successUrl: 'https://example.com/success',
    cancelUrl: 'https://example.com/cancel'
  });

  console.log('Checkout URL:', session.url);
}

main();
