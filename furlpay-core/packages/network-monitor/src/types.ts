export type NetworkHealth = 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'RECOVERING';

export interface NetworkStatus {
    health: NetworkHealth;
    message?: string;
}

export interface SlotInfo {
    slot: number;
    timestamp: number;
}

export interface FinalityLag {
    slots: number;
    timeMs: number;
}

export interface DegradedModeConfig {
    stalledSlotTimeoutMs: number;
    maxFinalityLagMs: number;
    minTps: number;
    offlineTimeoutMs: number;
}

export interface NetworkEvent {
    type: string;
    health: NetworkHealth;
    details: any;
}

export interface TpsSnapshot {
    tps: number;
    timestamp: number;
}
