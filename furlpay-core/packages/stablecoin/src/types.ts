import { PublicKey } from '@solana/web3.js';

export interface StablecoinInfo {
  mint: PublicKey;
  name: string;
  symbol: string;
  decimals: number;
  priority: number;
}

export interface TransferParams {
  sender: PublicKey;
  recipient: PublicKey;
  mint: PublicKey;
  amount: number;
}

export interface AutoConvertParams {
  inputMint: PublicKey;
  outputMint: PublicKey;
  amount: number;
  slippageBps?: number;
}

export interface AtaResult {
  address: PublicKey;
  created: boolean;
}
