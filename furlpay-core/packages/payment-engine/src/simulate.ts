import { Transaction, Connection } from '@solana/web3.js';
import { SimulationResult } from './types.js';
export class PreflightSimulator {
  async simulate(tx: Transaction, connection: Connection): Promise<SimulationResult> {
    const res = await connection.simulateTransaction(tx);
    return { success: !res.value.err, error: res.value.err };
  }
}
