import { useState, useEffect } from 'react';

export function useNetworkHealth() {
  const [health, setHealth] = useState<string>('HEALTHY');

  useEffect(() => {
    const i = setInterval(() => setHealth('HEALTHY'), 10000);
    return () => clearInterval(i);
  }, []);

  return { health };
}
