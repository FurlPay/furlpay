import { describe, it, expect } from 'vitest';
import { generateId, generateApiKey, generateHmac, verifyHmac } from '../src/crypto.js';
describe('Crypto', () => {
  it('generates ID', () => { expect(generateId()).toBeDefined(); });
  it('verifies HMAC', () => {
    const sig = generateHmac('secret', 'data');
    expect(verifyHmac('secret', 'data', sig)).toBe(true);
    expect(verifyHmac('secret', 'data', 'invalid')).toBe(false);
  });
  it('generates API key', () => { expect(generateApiKey().length).toBeGreaterThan(0); });
});
