import { describe, it, expect } from 'vitest';
import { AlpenglowDetector } from '../src/alpenglow.js';
describe('Alpenglow', () => { it('checks active', () => { const detector = new AlpenglowDetector(); expect(detector.getExpectedFinalityMs()).toBeDefined(); }); });
