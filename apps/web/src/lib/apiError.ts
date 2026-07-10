import { NextResponse } from "next/server";
import { randomUUID } from "crypto";

// ---------------------------------------------------------------------------
// Standardized API error envelope + request-id tracing (Securitize / Stripe
// pattern). One shape for every error a public/API route returns, plus a
// correlation id echoed in the `X-Request-Id` header so a caller can quote it
// in a support ticket and it can be grepped across the log drain.
//
// type   — coarse class the client can branch on
// code   — stable machine string (snake_case), links to docs
// message— human-readable, safe to surface (never leak secrets/PII)
// param  — the offending field, for validation errors
// ---------------------------------------------------------------------------

export type ApiErrorType =
  | "validation_error"
  | "authentication_error"
  | "authorization_error"
  | "rate_limit_error"
  | "not_found_error"
  | "conflict_error"
  | "compliance_error"
  | "api_error";

export interface ApiErrorBody {
  error: {
    type: ApiErrorType;
    code: string;
    message: string;
    param?: string;
    docUrl: string;
  };
  requestId: string;
}

const STATUS_BY_TYPE: Record<ApiErrorType, number> = {
  validation_error: 400,
  authentication_error: 401,
  authorization_error: 403,
  not_found_error: 404,
  conflict_error: 409,
  rate_limit_error: 429,
  compliance_error: 451, // Unavailable For Legal Reasons — fits AML/sanctions blocks
  api_error: 500,
};

/** A fresh correlation id for a request. */
export const newRequestId = (): string => `req_${randomUUID()}`;

/**
 * Build a standardized error response. `status` defaults to the canonical
 * status for the error type but can be overridden. `requestId` is generated
 * if not supplied and returned in both the body and the X-Request-Id header.
 */
export function apiError(
  type: ApiErrorType,
  code: string,
  message: string,
  opts: { param?: string; status?: number; requestId?: string } = {}
): NextResponse {
  const requestId = opts.requestId ?? newRequestId();
  const body: ApiErrorBody = {
    error: {
      type,
      code,
      message,
      ...(opts.param ? { param: opts.param } : {}),
      docUrl: `https://furlpay.com/docs/errors/${code}`,
    },
    requestId,
  };
  return NextResponse.json(body, {
    status: opts.status ?? STATUS_BY_TYPE[type],
    headers: { "X-Request-Id": requestId },
  });
}

/** Stamp an existing response with a request id (for success responses that
 *  want a correlation id too). Returns the same response. */
export function withRequestId(res: NextResponse, requestId: string = newRequestId()): NextResponse {
  res.headers.set("X-Request-Id", requestId);
  return res;
}
