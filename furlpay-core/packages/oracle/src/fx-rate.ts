import { randomUUID } from 'crypto';
import { FxRate, FxQuote } from './types';

export class FxRateEngine {
  private lockedQuotes: Map<string, FxQuote> = new Map();
  private spreadConfig: Map<string, number>;

  constructor(config?: { spreads?: Record<string, number> }) {
    this.spreadConfig = new Map(Object.entries(config?.spreads ?? {}));
  }

  async getRate(from: string, to: string): Promise<FxRate> {
    let baseRate = 1.0;
    if (from === 'USD' && to === 'EUR') baseRate = 0.92;
    if (from === 'EUR' && to === 'USD') baseRate = 1.09;
    
    const pair = `${from}_${to}`;
    const spreadBps = this.spreadConfig.get(pair) ?? 0;
    const rate = this.applySpread(baseRate, spreadBps);

    return {
      from,
      to,
      rate,
      timestamp: Date.now(),
    };
  }

  async lockRate(from: string, to: string, durationMs: number = 60000): Promise<FxQuote> {
    const { rate } = await this.getRate(from, to);
    const quote: FxQuote = {
      id: randomUUID(),
      from,
      to,
      rate,
      expiresAt: Date.now() + durationMs,
    };
    
    this.lockedQuotes.set(quote.id, quote);
    return quote;
  }

  isRateLocked(quoteId: string): boolean {
    const quote = this.lockedQuotes.get(quoteId);
    if (!quote) return false;
    if (Date.now() > quote.expiresAt) {
      this.lockedQuotes.delete(quoteId);
      return false;
    }
    return true;
  }

  applySpread(rate: number, spreadBps: number): number {
    const multiplier = 1 - (spreadBps / 10000);
    return rate * multiplier;
  }
}
