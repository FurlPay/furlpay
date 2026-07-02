// Newsletter subscriber store. In-memory (survives across route invocations via
// a global singleton) so it works on serverless read-only filesystems — the
// previous fs-based version crashed on Vercel. A live build swaps these two
// functions for Resend Audiences / Loops with persisted consent records.

export type Subscriber = {
  email: string;
  categories: string[];
  consentTimestamp: string;
  ip: string;
};

export const VALID_CATEGORIES = new Set([
  "product-updates",
  "engineering",
  "policy-changes",
  "security-bulletins",
  "weekly-digest",
]);

const g = globalThis as unknown as { __subscribers?: Subscriber[] };

export function readSubscribers(): Subscriber[] {
  return (g.__subscribers ??= []);
}

export function writeSubscribers(subs: Subscriber[]): void {
  g.__subscribers = subs;
}
