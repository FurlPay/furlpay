import { EventEmitter } from 'events';
import { DegradedModeConfig, NetworkHealth } from './types.js';

export class DegradedModeManager extends EventEmitter {
    private config: DegradedModeConfig;
    private currentState: NetworkHealth = 'HEALTHY';
    private degradedSignals: number = 0;
    
    constructor(config: DegradedModeConfig) {
        super();
        this.config = config;
    }

    public evaluate(slotProducing: boolean, finalityLagMs: number, tps: number): NetworkHealth {
        let isDegraded = false;
        let isDown = false;

        if (!slotProducing) {
            // Assume the caller evaluates time offline before passing slotProducing=false.
            // Simplified logic based on parameters:
            isDegraded = true; // Stalled slots
            // If offline > 60s, it's DOWN (would need tracking of how long it's false, keeping simple)
            // Let's assume if finalityLagMs is extreme, it's down.
        }

        if (finalityLagMs > this.config.maxFinalityLagMs) {
            isDegraded = true;
        }

        if (tps < this.config.minTps) {
            isDegraded = true;
        }

        if (isDegraded) {
            this.degradedSignals++;
        } else {
            this.degradedSignals = 0;
        }

        if (this.degradedSignals >= 5 || finalityLagMs > this.config.maxFinalityLagMs * 3) {
            isDown = true;
        }

        const newState = isDown ? 'DOWN' : (isDegraded ? 'DEGRADED' : (this.currentState !== 'HEALTHY' ? 'RECOVERING' : 'HEALTHY'));
        
        // Simple state transition for recovering
        const finalState = (newState === 'RECOVERING' && this.degradedSignals === 0) ? 'HEALTHY' : newState;

        if (this.currentState !== finalState) {
            this.currentState = finalState;
            this.emit('state-change', this.currentState);
        }

        return this.currentState;
    }

    public getRecommendation() {
        switch (this.currentState) {
            case 'HEALTHY':
                return { allowHighValue: true, allowLowValue: true, message: 'Network operating normally' };
            case 'DEGRADED':
            case 'RECOVERING':
                return { allowHighValue: false, allowLowValue: true, message: 'Network degraded, high value tx paused' };
            case 'DOWN':
                return { allowHighValue: false, allowLowValue: false, message: 'Network offline, all tx paused' };
        }
    }
}
