import type { FurlPay } from './client';
import type { CheckoutSession, CreateCheckoutParams } from './types';

export class CheckoutResource {
  constructor(private client: FurlPay) {}

  public createSession(params: CreateCheckoutParams): Promise<CheckoutSession> {
    return this.client._request<CheckoutSession>('POST', '/v1/checkout/sessions', params);
  }

  public getSession(id: string): Promise<CheckoutSession> {
    return this.client._request<CheckoutSession>('GET', `/v1/checkout/sessions/${id}`);
  }
}
