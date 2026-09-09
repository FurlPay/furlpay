export enum WebhookEventType {
  PAYMENT_CONFIRMED = 'payment.confirmed',
  PAYMENT_FINALIZED = 'payment.finalized',
  PAYMENT_FAILED = 'payment.failed',
  PAYMENT_REFUNDED = 'payment.refunded',
  PAYOUT_COMPLETED = 'payout.completed',
  DISPUTE_OPENED = 'dispute.opened',
  DISPUTE_RESOLVED = 'dispute.resolved',
}

export interface WebhookEndpoint {
  id: string;
  url: string;
  secret: string;
  eventTypes: WebhookEventType[];
}

export interface WebhookDelivery {
  id: string;
  endpointId: string;
  eventId: string;
  status: 'success' | 'failed';
  statusCode: number;
  attempt: number;
  nextRetryAt?: Date;
}

export interface WebhookConfig {
  maxRetries?: number;
  timeoutMs?: number;
}

export type WebhookPayload = any;
