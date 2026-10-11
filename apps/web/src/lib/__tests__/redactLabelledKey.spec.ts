import { describe, expect, it } from "vitest";
import { redactSecrets } from "@/lib/redact";

// Audit F-42: 0x hex is deliberately not redacted (a private key and a tx hash
// look identical), but a run the writer LABELS as a key is not ambiguous.
const KEY = "4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318";
const TX = "0x" + "ab".repeat(32);

describe("labelled private keys are redacted; bare hashes are kept", () => {
  for (const text of [
    `my private key is 0x${KEY}`,
    `Private Key: ${KEY}`,
    `privkey=${KEY}`,
    `secret_key ${KEY}`,
    `signing-key: 0x${KEY}`,
    `pk: ${KEY}`,
  ]) {
    it(`redacts "${text.slice(0, 22)}…"`, () => {
      const r = redactSecrets(text);
      expect(r.text).not.toContain(KEY);
      expect(r.text).toContain("[private key removed");
      expect(r.redactions).toBe(1);
    });
  }

  it("keeps an unlabelled transaction hash", () => {
    const r = redactSecrets(`my deposit ${TX} has not arrived`);
    expect(r.text).toContain(TX);
    expect(r.redactions).toBe(0);
  });

  it("keeps a hash labelled as a hash, and a key label followed by a non-key", () => {
    expect(redactSecrets(`tx hash: ${TX}`).text).toContain(TX);
    expect(redactSecrets("I lost my private key yesterday").redactions).toBe(0);
    expect(redactSecrets(`private key: ${"ab".repeat(20)}`).redactions).toBe(0); // 40 hex = an address
  });

  it("does not redact a longer hex run that merely starts with 64 digits", () => {
    const long = "a".repeat(130); // a signature
    expect(redactSecrets(`pk: ${long}`).text).toContain(long);
  });
});
