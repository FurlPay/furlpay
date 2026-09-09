import { describe, it, expect } from 'vitest';
import { SettlementTierEngine } from '../src/tiers.js';
describe('Tiers', () => { it('determines tier', () => { const engine = new SettlementTierEngine(); expect(engine.determineTier(10)).toBe('INSTANT'); }); });
