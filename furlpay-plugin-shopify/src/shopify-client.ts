import { createHmac, timingSafeEqual } from 'crypto';
import { ShopifyOrder, ShopifyPaymentSession } from './types.js';

export class ShopifyClient {
  verifyWebhookSignature(body: string, signature: string, secret: string): boolean {
    const expectedSignature = createHmac('sha256', secret).update(body, 'utf8').digest('base64');
    const expectedBuffer = Buffer.from(expectedSignature);
    const actualBuffer = Buffer.from(signature);
    
    if (expectedBuffer.length !== actualBuffer.length) {
      return false;
    }
    
    return timingSafeEqual(expectedBuffer, actualBuffer);
  }

  async createCheckoutSession(order: ShopifyOrder): Promise<ShopifyPaymentSession> {
    return {
      id: `sess_${order.id}`,
      status: 'pending',
      amount: order.total_price,
      currency: order.currency,
      cancel_url: `https://store.example.com/checkout/cancel`,
    };
  }

  async getOrderById(id: string): Promise<ShopifyOrder> {
    return {
      id,
      total_price: '100.00',
      currency: 'USD',
      financial_status: 'pending',
      email: 'customer@example.com'
    };
  }
}
