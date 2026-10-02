// ---------------------------------------------------------------------------
// Throwaway-mailbox domains refused for gated research downloads.
//
// Deliberately SHORT and maintained by hand: these are services whose whole
// purpose is a mailbox that cannot be contacted later. It is NOT a list of
// consumer providers — Gmail, Outlook, Proton and the rest are accepted, and
// so is any small-business or personal domain. Refusing those would turn a
// verification step into a guess about who someone works for, which an email
// address cannot tell us (lib/leads/types.ts says the same of classifyEmail).
//
// Matching is exact-domain or subdomain, so "mailinator.com" also covers
// "x.mailinator.com" but never "notmailinator.com".
// ---------------------------------------------------------------------------

const DISPOSABLE = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.net", "sharklasers.com", "grr.la",
  "10minutemail.com", "10minutemail.net", "temp-mail.org", "tempmail.com", "tempmailo.com",
  "yopmail.com", "yopmail.net", "trashmail.com", "trashmail.de", "getnada.com", "nada.email",
  "maildrop.cc", "dispostable.com", "throwawaymail.com", "fakeinbox.com", "mintemail.com",
  "emailondeck.com", "mohmal.com", "tempail.com", "burnermail.io", "mailnesia.com",
  "spamgourmet.com", "mytemp.email", "tempr.email", "discard.email", "moakt.com",
]);

export function isDisposableEmail(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const domain = email.slice(at + 1).trim().toLowerCase().replace(/\.$/, "");
  if (!domain) return false;
  for (const d of DISPOSABLE) if (domain === d || domain.endsWith(`.${d}`)) return true;
  return false;
}
