import { expect, test, describe, vi } from 'vitest';
import { RpcLoadBalancer } from '../src/balancer.js';
import { createCustomProvider } from '../src/providers.js';

describe('RpcLoadBalancer', () => {
    test('should initialize with providers', () => {
        const balancer = new RpcLoadBalancer({
            providers: [createCustomProvider('test', 'http://localhost')],
            healthCheckIntervalMs: 1000,
            maxLatencyMs: 500,
            strategy: 'round-robin'
        });
        expect(balancer).toBeDefined();
        balancer.stop();
    });

    test('should return connection', () => {
        const balancer = new RpcLoadBalancer({
            providers: [createCustomProvider('test', 'http://localhost')],
            healthCheckIntervalMs: 1000,
            maxLatencyMs: 500,
            strategy: 'round-robin'
        });
        const conn = balancer.getConnection();
        expect(conn.rpcEndpoint).toBe('http://localhost');
        balancer.stop();
    });
});
