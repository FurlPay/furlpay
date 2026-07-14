// Correlation IDs — the thread that lets an incident be reconstructed end to
// end. Every API request gets one (client-supplied if well-formed, else minted
// server-side); it is echoed on the response so the client can show it to the
// user, and forwarded on the request so route handlers/logs can attach it.
//
// A client-supplied id is accepted only if it is a sane, bounded token, so a
// hostile header can't inject junk (or newlines) into structured logs.

export const CORRELATION_HEADER = "x-correlation-id";

const VALID = /^[A-Za-z0-9._-]{8,64}$/;

export function ensureCorrelationId(existing: string | null | undefined): string {
  const v = (existing ?? "").trim();
  return VALID.test(v) ? v : crypto.randomUUID();
}
