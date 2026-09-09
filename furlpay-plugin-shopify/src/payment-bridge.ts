import { ShopifyOrder } from './types.js';

export class PaymentBridge {
  async createFurlPayment(shopifyOrder: ShopifyOrder) {
    return {
      paymentId: `furl_${shopifyOrder.id}`,
      checkoutUrl: `https://checkout.furlpay.com/pay/furl_${shopifyOrder.id}`,
    };
  }

  mapStatus(furlpayStatus: string): string {
    switch (furlpayStatus) {
      case 'confirmed':
      case 'finalized':
        return 'paid';
      case 'failed':
        return 'failed';
      case 'refunded':
        return 'refunded';
      default:
        return 'pending';
    }
  }

  async handleCompletion(payment: any) {
    console.log(`Payment completed for ${payment.id}`);
  }
}
