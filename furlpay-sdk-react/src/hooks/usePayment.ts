import { useState } from 'react';

export function usePayment() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<any>(null);
  const [payment, setPayment] = useState<any>(null);

  const createPayment = async (params: any) => {
    setLoading(true);
    try {
      await new Promise(r => setTimeout(r, 500));
      setPayment({ id: 'payment_mock' });
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  };

  return { createPayment, payment, loading, error };
}
