import { describePairingUri, looksLikePairingUri, parsePairingUri } from "../uri";

// The pairing URI is one of three hostile inputs into the wallet (QR, deep
// link, clipboard). These tests are about what it REFUSES as much as what it
// accepts — a parser that is merely permissive is the bug.

const KEY = "a".repeat(64);
const TOPIC = "b".repeat(64);
const VALID = `wc:${TOPIC}@2?relay-protocol=irn&symKey=${KEY}`;

describe("parsePairingUri", () => {
  it("parses a well-formed v2 URI", () => {
    const res = parsePairingUri(VALID);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.uri.topic).toBe(TOPIC);
    expect(res.uri.version).toBe(2);
    expect(res.uri.relayProtocol).toBe("irn");
    expect(res.uri.symKey).toBe(KEY);
  });

  it("defaults the relay protocol when the dApp omits it", () => {
    const res = parsePairingUri(`wc:${TOPIC}@2?symKey=${KEY}`);
    expect(res.ok && res.uri.relayProtocol).toBe("irn");
  });

  it("rejects anything that is not a wc: link", () => {
    for (const input of ["https://example.com", "ethereum:0xabc", "", "   "]) {
      const res = parsePairingUri(input);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe("not_walletconnect");
    }
  });

  // v1 URIs still scan cleanly and can never connect — the bridge network was
  // retired in 2023. Detecting it is the difference between a useful message
  // and an infinite spinner.
  it("identifies v1 links specifically", () => {
    const res = parsePairingUri(`wc:${TOPIC}@1?bridge=https%3A%2F%2Fb.example&key=${KEY}`);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("unsupported_version");
    expect(res.error.message).toMatch(/v1/);
  });

  it("rejects a URI with no encryption key", () => {
    const res = parsePairingUri(`wc:${TOPIC}@2?relay-protocol=irn`);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("missing_key");
  });

  it("rejects a symKey that is not 32 bytes of hex", () => {
    for (const bad of ["abc", "z".repeat(64), "a".repeat(63), "a".repeat(65)]) {
      const res = parsePairingUri(`wc:${TOPIC}@2?symKey=${bad}`);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe("missing_key");
    }
  });

  it("rejects a malformed topic", () => {
    const res = parsePairingUri(`wc:not-a-topic@2?symKey=${KEY}`);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("malformed");
  });

  it("rejects a URI with no version", () => {
    const res = parsePairingUri(`wc:${TOPIC}?symKey=${KEY}`);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("malformed");
  });

  it("honours an expiry in the past", () => {
    const now = 1_700_000_000_000;
    const expired = `${VALID}&expiryTimestamp=${Math.floor(now / 1000) - 60}`;
    const res = parsePairingUri(expired, now);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("expired");
  });

  it("accepts an expiry in the future", () => {
    const now = 1_700_000_000_000;
    const live = `${VALID}&expiryTimestamp=${Math.floor(now / 1000) + 300}`;
    const res = parsePairingUri(live, now);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.uri.expiryTimestampMs).toBe((Math.floor(now / 1000) + 300) * 1000);
  });

  // A junk timestamp must not sink an otherwise valid pairing: the relay
  // enforces its own expiry, and refusing here would break real dApps over a
  // field that is advisory.
  it("ignores an unparseable expiry rather than rejecting", () => {
    const res = parsePairingUri(`${VALID}&expiryTimestamp=soon`);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.uri.expiryTimestampMs).toBeUndefined();
  });

  // Some QR encoders lowercase the whole payload, which turns symKey into
  // symkey. Matching case-sensitively makes those scan and then fail with
  // "missing encryption key".
  it("accepts lowercased parameter names", () => {
    const res = parsePairingUri(`wc:${TOPIC}@2?relay-protocol=irn&symkey=${KEY}`);
    expect(res.ok).toBe(true);
  });

  it("tolerates surrounding whitespace from a clipboard paste", () => {
    expect(parsePairingUri(`  ${VALID}\n`).ok).toBe(true);
  });
});

describe("describePairingUri", () => {
  // The single most important property in this file: the loggable form must
  // never contain key material, not even a prefix of it.
  it("never exposes the symKey", () => {
    const res = parsePairingUri(VALID);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const described = JSON.stringify(describePairingUri(res.uri));
    expect(described).not.toContain(KEY);
    expect(described).not.toContain(KEY.slice(0, 8));
    expect(described).not.toMatch(/symkey/i);
  });
});

describe("looksLikePairingUri", () => {
  it("is true for anything claiming to be WalletConnect", () => {
    expect(looksLikePairingUri("wc:whatever")).toBe(true);
    expect(looksLikePairingUri("WC:WHATEVER")).toBe(true);
    expect(looksLikePairingUri("https://example.com")).toBe(false);
  });
});
