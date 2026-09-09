import { expect, test, describe } from 'vitest';
import { DegradedModeManager } from '../src/degraded-mode.js';

describe('DegradedModeManager', () => {
    test('transitions to degraded on low tps', () => {
        const manager = new DegradedModeManager({
            stalledSlotTimeoutMs: 5000,
            maxFinalityLagMs: 20000,
            minTps: 500,
            offlineTimeoutMs: 60000
        });

        const state = manager.evaluate(true, 1000, 400); // TPS 400 < 500
        expect(state).toBe('DEGRADED');
    });

    test('transitions to down after multiple degraded signals', () => {
        const manager = new DegradedModeManager({
            stalledSlotTimeoutMs: 5000,
            maxFinalityLagMs: 20000,
            minTps: 500,
            offlineTimeoutMs: 60000
        });

        for (let i = 0; i < 4; i++) {
            manager.evaluate(true, 1000, 400);
        }
        const state = manager.evaluate(true, 1000, 400); // 5th signal
        expect(state).toBe('DOWN');
    });
});
