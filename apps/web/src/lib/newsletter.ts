// Newsletter subscriber store.
//
// Backed by the durable KV layer (`@/lib/kv` — Upstash Redis in production),
// one record per email address. The previous version kept subscribers in a
// module-level array: correct on one instance, but on Vercel every lambda has
// its own memory, so a signup could return "You're subscribed!" and then be
// lost on the next cold start, and an unsubscribe could report success against
// an instance that never held the record. Consent records cannot be stored in
// something that forgets. `kv` refuses its in-memory fallback in production,
// so a missing Redis config now fails loudly instead of silently dropping
// subscribers — the routes turn that into a 503 rather than a fake success.
//
// A live mailing operation swaps these four functions for Resend Audiences /
// Loops; the shape (email + categories + consent timestamp + consent IP) is
// what those APIs need.

import { kvDel, kvGet, kvSet } from "@/lib/kv";

export const VALID_CATEGORIES = [
  "product-updates",
  "engineering",
  "policy-changes",
  "security-bulletins",
  "weekly-digest",
] as const;

export type Category = (typeof VALID_CATEGORIES)[number];

/** Membership test for untrusted input. */
export const CATEGORY_SET: ReadonlySet<string> = new Set(VALID_CATEGORIES);

export type Subscriber = {
  email: string;
  categories: string[];
  /** ISO-8601 timestamp of the most recent consent — the GDPR record. */
  consentTimestamp: string;
  /** IP the consent came from; null when it could not be established
   *  (lib/clientIp.ts). Never a placeholder that reads as an address. */
  ip: string | null;
};

/** Addresses are matched case-insensitively; the local part is technically
 *  case-sensitive per RFC 5321, but no real provider treats it that way and a
 *  subscriber typing `Me@x.com` must not create a second record. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const key = (email: string) => `newsletter:sub:${normalizeEmail(email)}`;

export async function getSubscriber(email: string): Promise<Subscriber | null> {
  return kvGet<Subscriber>(key(email));
}

export async function putSubscriber(sub: Subscriber): Promise<void> {
  await kvSet(key(sub.email), { ...sub, email: normalizeEmail(sub.email) });
}

export async function deleteSubscriber(email: string): Promise<void> {
  await kvDel(key(email));
}
