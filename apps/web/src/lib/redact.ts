// ---------------------------------------------------------------------------
// PII/secret redaction for free-text support content ("early redaction": strip
// before storage or email, not at display time). Deliberately conservative —
// a support ticket legitimately contains tx hashes, order ids and amounts, so
// every rule here is anchored to something only a secret would match:
//
//  - Card PANs: 13-19 digit runs (spaces/dashes allowed) that pass Luhn.
//    Luhn is what separates a card number from a phone number or tracking id.
//  - Seed phrases: exactly 12 or 24 lowercase words, either as a STANDALONE
//    line (the shape wallets export) or as a run that is labelled ("here it
//    is: …") or cued ("my seed phrase is …") — the shapes people type into a
//    chat box. A bare 12-word run is NOT enough on its own: uncapitalised,
//    unpunctuated chat reaches twelve short words often enough that matching it
//    unqualified would redact ordinary sentences.
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

// A run of exactly 12 or 24 BIP-39-shaped words (lowercase, 3-8 letters), found
// anywhere rather than only as a whole line.
//
// The whole-line rule above matches a wallet EXPORT. It misses how a phrase
// actually arrives in a chat box, which is labelled and inline:
//
//   here it is: legal winner thank year wave sausage worth useful legal winner thank yellow
//
// Matching this run on its own would be too loose — an uncapitalised,
// unpunctuated sentence of twelve short words is ordinary chat. So the run only
// counts with corroboration: a short label ending in a colon (the shape of
// someone handing something over), or an explicit seed-phrase cue in the line.
// A 13+ word run redacts its first 12; over-redacting a phrase-shaped run is
// the safe direction, and the reply says what was removed.
const WORD_RUN = /(?:[a-z]{3,8}[ \t]+){11}[a-z]{3,8}(?:[ \t]+(?:[a-z]{3,8}[ \t]+){11}[a-z]{3,8})?/;
const LABELLED_RUN = new RegExp(`^([^:\\n]{0,40}:[ \\t]*)(${WORD_RUN.source})[ \\t]*$`);
const SEED_CUE = /\b(?:seed|mnemonic|recovery|passphrase|secret phrase|backup phrase)\b/i;
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

  // Seed phrases: whole standalone lines of exactly 12 or 24 lowercase words,
  // plus the labelled/cued inline shapes people type into a chat box.
  const SEED_NOTE = "[seed phrase removed — never share it; FurlPay will never ask for it]";
  text = text
    .split("\n")
    .map((line) => {
      if (SEED_LINE.test(line)) {
        redactions++;
        return SEED_NOTE;
      }

      // "here it is: <12 words>" — keep the label, drop the phrase, so the
      // support agent can still see what the visitor was answering.
      const labelled = line.match(LABELLED_RUN);
      if (labelled) {
        redactions++;
        return `${labelled[1]}${SEED_NOTE}`;
      }

      // "my seed phrase is <12 words>" — no colon, but the line says what it is.
      if (SEED_CUE.test(line)) {
        const run = line.match(WORD_RUN);
        if (run) {
          redactions++;
          return line.replace(run[0], SEED_NOTE);
        }
      }

      return line;
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
