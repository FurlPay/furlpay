import { expect, test, describe, vi } from 'vitest';
import { PriorityFeeEstimator } from '../src/estimator.js';
import { Connection } from '@solana/web3.js';
import { FeeLevel } from '../src/types.js';

describe('PriorityFeeEstimator', () => {
    test('estimate handles empty fees safely', async () => {
        const mockConnection = {
            getRecentPrioritizationFees: vi.fn().mockResolvedValue([])
        } as unknown as Connection;

        const estimator = new PriorityFeeEstimator(mockConnection);
        const result = await estimator.estimate(FeeLevel.STANDARD);
        
        expect(result.microLamports).toBe(0);
        expect(result.level).toBe(FeeLevel.STANDARD);
    });

    test('estimate calculates percentiles', async () => {
        const mockFees = Array.from({ length: 100 }, (_, i) => ({ prioritizationFee: i + 1, slot: i }));
        const mockConnection = {
            getRecentPrioritizationFees: vi.fn().mockResolvedValue(mockFees)
        } as unknown as Connection;

        const estimator = new PriorityFeeEstimator(mockConnection);
        const result = await estimator.estimate(FeeLevel.STANDARD);
        
        // At 50th percentile of 1 to 100
        expect(result.microLamports).toBe(50);
    });
});
