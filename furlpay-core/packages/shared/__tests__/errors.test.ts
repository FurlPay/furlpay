import { describe, it, expect } from 'vitest';
import { RpcError, ErrorCode } from '../src/errors.js';
describe('Errors', () => {
  it('creates error with code', () => {
    const err = new RpcError('test');
    expect(err.code).toBe(ErrorCode.RPC_ERROR);
  });
});
