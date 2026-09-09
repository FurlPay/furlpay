import React, { createContext, useContext, ReactNode, useMemo } from 'react';

// Mocking @furlpay/js client type for structure
export interface FurlPayClient {
  apiKey: string;
  environment: 'production' | 'sandbox';
}

export const FurlPayContext = createContext<FurlPayClient | null>(null);

export interface FurlPayProviderProps {
  apiKey: string;
  environment?: 'production' | 'sandbox';
  children: ReactNode;
}

export function FurlPayProvider({ apiKey, environment = 'production', children }: FurlPayProviderProps) {
  const client = useMemo(() => ({ apiKey, environment }), [apiKey, environment]);
  return <FurlPayContext.Provider value={client}>{children}</FurlPayContext.Provider>;
}
