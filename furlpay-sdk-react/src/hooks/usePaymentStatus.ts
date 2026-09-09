import { useState, useEffect } from 'react';

export function usePaymentStatus(paymentId: string) {
  const [status, setStatus] = useState<string>('PENDING');

  useEffect(() => {
    if (!paymentId) return;
    const interval = setInterval(() => {
      setStatus('FINALIZED');
    }, 2000);
    return () => clearInterval(interval);
  }, [paymentId]);

  return { status };
}
