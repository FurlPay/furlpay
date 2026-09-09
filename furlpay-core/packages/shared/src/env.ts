import { z } from 'zod';
const envSchema = z.object({ RPC_URL: z.string().optional() });
export function validateEnv() { return envSchema.parse(process.env); }
