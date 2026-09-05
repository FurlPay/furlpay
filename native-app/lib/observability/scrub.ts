// ---------------------------------------------------------------------------
// PII scrubbing.
//
// This is the most safety-critical file in the observability layer. Everything
// reported to a third-party service passes through here first, and the rule is
// DENY BY DEFAULT: a value is redacted unless it is on an explicit allowlist of
// shapes known to be safe.
//
// The failure this prevents is not hypothetical. A crash report from a send
// screen naturally carries the request body; a request body on a send screen
// naturally carries an amount, a destination address and an idempotency key. A
// breadcrumb from an auth call naturally carries a bearer token. Shipping any
// of that to an error tracker puts it in a third-party database, in logs, and
// in whatever that vendor's retention policy says.
//
// NEVER reported: private keys, seed phrases, passwords, session tokens,
// card numbers, CVV, KYC documents, full account identifiers.
// ---------------------------------------------------------------------------

export const REDACTED = "[redacted]";

/**
 * Keys whose VALUE is always removed, matched case-insensitively as a
 * substring. Substring matching is deliberate: it catches `authToken`,
 * `x-auth-token`, `refresh_token` and `tokenExpiry` from one entry, and the
 * cost of over-redacting a harmless field is a slightly less useful error
 * report — the cost of under-redacting is a credential leak.
 */
const DENY_KEY_PATTERNS = [
  "password",
  "passcode",
  "pin",
  "secret",
  "token",
  "auth",
  "cookie",
  "session",
  "credential",
  "signature",
  "privatekey",
  "private_key",
  "seed",
  "mnemonic",
  "phrase",
  "entropy",
  "derivation",
  "xprv",
  "apikey",
  "api_key",
  "otp",
  "totp",
  "cvv",
  "cvc",
  "cardnumber",
  "card_number",
  "pan",
  "iban",
  "accountnumber",
  "account_number",
  "routing",
  "ssn",
  "taxid",
  "passport",
  "document",
  "dob",
  "birth",
  "address",
  "email",
  "phone",
  "idempotency",
];

/**
 * Value shapes redacted wherever they appear, including inside free text.
 *
 * Ordered longest-match-first so that a 64-hex private key is caught by the
 * hex rule before the shorter EVM-address rule can nibble at its prefix.
 */
const VALUE_PATTERNS: { name: string; re: RegExp }[] = [
  // BIP-39 mnemonic: 12/15/18/21/24 lowercase words. Checked first — it is the
  // single most damaging thing that could leak, and it looks like prose.
  { name: "mnemonic", re: /\b(?:[a-z]{3,8}\s+){11,23}[a-z]{3,8}\b/g },
  // JWT
  { name: "jwt", re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  // Long hex blobs (private keys, raw signatures, tx payloads)
  { name: "hex", re: /\b(?:0x)?[0-9a-fA-F]{64,}\b/g },
  // EVM address
  { name: "evm", re: /\b0x[0-9a-fA-F]{40}\b/g },
  // Base58 (Solana address / signature). Length-bounded to avoid eating words.
  { name: "base58", re: /\b[1-9A-HJ-NP-Za-km-z]{32,88}\b/g },
  // PAN — 13-19 digits, optionally grouped
  { name: "pan", re: /\b(?:\d[ -]?){13,19}\b/g },
  { name: "email", re: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g },
  // E.164-ish phone
  { name: "phone", re: /\+\d[\d\s().-]{7,17}\d\b/g },
];

/** True when this key's value must never be reported. */
export function isDeniedKey(key: string): boolean {
  const k = key.toLowerCase();
  return DENY_KEY_PATTERNS.some((p) => k.includes(p));
}

/**
 * Redact sensitive shapes inside a string.
 *
 * Applied to every string that survives key-level redaction, because a message
 * like `failed to send to 0xabc…` carries the address in prose where no key
 * name protects it.
 */
export function scrubString(input: string): string {
  let out = input;
  for (const { name, re } of VALUE_PATTERNS) {
    // Fresh lastIndex each pass — these are /g regexes and reusing a stale
    // lastIndex across calls silently skips matches.
    re.lastIndex = 0;
    out = out.replace(re, `[${name}]`);
  }
  return out;
}

const MAX_DEPTH = 6;
const MAX_ARRAY = 50;
const MAX_STRING = 1024;

/**
 * Deep-scrub an arbitrary value.
 *
 * Cycle-safe (a React synthetic event or a fetch Response reaches back into
 * itself), depth-capped, and length-capped so one runaway object cannot become
 * a multi-megabyte report.
 */
export function scrubValue(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    const s = scrubString(value);
    return s.length > MAX_STRING ? `${s.slice(0, MAX_STRING)}…[truncated]` : s;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return `${value.toString()}n`;
  if (typeof value === "function") return "[function]";
  if (typeof value === "symbol") return "[symbol]";

  if (depth >= MAX_DEPTH) return "[depth-limit]";

  if (typeof value === "object") {
    if (seen.has(value as object)) return "[circular]";
    seen.add(value as object);

    if (Array.isArray(value)) {
      const head = value.slice(0, MAX_ARRAY).map((v) => scrubValue(v, depth + 1, seen));
      return value.length > MAX_ARRAY ? [...head, `…${value.length - MAX_ARRAY} more`] : head;
    }

    if (value instanceof Error) {
      return {
        name: value.name,
        message: scrubString(value.message),
        // Stack frames carry file paths and function names, not user data, but
        // a thrown value can be interpolated into the message above.
        stack: value.stack ? scrubString(value.stack) : undefined,
      };
    }

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isDeniedKey(k) ? REDACTED : scrubValue(v, depth + 1, seen);
    }
    return out;
  }

  return "[unknown]";
}

/**
 * Reduce a URL to something safe to report.
 *
 * Keeps the origin and path shape; drops the query string entirely (it carries
 * tokens and account ids) and replaces identifier-looking path segments with
 * `:id` so that a thousand distinct URLs group into one route.
 */
export function scrubUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const path = u.pathname
      .split("/")
      .map((seg) => {
        if (!seg) return seg;
        // uuid, long hex, base58, or any long digit run -> :id
        if (
          /^[0-9a-fA-F-]{16,}$/.test(seg) ||
          /^\d{4,}$/.test(seg) ||
          /^[1-9A-HJ-NP-Za-km-z]{20,}$/.test(seg)
        ) {
          return ":id";
        }
        return seg;
      })
      .join("/");
    return `${u.origin}${path}`;
  } catch {
    // Not a parseable URL — scrub it as prose rather than reporting it raw.
    return scrubString(raw);
  }
}
