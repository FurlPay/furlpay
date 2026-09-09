import { describe, it, expect } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import { getMint, isSupported, getDecimals, getSymbol } from '../src/tokens';

describe('tokens', () => {
  const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

  it('should get USDC mint', () => {
    const mint = getMint('USDC');
    expect(mint.toBase58()).toBe(USDC_MINT);
  });

  it('should check if supported', () => {
    expect(isSupported(new PublicKey(USDC_MINT))).toBe(true);
    expect(isSupported(new PublicKey('So11111111111111111111111111111111111111112'))).toBe(false);
  });

  it('should get decimals', () => {
    expect(getDecimals(new PublicKey(USDC_MINT))).toBe(6);
  });

  it('should get symbol', () => {
    expect(getSymbol(new PublicKey(USDC_MINT))).toBe('USDC');
  });
});
