import { SettlementTier, FinalityMode } from '@furlpay/shared';
export class SettlementTierEngine {
  determineTier(amountUsd: number): SettlementTier {
    if (amountUsd < 50) return SettlementTier.INSTANT;
    if (amountUsd <= 500) return SettlementTier.STANDARD;
    if (amountUsd <= 10000) return SettlementTier.HIGH_VALUE;
    return SettlementTier.INSTITUTIONAL;
  }
  getWaitTime(tier: SettlementTier, finalityMode: FinalityMode): number { return finalityMode === FinalityMode.ALPENGLOW ? 150 : 12800; }
  shouldWaitForFinality(tier: SettlementTier, finalityMode: FinalityMode): boolean { return tier !== SettlementTier.INSTANT; }
}
