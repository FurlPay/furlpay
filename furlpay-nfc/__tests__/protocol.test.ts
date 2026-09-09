import { describe, it, expect } from 'vitest';
import { encodeAmount, decodeAmount } from '../src/protocol';

describe('NFC Protocol', () => {
  it('should encode amounts correctly', () => {
    expect(encodeAmount('10.5', 6)).toBe('10500000');
    expect(encodeAmount('0.000001', 6)).toBe('1');
    expect(encodeAmount('100', 6)).toBe('100000000');
  });

  it('should decode amounts correctly', () => {
    expect(decodeAmount('10500000', 6)).toBe('10.500000');
    expect(decodeAmount('1', 6)).toBe('0.000001');
    expect(decodeAmount('100000000', 6)).toBe('100.000000');
  });
});
