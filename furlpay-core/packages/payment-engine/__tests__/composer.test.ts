import { describe, it, expect } from 'vitest';
import { PaymentComposer } from '../src/composer.js';
describe('PaymentComposer', () => { it('creates instance', () => { expect(new PaymentComposer({ rpcUrl: 'http' })).toBeDefined(); }); });
