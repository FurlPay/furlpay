import { describe, it, expect } from 'vitest';
import { verify, constructEvent } from '../src/webhooks';
import crypto from 'crypto';

describe('Webhooks', () => {
  const secret = 'whsec_test_secret';
  const payload = JSON.stringify({ id: 'evt_123', type: 'payment.completed' });

  it('verifies a valid signature', () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const signedPayload = `${timestamp}.${payload}`;
    const signature = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
    const header = `t=${timestamp},v1=${signature}`;

    expect(verify(payload, header, secret)).toBe(true);
    
    const event = constructEvent(payload, header, secret);
    expect(event.id).toBe('evt_123');
  });

  it('rejects an expired signature', () => {
    const timestamp = Math.floor(Date.now() / 1000) - 1000;
    const signedPayload = `${timestamp}.${payload}`;
    const signature = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
    const header = `t=${timestamp},v1=${signature}`;

    expect(verify(payload, header, secret)).toBe(false);
  });
});
