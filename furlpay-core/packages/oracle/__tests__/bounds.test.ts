import { describe, it, expect } from 'vitest';
import { assertPriceInBounds, isPriceStale, DEFAULT_BOUNDS } from '../src/bounds';

describe('bounds checks', () => {
  it('should accept valid price', () => {
    expect(() => assertPriceInBounds(150, DEFAULT_BOUNDS.SOL_USD[0], DEFAULT_BOUNDS.SOL_USD[1])).not.toThrow();
  });

  it('should reject low price', () => {
    expect(() => assertPriceInBounds(0.5, DEFAULT_BOUNDS.SOL_USD[0], DEFAULT_BOUNDS.SOL_USD[1])).toThrow();
  });

  it('should reject high price', () => {
    expect(() => assertPriceInBounds(2500, DEFAULT_BOUNDS.SOL_USD[0], DEFAULT_BOUNDS.SOL_USD[1])).toThrow();
  });

  it('should identify stale price', () => {
    const oldTime = Date.now() - 100000;
    expect(isPriceStale(oldTime, 60000)).toBe(true);
  });

  it('should identify fresh price', () => {
    const freshTime = Date.now() - 10000;
    expect(isPriceStale(freshTime, 60000)).toBe(false);
  });
});
