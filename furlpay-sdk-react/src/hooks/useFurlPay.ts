import { useContext } from 'react';
import { FurlPayContext } from '../providers/FurlPayProvider';

export function useFurlPay() {
  const context = useContext(FurlPayContext);
  if (!context) {
    throw new Error('useFurlPay must be used within a FurlPayProvider');
  }
  return context;
}
