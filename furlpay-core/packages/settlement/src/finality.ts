import { Connection } from '@solana/web3.js';
import { FinalityMode } from '@furlpay/shared';
export class FinalityDetector {
  async waitForConfirmation(signature: string, connection: Connection): Promise<void> {}
  async waitForFinality(signature: string, connection: Connection, mode: FinalityMode): Promise<void> {}
  getCurrentFinalityMode(): FinalityMode { return process.env.ALPENGLOW_FINALITY_ENABLED === 'true' ? FinalityMode.ALPENGLOW : FinalityMode.TOWER_BFT; }
  getFinalityTimeMs(mode: FinalityMode): number { return mode === FinalityMode.ALPENGLOW ? 150 : 12800; }
}
