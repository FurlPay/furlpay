export interface PriceFeed {
  id: string;
  price: number;
  confidence: number;
  timestamp: number;
}

export interface FxRate {
  from: string;
  to: string;
  rate: number;
  timestamp: number;
}

export interface FxQuote {
  id: string;
  from: string;
  to: string;
  rate: number;
  expiresAt: number;
}

export interface OracleConfig {
  rpcUrl?: string;
  pythProgramId?: string;
}
