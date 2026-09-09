export interface CorridorLimits {
  dailyLimit: number;
  monthlyLimit: number;
  requiresEnhancedKyc: boolean;
}

export function getCorridorLimits(fromCountry: string, toCountry: string): CorridorLimits {
  const corridor = `${fromCountry}-${toCountry}`;
  
  switch (corridor) {
    case 'US-IN':
      return { dailyLimit: 5000, monthlyLimit: 25000, requiresEnhancedKyc: false };
    case 'US-EU':
      return { dailyLimit: 10000, monthlyLimit: 50000, requiresEnhancedKyc: false };
    case 'US-MX':
      return { dailyLimit: 3000, monthlyLimit: 15000, requiresEnhancedKyc: false };
    case 'EU-US':
      return { dailyLimit: 10000, monthlyLimit: 50000, requiresEnhancedKyc: false };
    default:
      return { dailyLimit: 1000, monthlyLimit: 5000, requiresEnhancedKyc: true };
  }
}
