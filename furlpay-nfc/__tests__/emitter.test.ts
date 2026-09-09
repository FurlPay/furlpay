import { describe, it, expect } from 'vitest';
import { NfcPaymentEmitter } from '../src/emitter';

describe('NfcPaymentEmitter', () => {
  it('encodes and decodes NDEF payment data', () => {
    const emitter = new NfcPaymentEmitter();
    const req = {
      merchantId: 'merch_123',
      amount: 10,
      currency: 'USDC'
    };
    
    const encoded = emitter.encodePayment(req);
    const decoded = emitter.decodePayment(encoded);
    
    expect(decoded).toEqual(req);
  });
});
