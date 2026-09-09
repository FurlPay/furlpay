import { EventEmitter } from 'events';
import { Connection } from '@solana/web3.js';
import { RpcProvider, BalancerConfig, RpcHealthStatus } from './types.js';
import { RpcHealthChecker } from './health.js';

export class RpcLoadBalancer extends EventEmitter {
    private config: BalancerConfig;
    private healthChecker: RpcHealthChecker;
    private currentProviderIndex: number = 0;
    private connections: Map<string, Connection> = new Map();

    constructor(config: BalancerConfig) {
        super();
        this.config = config;
        this.healthChecker = new RpcHealthChecker(config.providers, config.healthCheckIntervalMs);

        // Pre-initialize connections
        for (const provider of config.providers) {
            this.connections.set(provider.endpoint, new Connection(provider.endpoint, 'confirmed'));
        }

        this.setupHealthEvents();
        this.healthChecker.start();
    }

    private setupHealthEvents() {
        this.healthChecker.on('provider-down', (provider: RpcProvider) => {
            this.emit('provider-down', provider);
            // If primary went down, trigger failover logic
            const currentProvider = this.getHealthyProviders()[this.currentProviderIndex];
            if (!currentProvider || currentProvider.endpoint === provider.endpoint) {
                this.emit('failover', this.getConnection());
            }
        });

        this.healthChecker.on('provider-recovered', (provider: RpcProvider) => {
            this.emit('provider-recovered', provider);
        });
    }

    public getConnection(): Connection {
        const healthyProviders = this.getHealthyProviders();
        if (healthyProviders.length === 0) {
            throw new Error('No healthy providers available');
        }

        let selectedProvider: RpcProvider;

        switch (this.config.strategy) {
            case 'lowest-latency':
                selectedProvider = this.selectByLatency(healthyProviders);
                break;
            case 'weighted':
                selectedProvider = this.selectByWeight(healthyProviders);
                break;
            case 'round-robin':
            default:
                selectedProvider = this.rotateProvider(healthyProviders);
                break;
        }

        return this.connections.get(selectedProvider.endpoint)!;
    }

    public getHealthyProviders(): RpcProvider[] {
        return this.config.providers.filter(p => this.healthChecker.isHealthy(p));
    }

    private rotateProvider(healthyProviders: RpcProvider[]): RpcProvider {
        this.currentProviderIndex = (this.currentProviderIndex + 1) % healthyProviders.length;
        return healthyProviders[this.currentProviderIndex];
    }

    private selectByLatency(healthyProviders: RpcProvider[]): RpcProvider {
        const statuses = this.healthChecker.getStatus();
        return healthyProviders.reduce((best, current) => {
            const bestStatus = statuses.get(best.endpoint);
            const currentStatus = statuses.get(current.endpoint);
            if (!bestStatus) return current;
            if (!currentStatus) return best;
            return currentStatus.latencyMs < bestStatus.latencyMs ? current : best;
        }, healthyProviders[0]);
    }

    private selectByWeight(healthyProviders: RpcProvider[]): RpcProvider {
        const totalWeight = healthyProviders.reduce((sum, p) => sum + (p.weight || 1), 0);
        let random = crypto.getRandomValues(new Uint32Array(1))[0] / (0xffffffff + 1); // Using secure random
        let weightSum = 0;

        for (const provider of healthyProviders) {
            weightSum += (provider.weight || 1) / totalWeight;
            if (random <= weightSum) {
                return provider;
            }
        }
        return healthyProviders[0];
    }

    public stop() {
        this.healthChecker.stop();
    }
}
