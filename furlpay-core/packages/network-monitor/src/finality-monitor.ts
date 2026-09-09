import { Connection } from '@solana/web3.js';
import { EventEmitter } from 'events';
import { FinalityLag } from './types.js';

export class FinalityMonitor extends EventEmitter {
    private connection: Connection;
    private thresholdMs: number;

    constructor(connection: Connection, thresholdMs: number = 20000) {
        super();
        this.connection = connection;
        this.thresholdMs = thresholdMs;
    }

    public async getCurrentFinalityLag(): Promise<number> {
        const [confirmed, finalized] = await Promise.all([
            this.connection.getSlot('confirmed'),
            this.connection.getSlot('finalized')
        ]);
        
        const slotLag = confirmed - finalized;
        // Assuming ~400ms per slot
        return slotLag * 400;
    }

    public async isHealthy(): Promise<boolean> {
        const lag = await this.getCurrentFinalityLag();
        const healthy = lag < this.thresholdMs;
        if (!healthy) {
            this.emit('finality-alert', lag);
        }
        return healthy;
    }

    public onFinalityAlert(callback: (lagMs: number) => void) {
        this.on('finality-alert', callback);
    }
}
