import crypto from 'crypto';
import { saveSession } from './session-store';

export async function createSession(params: any) {
  const sessionId = crypto.randomUUID();
  const paymentId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 mins

  const session = {
    id: sessionId,
    paymentId,
    url: `/checkout/${sessionId}`,
    amount: params.amount,
    currency: params.currency,
    merchantId: params.merchantId,
    successUrl: params.successUrl,
    cancelUrl: params.cancelUrl,
    metadata: params.metadata,
    expiresAt,
  };

  await saveSession(session);
  return session;
}

export async function checkPaymentStatus(paymentId: string) {
  // Stub status logic
  return {
    paymentId,
    status: Math.random() > 0.8 ? 'completed' : 'pending',
  };
}
