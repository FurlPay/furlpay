import type { FurlPay } from './client';
import type { NetworkStatus } from './types';

export class NetworkResource {
  constructor(private client: FurlPay) {}

  public getStatus(): Promise<NetworkStatus> {
    return this.client._request<NetworkStatus>('GET', '/v1/network/status');
  }
}
