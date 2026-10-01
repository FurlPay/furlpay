// ---------------------------------------------------------------------------
// Canonical identity keys — ONE function, used everywhere an email becomes a
// lookup or uniqueness key.
//
// THE BUG THIS CLOSES. OTP codes were keyed on trim().toLowerCase(), while the
// account lookup and the stored email used the raw request string. "alice@x.com"
// and " Alice@X.com " therefore verified the same code but resolved to
// DIFFERENT accounts: the second login created a duplicate account for the
// same mailbox (Postgres citext folds case, not whitespace). Every entry point
// (OTP, Google, Apple, admin bootstrap, store indexes, the durable lookup) now
// goes through canonicalEmail().
//
// Canonical form: Unicode NFC (canonical equivalence only — NOT NFKC, which
// would fold distinct compatibility characters into one identity), trimmed,
// lower-cased. The local part is case-insensitive in practice at every real
// provider; treating it otherwise lets one person own two accounts.
// ---------------------------------------------------------------------------

export function canonicalEmail(email: string): string {
  return email.normalize("NFC").trim().toLowerCase();
}

/** Minimal shape check for an address that is about to become an identity. */
export function isPlausibleEmail(email: string): boolean {
  const e = canonicalEmail(email);
  return e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}
