import { Connection, PublicKey, Transaction, ComputeBudgetProgram } from '@solana/web3.js';
import { FeeLevel, FeeEstimate, FeeConfig } from './types.js';

export class PriorityFeeEstimator {
    private connection: Connection;
    private config: FeeConfig;

    constructor(connection: Connection, config?: Partial<FeeConfig>) {
        this.connection = connection;
        this.config = {
            maxFeeLamports: 10000000, // 0.01 SOL default max
            defaultLevel: FeeLevel.STANDARD,
            absorb: false,
            ...config
        };
    }

    public async estimate(level: FeeLevel = this.config.defaultLevel): Promise<FeeEstimate> {
        const fees = await this.connection.getRecentPrioritizationFees();
        if (fees.length === 0) {
            return { microLamports: 0, level, confidence: 0 };
        }

        const sortedFees = fees.map(f => f.prioritizationFee).sort((a, b) => a - b);
        let percentile = 0.5;

        switch (level) {
            case FeeLevel.ECONOMY: percentile = 0.25; break;
            case FeeLevel.STANDARD: percentile = 0.50; break;
            case FeeLevel.FAST: percentile = 0.75; break;
            case FeeLevel.INSTANT: percentile = 0.95; break;
        }

        const estimatedFee = this.getPercentile(sortedFees, percentile);
        // Ensure cap
        const cappedFee = Math.min(estimatedFee, this.config.maxFeeLamports * 1000000); // roughly converted to microlamports for comparison, but simplified here

        return {
            microLamports: Math.floor(cappedFee),
            level,
            confidence: 0.8
        };
    }

    public async estimateForProgram(programId: PublicKey, level: FeeLevel = this.config.defaultLevel): Promise<FeeEstimate> {
        const fees = await this.connection.getRecentPrioritizationFees({
            lockedWritableAccounts: [programId]
        });
        
        if (fees.length === 0) {
            return this.estimate(level); // Fallback to global
        }

        const sortedFees = fees.map(f => f.prioritizationFee).sort((a, b) => a - b);
        let percentile = 0.5;

        switch (level) {
            case FeeLevel.ECONOMY: percentile = 0.25; break;
            case FeeLevel.STANDARD: percentile = 0.50; break;
            case FeeLevel.FAST: percentile = 0.75; break;
            case FeeLevel.INSTANT: percentile = 0.95; break;
        }

        return {
            microLamports: Math.floor(this.getPercentile(sortedFees, percentile)),
            level,
            confidence: 0.9
        };
    }

    public addComputeBudget(tx: Transaction, estimate: FeeEstimate, computeUnits: number = 200000): Transaction {
        tx.add(
            ComputeBudgetProgram.setComputeUnitLimit({
                units: computeUnits
            }),
            ComputeBudgetProgram.setComputeUnitPrice({
                microLamports: estimate.microLamports
            })
        );
        return tx;
    }

    private getPercentile(fees: number[], p: number): number {
        if (fees.length === 0) return 0;
        const index = Math.floor((fees.length - 1) * p);
        return fees[index];
    }
}
