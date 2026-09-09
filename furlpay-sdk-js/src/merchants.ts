import type { FurlPay } from './client';
import type { MerchantBalance, PayoutParams, Payout } from './types';

export class MerchantsResource {
  constructor(private client: FurlPay) {}

  public getBalance(): Promise<MerchantBalance> {
    return this.client._request<MerchantBalance>('GET', '/v1/merchant/balance');
  }

  public createPayout(params: PayoutParams): Promise<Payout> {
    return this.client._request<Payout>('POST', '/v1/merchant/payouts', params);
  }
}
