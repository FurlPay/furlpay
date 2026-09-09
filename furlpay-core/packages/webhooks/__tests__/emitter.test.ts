import { describe, it, expect } from 'vitest';
import { WebhookEmitter } from '../src/emitter';

describe('WebhookEmitter', () => {
  it('should instantiate', () => {
    const emitter = new WebhookEmitter();
    expect(emitter).toBeDefined();
  });
});
