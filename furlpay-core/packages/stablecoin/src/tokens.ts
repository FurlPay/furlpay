import { PublicKey } from '@solana/web3.js';
import { StablecoinInfo } from './types';

export const SUPPORTED_STABLECOINS: Map<string, StablecoinInfo> = new Map([
  [
    'USDC',
    {
      mint: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
      name: 'USD Coin',
      symbol: 'USDC',
      decimals: 6,
      priority: 0,
    }
  ],
  [
    'USDT',
    {
      mint: new PublicKey('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'),
      name: 'Tether USD',
      symbol: 'USDT',
      decimals: 6,
      priority: 1,
    }
  ],
  [
    'PYUSD',
    {
      mint: new PublicKey('2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo'),
      name: 'PayPal USD',
      symbol: 'PYUSD',
      decimals: 6,
      priority: 2,
    }
  ],
  [
    'EURC',
    {
      mint: new PublicKey('HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr'),
      name: 'Euro Coin',
      symbol: 'EURC',
      decimals: 6,
      priority: 2,
    }
  ],
]);

export function getMint(symbol: string): PublicKey {
  const coin = SUPPORTED_STABLECOINS.get(symbol.toUpperCase());
  if (!coin) {
    throw new Error(`Unsupported stablecoin symbol: ${symbol}`);
  }
  return coin.mint;
}

export function isSupported(mint: PublicKey): boolean {
  for (const coin of SUPPORTED_STABLECOINS.values()) {
    if (coin.mint.equals(mint)) {
      return true;
    }
  }
  return false;
}

export function getDecimals(mint: PublicKey): number {
  for (const coin of SUPPORTED_STABLECOINS.values()) {
    if (coin.mint.equals(mint)) {
      return coin.decimals;
    }
  }
  throw new Error(`Unsupported stablecoin mint: ${mint.toBase58()}`);
}

export function getSymbol(mint: PublicKey): string {
  for (const coin of SUPPORTED_STABLECOINS.values()) {
    if (coin.mint.equals(mint)) {
      return coin.symbol;
    }
  }
  throw new Error(`Unsupported stablecoin mint: ${mint.toBase58()}`);
}
