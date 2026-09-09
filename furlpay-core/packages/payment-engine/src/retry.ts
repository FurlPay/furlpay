import { Transaction } from '@solana/web3.js';
export class RetryEngine {
  async submit(tx: Transaction): Promise<string> { return 'signature'; }
}
