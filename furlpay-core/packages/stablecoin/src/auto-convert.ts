import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import { SUPPORTED_STABLECOINS } from './tokens';

export interface SwapQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
}

export class AutoConverter {
  constructor(private connection: Connection, private jupiterApiUrl: string = 'https://quote-api.jup.ag/v6') {}

  async getQuote(inputMint: PublicKey, outputMint: PublicKey, amount: number): Promise<SwapQuote> {
    // TODO: Implement actual Jupiter API integration
    return {
      inputMint: inputMint.toBase58(),
      outputMint: outputMint.toBase58(),
      inAmount: amount.toString(),
      outAmount: amount.toString(),
    };
  }

  async buildSwapTransaction(quote: SwapQuote): Promise<Transaction> {
    // TODO: Implement Jupiter swap transaction build
    return new Transaction();
  }

  getSupportedPairs(): string[][] {
    const symbols = Array.from(SUPPORTED_STABLECOINS.keys());
    const pairs: string[][] = [];
    for (let i = 0; i < symbols.length; i++) {
      for (let j = i + 1; j < symbols.length; j++) {
        pairs.push([symbols[i], symbols[j]]);
      }
    }
    return pairs;
  }
}
