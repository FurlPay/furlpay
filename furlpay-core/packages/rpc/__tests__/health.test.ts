import { expect, test, describe } from 'vitest';
import { RpcHealthChecker } from '../src/health.js';
import { createCustomProvider } from '../src/providers.js';

describe('RpcHealthChecker', () => {
    test('initializes all providers as healthy', () => {
        const provider = createCustomProvider('test', 'http://localhost');
        const checker = new RpcHealthChecker([provider], 1000);
        expect(checker.isHealthy(provider)).toBe(true);
    });
});
