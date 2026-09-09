export enum KycTier {
  GUEST = 'guest',
  BASIC = 'basic',
  VERIFIED = 'verified',
  BUSINESS = 'business',
  INSTITUTIONAL = 'institutional',
}

export interface KycLimits {
  dailyLimit: number;
  monthlyLimit: number;
  perTxLimit: number;
}

export interface TransactionLimitCheck {
  allowed: boolean;
  remainingDaily: number;
  remainingMonthly: number;
  reason?: string;
}

export interface SanctionsResult {
  clean: boolean;
  lists: string[];
  riskScore: number;
}

export interface TravelRuleData {
  originator: {
    name: string;
    accountNumber: string;
    physicalAddress?: string;
    nationalId?: string;
  };
  beneficiary: {
    name: string;
    accountNumber: string;
  };
  amount: number;
  currency: string;
}
