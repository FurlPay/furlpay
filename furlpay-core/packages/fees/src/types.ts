export enum FeeLevel {
    ECONOMY = 'ECONOMY',
    STANDARD = 'STANDARD',
    FAST = 'FAST',
    INSTANT = 'INSTANT'
}

export interface FeeEstimate {
    microLamports: number;
    level: FeeLevel;
    confidence: number;
}

export interface ComputeBudget {
    units: number;
    unitPrice: number; // in microLamports
}

export interface FeeConfig {
    maxFeeLamports: number;
    defaultLevel: FeeLevel;
    absorb: boolean;
}
