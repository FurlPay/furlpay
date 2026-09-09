import { describe, it, expect } from 'vitest';
import { StablecoinTransfer } from '../src/transfer';
import { Connection } from '@solana/web3.js';

describe('StablecoinTransfer', () => {
  it('should instantiate', () => {
    const connection = new Connection('https://api.mainnet-beta.solana.com');
    const transfer = new StablecoinTransfer(connection);
    expect(transfer).toBeDefined();
  });
});
