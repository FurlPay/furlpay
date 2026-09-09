import { Router } from 'express';
import { PaymentBridge } from '../payment-bridge.js';
import { ShopifyClient } from '../shopify-client.js';

export const paymentRouter = Router();
const bridge = new PaymentBridge();
const shopify = new ShopifyClient();

paymentRouter.post('/payment-session', async (req, res) => {
  try {
    const order = req.body;
    const session = await shopify.createCheckoutSession(order);
    const furlPayment = await bridge.createFurlPayment(order);
    
    res.json({ session_url: furlPayment.checkoutUrl });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create session' });
  }
});

paymentRouter.post('/refund-session', async (req, res) => {
  res.json({ status: 'refunded' });
});
