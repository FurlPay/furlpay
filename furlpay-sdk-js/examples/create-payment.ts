import { FurlPay } from '../src/index';

async function main() {
  const furlpay = new FurlPay({
    apiKey: 'fp_sandbox_123',
    environment: 'sandbox'
  });

  try {
    const payment = await furlpay.payments.create({
      amount: 50.0,
      currency: 'USDC',
      merchantId: 'merch_test_1'
    });
    
    console.log('Created payment:', payment);
  } catch (error) {
    console.error('Error creating payment:', error);
  }
}

main();
