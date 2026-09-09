export class FurlPayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FurlPayError';
  }
}

export class AuthenticationError extends FurlPayError {
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export class InvalidRequestError extends FurlPayError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRequestError';
  }
}

export class PaymentError extends FurlPayError {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentError';
  }
}

export class NetworkError extends FurlPayError {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

export class RateLimitError extends FurlPayError {
  constructor(message: string) {
    super(message);
    this.name = 'RateLimitError';
  }
}
