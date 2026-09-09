import { useState } from 'react';

export const usePayment = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const processPayment = async (amount: number, to: string) => {
    setLoading(true);
    setError(null);
    try {
      // payment logic placeholder
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (err: any) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  return { processPayment, loading, error };
};
