import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { checkUrl, isBlockedAddress, pinnedFetch } from "../safeFetch";

// SSRF follow-up (EXHAUSTIVE_SECURITY_REMEDIATION.md ES-21/ES-22).

describe("isBlockedAddress: decided on parsed groups, not spelling", () => {
  it.each([
    "0:0:0:0:0:0:0:1", // loopback, uncompressed
    "::ffff:7f00:1", // ::ffff:127.0.0.1 as the WHATWG URL parser re-serialises it
    "::ffff:a9fe:a9fe", // 169.254.169.254
    "::ffff:169.254.170.2", // ECS credentials endpoint
    "::a9fe:a9fe", // deprecated IPv4-compatible
    "fe81::1", // still fe80::/10 link-local
    "febf::1",
    "2002:a9fe:a9fe::1", // 6to4 wrapping the metadata address
    "2001:0:4136:e378::1", // Teredo
    "64:ff9b::a9fe:a9fe", // NAT64
    "[::1]",
  ])("blocks %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each(["2606:4700:4700::1111", "8.8.8.8", "2002:0808:0808::1"])("allows public %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(false);
  });

  it("bracketed IPv6 literals in URLs are range-checked (URL keeps the brackets)", async () => {
    for (const u of ["http://[::ffff:127.0.0.1]/", "http://[::ffff:169.254.169.254]/latest", "http://[::1]:8080/"]) {
      const r = await checkUrl(u);
      expect(r.ok, u).toBe(false);
      expect(r.reason, u).toBe("private_address");
    }
  });
});

describe("pinnedFetch connects to the checked address, never a re-resolution", () => {
  let server: http.Server;
  let port = 0;
  const seen: { host?: string }[] = [];
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      seen.push({ host: req.headers.host });
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("pinned-ok");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => server.close());

  it("a hostname that does not resolve at all still reaches the pinned address", async () => {
    // `.invalid` can never resolve (RFC 2606): if anything re-resolved the
    // name, this request would fail with ENOTFOUND.
    const res = await pinnedFetch(new URL(`http://rebind-target.invalid:${port}/x`), "127.0.0.1", { timeoutMs: 5000, headers: {} });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("pinned-ok");
    expect(seen.at(-1)?.host).toBe(`rebind-target.invalid:${port}`); // Host header keeps the name
  });

  it("refuses a non-IP pin", async () => {
    await expect(pinnedFetch(new URL("http://a.invalid/"), "not-an-ip", { timeoutMs: 1000, headers: {} })).rejects.toThrow(/not an IP/);
  });

  it("safeFetch no longer calls global fetch with the hostname", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../safeFetch.ts", import.meta.url), "utf8").replace(/\/\/.*$/gm, "");
    expect(src).not.toMatch(/\bawait fetch\(current/);
  });
});
