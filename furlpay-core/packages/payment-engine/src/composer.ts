import { PaymentParams, ComposedTransaction, PaymentComposerConfig } from './types.js';
import { Transaction, SystemProgram, ComputeBudgetProgram } from '@solana/web3.js';
export class PaymentComposer {
  constructor(private config: PaymentComposerConfig) {}
  composeTransfer(params: PaymentParams): ComposedTransaction {
    const tx = new Transaction();
    tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10000 }));
    return { tx };
  }
}
