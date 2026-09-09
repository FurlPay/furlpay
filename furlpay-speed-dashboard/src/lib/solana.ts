import { Connection } from '@solana/web3.js';

const connection = new Connection('https://api.mainnet-beta.solana.com');

export async function fetchSolanaData() {
  // Stub for actual RPC calls
  return {
    tps: 2500,
  };
}
