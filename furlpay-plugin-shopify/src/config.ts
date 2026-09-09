import { z } from 'zod';

const envSchema = z.object({
  SHOPIFY_API_KEY: z.string().min(1).default('mock_key'),
  SHOPIFY_API_SECRET: z.string().min(1).default('mock_secret'),
  FURLPAY_API_KEY: z.string().min(1).default('mock_furlpay_key'),
  WEBHOOK_SECRET: z.string().min(1).default('mock_webhook_secret'),
  PORT: z.string().optional().default('3000')
});

export const config = envSchema.parse(process.env);
