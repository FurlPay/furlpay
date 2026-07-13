// ---------------------------------------------------------------------------
// PII/secret redaction for free-text support content ("early redaction": strip
// before storage or email, not at display time). Deliberately conservative —
// a support ticket legitimately contains tx hashes, order ids and amounts, so
// every rule here is anchored to something only a secret would match:
//
//  - Card PANs: 13-19 digit runs (spaces/dashes allowed) that pass Luhn.
//    Luhn is what separates a card number from a phone number or tracking id.
//  - Seed phrases: a STANDALONE line of exactly 12 or 24 lowercase words —
//    the shape wallets export. Prose lines have capitals/punctuation and
//    don't come in exact 12/24-word lines, which keeps false positives rare.
//  - Prefixed API tokens: sk_/pk_live/npm_/gh[pousr]_/xox?-/AKIA — formats
//    designed to be unambiguous.
//
// NOT redacted, on purpose: 0x… hex (a 32-byte tx hash and a private key are
// indistinguishable, and hashes are the single most useful thing in a ticket)
// and bare 6-digit numbers (TOTP codes collide with amounts and order ids —
// a code is dead in 30s anyway).
// ---------------------------------------------------------------------------

export interface RedactionResult {
  text: string;
  /** How many secrets were replaced — callers can tell the user we did it. */
  redactions: number;
}

function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

const CARD_RUN = /(?<![\d.])(?:\d[ -]?){12,18}\d(?![\d.])/g;
const SEED_LINE = /^\s*(?:[a-z]{3,8}[ \t]+){11}(?:[a-z]{3,8}[ \t]+(?:[a-z]{3,8}[ \t]+){11})?[a-z]{3,8}[ \t]*$/;
const TOKEN_PATTERNS = [
  /\bsk_(?:live|test)_[A-Za-z0-9]{8,}\b/g, // Stripe-style secret keys
  /\bsk-[A-Za-z0-9-]{16,}\b/g, // OpenAI/Anthropic-style keys
  /\bnpm_[A-Za-z0-9]{20,}\b/g, // npm tokens
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, // GitHub tokens
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, // Slack tokens
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key ids
];

/** Redact card PANs, seed-phrase lines and API tokens from free text. */
export function redactSecrets(input: string): RedactionResult {
  let redactions = 0;

  // Card numbers: Luhn-checked, keep the last 4 (support needs them).
  let text = input.replace(CARD_RUN, (run) => {
    const digits = run.replace(/[ -]/g, "");
    if (digits.length < 13 || digits.length > 19 || !luhnValid(digits)) return run;
    redactions++;
    return `[card ****${digits.slice(-4)}]`;
  });

  // Seed phrases: whole standalone lines of exactly 12 or 24 lowercase words.
  text = text
    .split("\n")
    .map((line) => {
      if (!SEED_LINE.test(line)) return line;
      redactions++;
      return "[seed phrase removed — never share it; FurlPay will never ask for it]";
    })
    .join("\n");

  // Prefixed API tokens.
  for (const pattern of TOKEN_PATTERNS) {
    text = text.replace(pattern, () => {
      redactions++;
      return "[api token removed]";
    });
  }

  return { text, redactions };
}
