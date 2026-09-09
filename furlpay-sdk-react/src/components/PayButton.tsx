import React, { useState } from 'react';

export interface PayButtonProps {
  amount: number;
  currency: string;
  merchantId: string;
  onSuccess?: (result: any) => void;
  onError?: (error: any) => void;
  label?: string;
  className?: string;
  disabled?: boolean;
}

export function PayButton({ amount, currency, merchantId, onSuccess, onError, label = 'Pay Now', className, disabled }: PayButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    setLoading(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 500));
      onSuccess?.({ id: 'tx_123', status: 'CONFIRMED' });
    } catch (e) {
      onError?.(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={disabled || loading}
      className={`furlpay-pay-btn ${className || ''}`}
      aria-label={label}
      aria-busy={loading}
    >
      {loading ? 'Processing...' : label}
    </button>
  );
}
