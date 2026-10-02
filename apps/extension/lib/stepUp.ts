// ---------------------------------------------------------------------------
// Step-up from the extension popup.
//
// The server asks for one with `step_up_required` (apps/web
// lib/ramp/rampGuard.ts) and accepts only a fresh OTP or passkey ceremony on
// the session. A popup cannot run a furlpay.com passkey (its origin is the
// extension's), and FurlPay has no PIN, so the extension uses a one-time code
// sent to the account's own email. The background reads that email from
// /api/profile itself; the popup never supplies an address, so a code cannot
// be redirected to sign in as someone else.
//
// A successful check issues a fresh furlpay.com session cookie with the
// step-up recorded on it, valid 15 minutes and consumed by one transaction.
// ---------------------------------------------------------------------------

/** "priya.sharma@example.com" → "p•••a@example.com" for display. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain || !local) return "your email";
  return local.length <= 2 ? `${local[0]}•••@${domain}` : `${local[0]}•••${local[local.length - 1]}@${domain}`;
}

export function isStepUpCode(code: unknown): code is string {
  return typeof code === "string" && /^\d{4,10}$/.test(code);
}

/** True when a background failure is the server asking for a step-up. */
export function isStepUpRequired(error: string): boolean {
  return error === "step_up_required";
}
