import { describe, it, expect, vi } from 'vitest';
import { FurlPay } from '../src/client';
import { AuthenticationError } from '../src/errors';

describe('FurlPay Client', () => {
  it('throws AuthenticationError if apiKey is missing', () => {
    expect(() => new FurlPay({ apiKey: '', environment: 'sandbox' })).toThrow(AuthenticationError);
  });

  it('initializes correctly with valid config', () => {
    const client = new FurlPay({ apiKey: 'test_key', environment: 'sandbox' });
    expect(client.payments).toBeDefined();
    expect(client.checkout).toBeDefined();
  });
});
