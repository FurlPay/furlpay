import { Router } from 'express';
import { ShopifyClient } from '../shopify-client.js';
import { config } from '../config.js';

export const webhookRouter = Router();
const shopify = new ShopifyClient();

webhookRouter.post('/shopify', (req, res) => {
  const hmac = req.header('X-Shopify-Hmac-Sha256');
  const body = JSON.stringify(req.body);
  
  if (!hmac || !shopify.verifyWebhookSignature(body, hmac, config.SHOPIFY_API_SECRET)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const topic = req.header('X-Shopify-Topic');
  console.log(`Received webhook: ${topic}`);

  res.status(200).send('OK');
});
