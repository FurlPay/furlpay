import { Connection } from '@solana/web3.js';

export class TpsTracker {
    private connection: Connection;
    private windowSizeSeconds: number;

    constructor(connection: Connection, windowSizeSeconds: number = 60) {
        this.connection = connection;
        this.windowSizeSeconds = windowSizeSeconds;
    }

    public async getCurrentTps(): Promise<number> {
        const samples = await this.connection.getRecentPerformanceSamples(1);
        if (samples.length === 0) return 0;
        
        const sample = samples[0];
        if (sample.samplePeriodSecs === 0) return 0;
        
        return sample.numTransactions / sample.samplePeriodSecs;
    }

    public async getAverageTps(periodMinutes: number = 1): Promise<number> {
        const limit = Math.ceil((periodMinutes * 60) / 60); // API typically returns 60s samples
        const samples = await this.connection.getRecentPerformanceSamples(limit);
        
        if (samples.length === 0) return 0;
        
        let totalTx = 0;
        let totalSecs = 0;
        
        for (const sample of samples) {
            totalTx += sample.numTransactions;
            totalSecs += sample.samplePeriodSecs;
        }
        
        if (totalSecs === 0) return 0;
        return totalTx / totalSecs;
    }

    public async isAboveBaseline(baseline: number = 500): Promise<boolean> {
        const current = await this.getCurrentTps();
        return current >= baseline;
    }
}
