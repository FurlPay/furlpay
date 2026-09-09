import { useState } from 'react';

export const useBiometric = () => {
  const [isSupported, setIsSupported] = useState(false);

  const authenticate = async () => {
    // biometric logic
    return true;
  };

  return { isSupported, authenticate };
};
