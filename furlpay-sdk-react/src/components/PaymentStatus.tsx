import React, { useEffect, useState } from 'react';

export interface PaymentStatusProps {
  paymentId: string;
  onConfirmed?: () => void;
  onFinalized?: () => void;
  pollIntervalMs?: number;
}

export function PaymentStatus({ paymentId, onConfirmed, onFinalized, pollIntervalMs = 2000 }: PaymentStatusProps) {
  const [status, setStatus] = useState<'WAITING' | 'CONFIRMED' | 'FINALIZED'>('WAITING');

  useEffect(() => {
    let timer = setTimeout(() => {
      setStatus('CONFIRMED');
      onConfirmed?.();
      setTimeout(() => {
        setStatus('FINALIZED');
        onFinalized?.();
      }, 1500);
    }, pollIntervalMs);
    return () => clearTimeout(timer);
  }, [paymentId, pollIntervalMs, onConfirmed, onFinalized]);

  return (
    <div className="furlpay-payment-status">
      {status === 'WAITING' && <span>⏳ Waiting</span>}
      {status === 'CONFIRMED' && <span>✅ Confirmed</span>}
      {status === 'FINALIZED' && <span>🔒 Finalized</span>}
    </div>
  );
}
