import crypto from 'crypto';
import type { WebhookEvent } from './types';
import { AuthenticationError } from './errors';

export function verify(body: string, signature: string, secret: string, tolerance: number = 300): boolean {
  if (!body || !signature || !secret) {
    return false;
  }

  const parts = signature.split(',');
  let timestamp = '';
  let sig = '';

  for (const part of parts) {
    const [key, value] = part.split('=');
    if (key === 't') timestamp = value;
    if (key === 'v1') sig = value;
  }

  if (!timestamp || !sig) {
    return false;
  }

  const timeDiff = Math.abs(Math.floor(Date.now() / 1000) - parseInt(timestamp, 10));
  if (timeDiff > tolerance) {
    return false;
  }

  const signedPayload = `${timestamp}.${body}`;
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(sig, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  } catch (err) {
    return false;
  }
}

export function constructEvent(body: string, signature: string, secret: string): WebhookEvent {
  if (!verify(body, signature, secret)) {
    throw new AuthenticationError('Invalid webhook signature');
  }

  return JSON.parse(body) as WebhookEvent;
}
