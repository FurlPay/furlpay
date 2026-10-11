import { describe, expect, it } from "vitest";
import { hawkHeader, hawkHeaderFor, hawkMac, hawkNonce, hawkNormalizedString } from "../hawk";

describe("Hawk request signing", () => {
  it("reproduces the reference vector from the Hawk specification (hapijs/hawk README)", () => {
    const artifacts = { ts: 1353832234, nonce: "j4h3g2", method: "GET", resource: "/resource/1?b=1&a=2", host: "example.com", port: 8000, ext: "some-app-ext-data" };
    expect(hawkNormalizedString(artifacts)).toBe("hawk.1.header\n1353832234\nj4h3g2\nGET\n/resource/1?b=1&a=2\nexample.com\n8000\n\nsome-app-ext-data\n");
    expect(hawkMac("werxhqb98rpaxn39848xrunpaw3489ruxnpa98w4rxn", artifacts)).toBe("6R4rV5iE+NPoym+WwjeHzjAGXUtLNIxmo1vpMofpLAE=");
    expect(hawkHeader({ id: "dh37fgj492je", key: "werxhqb98rpaxn39848xrunpaw3489ruxnpa98w4rxn" }, artifacts))
      .toBe('Hawk id="dh37fgj492je", ts="1353832234", nonce="j4h3g2", ext="some-app-ext-data", mac="6R4rV5iE+NPoym+WwjeHzjAGXUtLNIxmo1vpMofpLAE="');
  });

  it("builds BVNK's normalized string: no payload hash, no ext, two trailing newlines", () => {
    // The shape of BVNK's documented Java sample (generateNormalizedString).
    const s = hawkNormalizedString({ ts: 1700000000, nonce: "AbC123", method: "get", resource: "/ledger/v2/wallets?pageNumber=0&pageSize=50", host: "API.SANDBOX.BVNK.COM", port: 443 });
    expect(s).toBe("hawk.1.header\n1700000000\nAbC123\nGET\n/ledger/v2/wallets?pageNumber=0&pageSize=50\napi.sandbox.bvnk.com\n443\n\n\n");
  });

  it("derives resource, host and port from the URL, with 443 for https", () => {
    const h = hawkHeaderFor({ id: "id1", key: "k" }, "POST", "https://api.sandbox.bvnk.com/payment/v3/transfers", 1_700_000_000_999, "AAAAAA");
    const mac = hawkMac("k", { ts: 1700000000, nonce: "AAAAAA", method: "POST", resource: "/payment/v3/transfers", host: "api.sandbox.bvnk.com", port: 443 });
    expect(h).toBe(`Hawk id="id1", ts="1700000000", nonce="AAAAAA", mac="${mac}"`);
    expect(h).not.toContain("ext=");
  });

  it("makes six-character alphanumeric nonces from a CSPRNG", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const n = hawkNonce();
      expect(n).toMatch(/^[A-Za-z0-9]{6}$/);
      seen.add(n);
    }
    expect(seen.size).toBeGreaterThan(495);
  });
});
