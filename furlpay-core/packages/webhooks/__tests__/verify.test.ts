import { describe, it, expect } from 'vitest';
import { WebhookVerifier } from '../src/verify';
import { createHmac } from 'crypto';

describe('WebhookVerifier', () => {
  const verifier = new WebhookVerifier();
  const secret = 'test_secret';
  const body = JSON.stringify({ id: 'test', amount: 100 });

  it('should verify valid signature', () => {
    const timestamp = Date.now().toString();
    const signature = createHmac('sha256', secret).update(body).digest('hex');
    expect(verifier.verify(body, signature, secret, timestamp)).toBe(true);
  });

  it('should reject invalid signature', () => {
    const timestamp = Date.now().toString();
    expect(verifier.verify(body, 'invalid_sig', secret, timestamp)).toBe(false);
  });

  it('should reject expired timestamp', () => {
    const timestamp = (Date.now() - 600000).toString(); // 10 minutes ago
    const signature = createHmac('sha256', secret).update(body).digest('hex');
    expect(verifier.verify(body, signature, secret, timestamp)).toBe(false);
  });
});
