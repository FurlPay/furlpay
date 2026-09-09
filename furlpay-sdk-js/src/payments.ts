import type { FurlPay } from './client';
import type { Payment, CreatePaymentParams, PaymentListParams, Pagination, SettlementReceipt } from './types';

export class PaymentsResource {
  constructor(private client: FurlPay) {}

  public create(params: CreatePaymentParams): Promise<Payment> {
    return this.client._request<Payment>('POST', '/v1/payments', params);
  }

  public get(id: string): Promise<Payment> {
    return this.client._request<Payment>('GET', `/v1/payments/${id}`);
  }

  public list(params?: PaymentListParams): Promise<{ data: Payment[], pagination: Pagination }> {
    const query = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : '';
    return this.client._request<{ data: Payment[], pagination: Pagination }>('GET', `/v1/payments${query}`);
  }

  public refund(id: string, params?: { amount?: number; reason?: string }): Promise<Payment> {
    return this.client._request<Payment>('POST', `/v1/payments/${id}/refund`, params);
  }

  public getReceipt(id: string): Promise<SettlementReceipt> {
    return this.client._request<SettlementReceipt>('GET', `/v1/payments/${id}/receipt`);
  }
}
