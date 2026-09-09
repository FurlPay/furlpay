export enum ErrorCode {
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  TRANSACTION_FAILED = 'TRANSACTION_FAILED',
  RPC_ERROR = 'RPC_ERROR',
  SIMULATION_FAILED = 'SIMULATION_FAILED',
  BLOCKHASH_EXPIRED = 'BLOCKHASH_EXPIRED',
  FINALITY_TIMEOUT = 'FINALITY_TIMEOUT',
  INVALID_ADDRESS = 'INVALID_ADDRESS',
  RATE_LIMITED = 'RATE_LIMITED',
  NETWORK_DEGRADED = 'NETWORK_DEGRADED',
  UNSUPPORTED_TOKEN = 'UNSUPPORTED_TOKEN'
}

export class FurlPayError extends Error {
  constructor(public code: ErrorCode, message: string) { super(message); this.name = 'FurlPayError'; }
}

export class RpcError extends FurlPayError {
  constructor(message: string) { super(ErrorCode.RPC_ERROR, message); this.name = 'RpcError'; }
}
