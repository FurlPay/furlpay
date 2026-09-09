import { describe, it, expect } from 'vitest';
import { parseSolanaPayUrl, buildSolanaPayUrl } from '../src/utils/solana-pay';

describe('Solana Pay Utils', () => {
  it('parses correctly', () => {
    const url = 'solana:mvines9iiHiQTysrwkJjGf2GB9g5oW4AEA4TZ1jU41D?amount=0.01&reference=82ZJ7nbGpie2BszUXYW5tU5fW3Tf3TdjD1R3p3Z9mC&label=Jungle+Cats&message=Jungle+Cats+store';
    const parsed = parseSolanaPayUrl(url);
    
    expect(parsed.recipient).toBe('mvines9iiHiQTysrwkJjGf2GB9g5oW4AEA4TZ1jU41D');
    expect(parsed.amount).toBe('0.01');
    expect(parsed.label).toBe('Jungle Cats');
  });

  it('builds correctly', () => {
    const url = buildSolanaPayUrl('mvines9iiHiQTysrwkJjGf2GB9g5oW4AEA4TZ1jU41D', '1.0', 'ref123');
    expect(url).toContain('solana:mvines');
    expect(url).toContain('amount=1.0');
    expect(url).toContain('reference=ref123');
  });
});
