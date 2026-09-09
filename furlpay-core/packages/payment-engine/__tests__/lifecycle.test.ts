import { describe, it, expect } from 'vitest';
import { TransactionLifecycleManager } from '../src/lifecycle.js';
describe('Lifecycle', () => { it('transitions', () => { const lm = new TransactionLifecycleManager(); expect(lm.getState()).toBeDefined(); }); });
