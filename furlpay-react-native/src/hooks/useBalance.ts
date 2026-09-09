import { useState, useEffect } from 'react';

export const useBalance = (address: string | null) => {
  const [balance, setBalance] = useState<number>(0);

  useEffect(() => {
    if (!address) return;
    // fetch balance logic
    setBalance(1.23);
  }, [address]);

  return { balance };
};
