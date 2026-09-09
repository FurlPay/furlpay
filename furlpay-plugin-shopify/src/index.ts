import express from 'express';
import { paymentRouter } from './routes/payment.js';
import { webhookRouter } from './routes/webhook.js';
import { config } from './config.js';

const app = express();

app.use(express.json());

app.use('/api', paymentRouter);
app.use('/webhooks', webhookRouter);

app.listen(config.PORT, () => {
  console.log(`Shopify plugin running on port ${config.PORT}`);
});
