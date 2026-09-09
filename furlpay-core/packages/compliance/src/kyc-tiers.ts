import { KycTier, KycLimits, TransactionLimitCheck } from './types';

export class KycTierEngine {
  getTierLimits(tier: KycTier): KycLimits {
    switch (tier) {
      case KycTier.GUEST:
        return { dailyLimit: 100, monthlyLimit: 500, perTxLimit: 100 };
      case KycTier.BASIC:
        return { dailyLimit: 1000, monthlyLimit: 5000, perTxLimit: 1000 };
      case KycTier.VERIFIED:
        return { dailyLimit: 10000, monthlyLimit: 50000, perTxLimit: 10000 };
      case KycTier.BUSINESS:
        return { dailyLimit: 100000, monthlyLimit: 1000000, perTxLimit: 100000 };
      case KycTier.INSTITUTIONAL:
        return { dailyLimit: 10000000, monthlyLimit: 100000000, perTxLimit: 10000000 };
      default:
        throw new Error(`Unknown KYC tier: ${tier}`);
    }
  }

  checkLimit(tier: KycTier, amountUsd: number, usedTodayUsd: number, usedThisMonthUsd: number): TransactionLimitCheck {
    const limits = this.getTierLimits(tier);
    
    if (amountUsd > limits.perTxLimit) {
      return { allowed: false, remainingDaily: limits.dailyLimit - usedTodayUsd, remainingMonthly: limits.monthlyLimit - usedThisMonthUsd, reason: `Per transaction limit exceeded (Max: $${limits.perTxLimit})` };
    }
    if (usedTodayUsd + amountUsd > limits.dailyLimit) {
      return { allowed: false, remainingDaily: Math.max(0, limits.dailyLimit - usedTodayUsd), remainingMonthly: limits.monthlyLimit - usedThisMonthUsd, reason: `Daily limit exceeded (Max: $${limits.dailyLimit})` };
    }
    if (usedThisMonthUsd + amountUsd > limits.monthlyLimit) {
      return { allowed: false, remainingDaily: limits.dailyLimit - usedTodayUsd, remainingMonthly: Math.max(0, limits.monthlyLimit - usedThisMonthUsd), reason: `Monthly limit exceeded (Max: $${limits.monthlyLimit})` };
    }

    return {
      allowed: true,
      remainingDaily: limits.dailyLimit - (usedTodayUsd + amountUsd),
      remainingMonthly: limits.monthlyLimit - (usedThisMonthUsd + amountUsd),
    };
  }

  getRequiredTier(amountUsd: number): KycTier {
    if (amountUsd <= 100) return KycTier.GUEST;
    if (amountUsd <= 1000) return KycTier.BASIC;
    if (amountUsd <= 10000) return KycTier.VERIFIED;
    if (amountUsd <= 100000) return KycTier.BUSINESS;
    return KycTier.INSTITUTIONAL;
  }
}
