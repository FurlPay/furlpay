import React, { createContext, useContext, ReactNode } from 'react';
import { Connection } from '@solana/web3.js';

interface FurlPayContextState {
  connection: Connection;
  environment: 'mainnet-beta' | 'devnet';
}

const FurlPayContext = createContext<FurlPayContextState | null>(null);

export const FurlPayProvider = ({
  children,
  endpoint,
  environment = 'mainnet-beta'
}: {
  children: ReactNode;
  endpoint: string;
  environment?: 'mainnet-beta' | 'devnet';
}) => {
  const connection = new Connection(endpoint);

  return (
    <FurlPayContext.Provider value={{ connection, environment }}>
      {children}
    </FurlPayContext.Provider>
  );
};

export const useFurlPay = () => {
  const context = useContext(FurlPayContext);
  if (!context) {
    throw new Error('useFurlPay must be used within a FurlPayProvider');
  }
  return context;
};
