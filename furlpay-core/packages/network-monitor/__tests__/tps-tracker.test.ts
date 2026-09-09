import { expect, test, describe, vi } from 'vitest';
import { TpsTracker } from '../src/tps-tracker.js';
import { Connection } from '@solana/web3.js';

describe('TpsTracker', () => {
    test('calculates correct TPS', async () => {
        const mockConnection = {
            getRecentPerformanceSamples: vi.fn().mockResolvedValue([{
                numTransactions: 60000,
                samplePeriodSecs: 60,
                slot: 1000
            }])
        } as unknown as Connection;

        const tracker = new TpsTracker(mockConnection);
        const tps = await tracker.getCurrentTps();
        
        expect(tps).toBe(1000); // 60000 / 60
    });
});
