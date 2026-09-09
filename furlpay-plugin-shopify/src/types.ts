export interface ShopifyOrder {
  id: string;
  total_price: string;
  currency: string;
  financial_status: string;
  email: string;
}

export interface ShopifyPaymentSession {
  id: string;
  status: string;
  amount: string;
  currency: string;
  cancel_url: string;
}

export interface ShopifyWebhookEvent {
  id: string;
  topic: string;
  payload: any;
}
