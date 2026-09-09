import React from 'react';
import { QRCode } from './QRCode';
import { PaymentStatus } from './PaymentStatus';

export interface CheckoutFormProps {
  amount: number;
  currency: string;
  merchantId: string;
  onComplete?: () => void;
}

export function CheckoutForm({ amount, currency, merchantId, onComplete }: CheckoutFormProps) {
  return (
    <div className="furlpay-checkout-form">
      <h3>Checkout: {amount} {currency}</h3>
      <QRCode paymentUrl={`solana:${merchantId}?amount=${amount}`} />
      <PaymentStatus paymentId="mock_id" onFinalized={onComplete} />
    </div>
  );
}
