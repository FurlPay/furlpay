import { FurlPayConfig } from './types';
import { PaymentsResource } from './payments';
import { CheckoutResource } from './checkout';
import { MerchantsResource } from './merchants';
import { AnalyticsResource } from './analytics';
import { NetworkResource } from './network';
import { AuthenticationError, NetworkError, FurlPayError } from './errors';

export class FurlPay {
  private config: FurlPayConfig;
  private baseUrl: string;

  public payments: PaymentsResource;
  public checkout: CheckoutResource;
  public merchant: MerchantsResource;
  public analytics: AnalyticsResource;
  public network: NetworkResource;

  constructor(config: FurlPayConfig) {
    if (!config.apiKey) {
      throw new AuthenticationError('API key is required');
    }
    this.config = config;
    this.baseUrl = config.baseUrl || (config.environment === 'production' ? 'https://api.furlpay.com' : 'https://sandbox.api.furlpay.com');

    this.payments = new PaymentsResource(this);
    this.checkout = new CheckoutResource(this);
    this.merchant = new MerchantsResource(this);
    this.analytics = new AnalyticsResource(this);
    this.network = new NetworkResource(this);
  }

  public async _request<T>(method: string, path: string, body?: any): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers = {
      'Authorization': `Bearer ${this.config.apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new FurlPayError(errorData.message || `Request failed with status ${response.status}`);
      }

      return await response.json() as T;
    } catch (error) {
      if (error instanceof FurlPayError) {
        throw error;
      }
      throw new NetworkError(`Network request failed: ${(error as Error).message}`);
    }
  }
}
