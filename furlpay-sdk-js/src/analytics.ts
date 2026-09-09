import type { FurlPay } from './client';
import type { SpeedAnalytics } from './types';

export class AnalyticsResource {
  constructor(private client: FurlPay) {}

  public getSpeed(period: string = '30d'): Promise<SpeedAnalytics> {
    return this.client._request<SpeedAnalytics>('GET', `/v1/analytics/speed?period=${period}`);
  }
}
