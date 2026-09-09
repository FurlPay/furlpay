import { useState } from 'react';

export const useWallet = () => {
  const [connected, setConnected] = useState(false);
  const [address, setAddress] = useState<string | null>(null);

  const connect = async () => {
    // connect logic placeholder
    setConnected(true);
    setAddress('DummyAddress');
  };

  return { connected, address, connect };
};
