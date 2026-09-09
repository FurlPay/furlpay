import { useState, useEffect } from 'react';

export const usePaymentStatus = (signature: string | null) => {
  const [status, setStatus] = useState<'pending' | 'success' | 'failed' | null>(null);

  useEffect(() => {
    if (!signature) return;
    setStatus('pending');
    
    // placeholder logic
    const timer = setTimeout(() => {
      setStatus('success');
    }, 2000);
    
    return () => clearTimeout(timer);
  }, [signature]);

  return { status };
};
