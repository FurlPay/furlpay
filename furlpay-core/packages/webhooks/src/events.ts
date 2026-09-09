import { z } from 'zod';
import { WebhookEventType } from './types';

const BaseEventSchema = z.object({
  id: z.string().uuid(),
  timestamp: z.number().positive(),
});

export const PaymentConfirmedEventSchema = BaseEventSchema.extend({
  type: z.literal(WebhookEventType.PAYMENT_CONFIRMED),
  paymentId: z.string(),
  amount: z.number().positive().max(1e12),
  currency: z.string(),
  payer: z.string(),
  merchant: z.string(),
  txSignature: z.string(),
  slot: z.number(),
  confirmationTimeMs: z.number(),
});

export const PaymentFinalizedEventSchema = PaymentConfirmedEventSchema.extend({
  type: z.literal(WebhookEventType.PAYMENT_FINALIZED),
  finalityType: z.enum(['confirmed', 'finalized']),
  finalityTimeMs: z.number(),
});

export const PaymentFailedEventSchema = BaseEventSchema.extend({
  type: z.literal(WebhookEventType.PAYMENT_FAILED),
  paymentId: z.string(),
  errorCode: z.string(),
  errorMessage: z.string(),
});

export const PaymentRefundedEventSchema = BaseEventSchema.extend({
  type: z.literal(WebhookEventType.PAYMENT_REFUNDED),
  paymentId: z.string(),
  originalPaymentId: z.string(),
  refundTxSignature: z.string(),
  amount: z.number().positive(),
});

export const PayoutCompletedEventSchema = BaseEventSchema.extend({
  type: z.literal(WebhookEventType.PAYOUT_COMPLETED),
  payoutId: z.string(),
  amount: z.number().positive(),
  currency: z.string(),
  bankReference: z.string(),
});

export type PaymentConfirmedEvent = z.infer<typeof PaymentConfirmedEventSchema>;
export type PaymentFinalizedEvent = z.infer<typeof PaymentFinalizedEventSchema>;
export type PaymentFailedEvent = z.infer<typeof PaymentFailedEventSchema>;
export type PaymentRefundedEvent = z.infer<typeof PaymentRefundedEventSchema>;
export type PayoutCompletedEvent = z.infer<typeof PayoutCompletedEventSchema>;
