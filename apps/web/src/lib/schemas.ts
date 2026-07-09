import { z } from "zod";
import { NextResponse } from "next/server";

// Shared zod schemas + a parse helper for route handlers. Malformed input is
// provably rejected with a 400 before any business logic runs.

export const TransferSchema = z.object({
  safeAddress: z.string().optional(),
  destination: z.string().min(4),
  amount: z.number().positive(),
  token: z.enum(["USDC", "USDT", "EURC", "PYUSD", "DAI", "XSGD", "XUSD"]),
  chain: z.enum(["ethereum", "polygon", "base", "arbitrum", "solana", "gnosis"]),
  signature: z.string().min(1),
  mfaCode: z.string().optional(),
  deviceSignals: z.record(z.any()).optional(),
});

export const OrderSchema = z.object({
  symbol: z.string().min(1),
  side: z.enum(["buy", "sell"]),
  notional: z.number().positive().optional(),
  qty: z.number().positive().optional(),
  type: z.enum(["market", "limit", "stop", "stop_limit"]).optional(),
  time_in_force: z.enum(["day", "gtc", "ioc", "fok", "opg", "cls"]).optional(),
  limit_price: z.number().positive().optional(),
  stop_price: z.number().positive().optional(),
});

export const IntentSchema = z.object({
  fromToken: z.enum(["USDC", "USDT", "EURC", "PYUSD", "DAI", "XSGD", "XUSD"]),
  toToken: z.enum(["USDC", "USDT", "EURC", "PYUSD", "DAI", "XSGD", "XUSD"]),
  fromChain: z.enum(["ethereum", "polygon", "base", "arbitrum", "solana", "gnosis"]),
  toChain: z.enum(["ethereum", "polygon", "base", "arbitrum", "solana", "gnosis"]),
  amount: z.number().positive(),
  settleWithinSec: z.number().positive().optional(),
  fallbackToken: z.enum(["USDC", "USDT", "EURC", "PYUSD", "DAI", "XSGD", "XUSD"]).optional(),
  execute: z.boolean().optional(),
});

export const CheckoutSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().optional(),
  token: z.string().optional(),
  wallet: z.string().optional(),
});

export const BankingSchema = z.object({
  currency: z.enum(["USD", "EUR", "GBP", "INR"]),
});

// --- Unified USDC payments (settle on Arbitrum One) -------------------------

const EvmAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "Expected a 0x EVM address");
const SourceChain = z.enum(["ethereum", "polygon", "base", "arbitrum", "solana", "gnosis"]);

export const PaymentCreateSchema = z.object({
  amount: z.number().positive().max(1_000_000),
  sourceChain: SourceChain.optional(), // defaults to arbitrum in the route
  recipient: EvmAddress,
  metadata: z.record(z.string()).optional(),
});

export const PaymentExecuteSchema = z.object({
  paymentId: z.string().startsWith("pay_"),
  payer: EvmAddress,
  signature: z.string().min(1),
});

export const PaymentBatchSchema = z.object({
  sourceChain: SourceChain.optional(),
  payments: z
    .array(
      z.object({
        recipient: EvmAddress,
        amount: z.number().positive().max(1_000_000),
        metadata: z.record(z.string()).optional(),
      })
    )
    .min(1)
    .max(100),
});

export type Parsed<T> = { ok: true; data: T } | { ok: false; res: NextResponse };

/** Parse an unknown body against a schema; on failure return a 400 response. */
export function parse<T>(schema: z.ZodType<T>, body: unknown): Parsed<T> {
  const result = schema.safeParse(body);
  if (!result.success) {
    return {
      ok: false,
      res: NextResponse.json(
        { error: "Invalid request", issues: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
        { status: 400 }
      ),
    };
  }
  return { ok: true, data: result.data };
}
