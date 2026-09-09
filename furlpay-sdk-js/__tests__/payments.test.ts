import { describe, it, expect, vi } from 'vitest';
import { FurlPay } from '../src/client';

describe('Payments', () => {
  it('creates a payment', async () => {
    const client = new FurlPay({ apiKey: 'test_key', environment: 'sandbox' });
    
    const mockResponse = {
      id: 'pay_123',
      status: 'pending',
      amount: 10,
      currency: 'USDC',
      merchant: 'merch_123',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    vi.spyOn(client, '_request').mockResolvedValue(mockResponse);

    const payment = await client.payments.create({
      amount: 10,
      currency: 'USDC',
      merchantId: 'merch_123'
    });

    expect(payment.id).toBe('pay_123');
    expect(payment.amount).toBe(10);
  });
});
