import { describe, it, expect } from 'vitest';
import { KycTierEngine } from '../src/kyc-tiers';
import { KycTier } from '../src/types';

describe('KycTierEngine', () => {
  const engine = new KycTierEngine();

  it('should get limits for GUEST tier', () => {
    const limits = engine.getTierLimits(KycTier.GUEST);
    expect(limits.dailyLimit).toBe(100);
  });

  it('should check limits correctly', () => {
    const result = engine.checkLimit(KycTier.BASIC, 500, 200, 1000);
    expect(result.allowed).toBe(true);
  });

  it('should deny transaction exceeding daily limit', () => {
    const result = engine.checkLimit(KycTier.BASIC, 900, 200, 1000);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Daily limit exceeded');
  });

  it('should deny transaction exceeding per tx limit', () => {
    const result = engine.checkLimit(KycTier.BASIC, 1500, 0, 0);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Per transaction limit exceeded');
  });

  it('should determine required tier', () => {
    expect(engine.getRequiredTier(50)).toBe(KycTier.GUEST);
    expect(engine.getRequiredTier(5000)).toBe(KycTier.VERIFIED);
  });
});
