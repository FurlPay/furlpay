import { Connection } from '@solana/web3.js';
import { PriceFeed, OracleConfig } from './types';
import { assertPriceInBounds, isPriceStale } from './bounds';

export const PYTH_SOL_USD_FEED = 'H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG';

export class PythPriceClient {
  constructor(private connection: Connection, private config?: OracleConfig) {}

  async getSolUsdPrice(): Promise<number> {
    const feed = await this.getPrice(PYTH_SOL_USD_FEED);
    
    if (isPriceStale(feed.timestamp, 60000)) {
      throw new Error('Oracle price is stale');
    }
    
    assertPriceInBounds(feed.price, 1, 2000);
    
    return feed.price;
  }

  async getPrice(feedId: string): Promise<PriceFeed> {
    // TODO: Implement actual Pyth on-chain fetching or Hermes API
    return {
      id: feedId,
      price: 150.0,
      confidence: 0.1,
      timestamp: Date.now(),
    };
  }
}
