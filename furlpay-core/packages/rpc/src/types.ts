/**
 * Types for @furlpay/rpc
 */

export interface RpcProvider {
    name: string;
    endpoint: string;
    wsEndpoint?: string;
    staked: boolean;
    weight: number;
    region?: string;
}

export interface RpcHealthStatus {
    healthy: boolean;
    latencyMs: number;
    lastChecked: number;
    errorRate: number;
}

export interface BalancerConfig {
    providers: RpcProvider[];
    healthCheckIntervalMs: number;
    maxLatencyMs: number;
    strategy: 'round-robin' | 'lowest-latency' | 'weighted';
}
