export interface FurlPayConfig {
  apiKey: string;
  baseUrl?: string;
  environment: 'production' | 'sandbox';
}

export interface Payment {
  id: string;
  status: 'pending' | 'completed' | 'failed' | 'refunded';
  amount: number;
  currency: string;
  payer?: string;
  merchant: string;
  txSignature?: string;
  confirmationTimeMs?: number;
  finalityTimeMs?: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePaymentParams {
  amount: number;
  currency: string;
  merchantId: string;
  memo?: string;
  metadata?: Record<string, string>;
  redirectUrl?: string;
}

export interface PaymentListParams {
  limit?: number;
  offset?: number;
  status?: string;
  startDate?: string;
  endDate?: string;
}

export interface CheckoutSession {
  id: string;
  url: string;
  paymentId: string;
  expiresAt: string;
}

export interface CreateCheckoutParams {
  amount: number;
  currency: string;
  merchantId: string;
  successUrl: string;
  cancelUrl: string;
  metadata?: Record<string, string>;
}

export interface MerchantBalance {
  available: number;
  pending: number;
  currency: string;
}

export interface PayoutParams {
  amount: number;
  currency: string;
  destination: string;
}

export interface Payout {
  id: string;
  amount: number;
  currency: string;
  destination: string;
  status: 'pending' | 'completed' | 'failed';
  createdAt: string;
}

export interface NetworkStatus {
  health: 'healthy' | 'degraded' | 'down';
  currentTps: number;
  medianConfirmationMs: number;
  finalityMode: string;
  alpenglowActive: boolean;
}

export interface SpeedAnalytics {
  period: string;
  paymentsProcessed: number;
  medianConfirmationMs: number;
  p95ConfirmationMs: number;
  successRate: number;
  averageFeeUsd: number;
  totalVolumeUsd: number;
  feeSavingsVsVisaUsd: number;
}

export interface WebhookEvent {
  id: string;
  type: string;
  data: any;
  created: string;
}

export interface Pagination {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface SettlementReceipt {
  id: string;
  paymentId: string;
  amount: number;
  currency: string;
  settledAt: string;
}
