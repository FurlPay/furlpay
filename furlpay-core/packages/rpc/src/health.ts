import { EventEmitter } from 'events';
import { Connection } from '@solana/web3.js';
import { RpcProvider, RpcHealthStatus } from './types.js';

export class RpcHealthChecker extends EventEmitter {
    private providers: RpcProvider[];
    private intervalMs: number;
    private timer: NodeJS.Timeout | null = null;
    private statuses: Map<string, RpcHealthStatus> = new Map();

    constructor(providers: RpcProvider[], intervalMs: number) {
        super();
        this.providers = providers;
        this.intervalMs = intervalMs;
        
        for (const provider of providers) {
            this.statuses.set(provider.endpoint, {
                healthy: true, // Assume healthy initially
                latencyMs: 0,
                lastChecked: Date.now(),
                errorRate: 0
            });
        }
    }

    public start() {
        if (this.timer) return;
        this.timer = setInterval(() => {
            this.checkAll();
        }, this.intervalMs);
        this.checkAll();
    }

    public stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    private async checkAll() {
        for (const provider of this.providers) {
            try {
                await this.checkHealth(provider);
            } catch (e) {
                // error handled in checkHealth
            }
        }
    }

    public async checkHealth(provider: RpcProvider): Promise<RpcHealthStatus> {
        const connection = new Connection(provider.endpoint, 'confirmed');
        const start = Date.now();
        const currentStatus = this.statuses.get(provider.endpoint)!;
        let isHealthy = false;
        
        try {
            await Promise.all([
                connection.getSlot(),
                connection.getLatestBlockhash()
            ]);
            const latencyMs = Date.now() - start;
            isHealthy = true;
            
            const newStatus: RpcHealthStatus = {
                healthy: true,
                latencyMs,
                lastChecked: Date.now(),
                errorRate: currentStatus.errorRate * 0.9 // Decay error rate
            };
            this.statuses.set(provider.endpoint, newStatus);
            
            if (!currentStatus.healthy) {
                this.emit('provider-recovered', provider);
            }
            return newStatus;
        } catch (error) {
            const newStatus: RpcHealthStatus = {
                healthy: false,
                latencyMs: -1,
                lastChecked: Date.now(),
                errorRate: Math.min(1, currentStatus.errorRate + 0.1)
            };
            this.statuses.set(provider.endpoint, newStatus);
            
            if (currentStatus.healthy) {
                this.emit('provider-down', provider);
            }
            return newStatus;
        }
    }

    public getStatus(): Map<string, RpcHealthStatus> {
        return this.statuses;
    }

    public isHealthy(provider: RpcProvider): boolean {
        return this.statuses.get(provider.endpoint)?.healthy ?? false;
    }
}
