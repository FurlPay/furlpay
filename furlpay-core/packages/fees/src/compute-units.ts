import { Transaction, Connection } from '@solana/web3.js';

export class ComputeUnitCalculator {
    
    public async estimateUnits(tx: Transaction, connection: Connection): Promise<number> {
        try {
            const simulation = await connection.simulateTransaction(tx);
            if (simulation.value.err) {
                throw new Error(`Simulation failed: ${JSON.stringify(simulation.value.err)}`);
            }
            return simulation.value.unitsConsumed || 200000;
        } catch (error) {
            return 200000; // Fallback
        }
    }

    public getTypicalUnits(type: 'sol-transfer' | 'spl-transfer' | 'swap' | 'memo'): number {
        switch (type) {
            case 'sol-transfer': return 300; // Typically very low, using 300 as safe buffer
            case 'spl-transfer': return 50000;
            case 'swap': return 300000;
            case 'memo': return 500;
            default: return 200000;
        }
    }

    public optimizeBudget(estimated: number, safetyMargin: number = 1.2): number {
        return Math.ceil(estimated * safetyMargin);
    }
}
