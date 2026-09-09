import { createHmac, timingSafeEqual } from 'crypto';
import { WebhookPayload } from './types';

export class WebhookVerifier {
  verify(body: string, signature: string, secret: string, timestamp: string, tolerance: number = 300000): boolean {
    const timeNum = parseInt(timestamp, 10);
    if (isNaN(timeNum)) return false;

    const now = Date.now();
    if (Math.abs(now - timeNum) > tolerance) {
      return false; // Timestamp is too old or too far in the future
    }

    const expectedSignature = createHmac('sha256', secret).update(body).digest('hex');
    
    // Constant-time comparison
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');
    const actualBuffer = Buffer.from(signature, 'hex');
    
    if (expectedBuffer.length !== actualBuffer.length) {
      return false;
    }
    
    return timingSafeEqual(expectedBuffer, actualBuffer);
  }

  constructEvent(body: string, signature: string, secret: string, timestamp: string): WebhookPayload {
    if (!this.verify(body, signature, secret, timestamp)) {
      throw new Error('Webhook signature verification failed');
    }
    return JSON.parse(body);
  }
}
