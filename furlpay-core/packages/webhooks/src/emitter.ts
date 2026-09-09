import { createHmac, randomUUID } from 'crypto';
import { WebhookConfig, WebhookEndpoint, WebhookDelivery, WebhookPayload } from './types';

export class WebhookEmitter {
  private maxRetries: number;
  private timeoutMs: number;

  constructor(config: WebhookConfig = {}) {
    this.maxRetries = config.maxRetries ?? 3;
    this.timeoutMs = config.timeoutMs ?? 5000;
  }

  async emit(endpoint: WebhookEndpoint, event: WebhookPayload): Promise<WebhookDelivery> {
    const body = JSON.stringify(event);
    const timestamp = Date.now().toString();
    const headers = this.buildHeaders(body, endpoint.secret, timestamp);

    let attempt = 1;
    while (attempt <= this.maxRetries) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
        
        const response = await fetch(endpoint.url, {
          method: 'POST',
          headers,
          body,
          signal: controller.signal as any,
        });
        
        clearTimeout(timeoutId);

        if (response.ok) {
          return {
            id: randomUUID(),
            endpointId: endpoint.id,
            eventId: event.id,
            status: 'success',
            statusCode: response.status,
            attempt,
          };
        }
      } catch (error) {
        // Fall through to retry
      }
      attempt++;
    }

    return {
      id: randomUUID(),
      endpointId: endpoint.id,
      eventId: event.id,
      status: 'failed',
      statusCode: 500,
      attempt: attempt - 1,
    };
  }

  private sign(body: string, secret: string): string {
    return createHmac('sha256', secret).update(body).digest('hex');
  }

  private buildHeaders(body: string, secret: string, timestamp: string): Record<string, string> {
    const signature = this.sign(body, secret);
    return {
      'Content-Type': 'application/json',
      'x-furlpay-signature': signature,
      'x-furlpay-timestamp': timestamp,
    };
  }
}
