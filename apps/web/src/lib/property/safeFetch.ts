// ---------------------------------------------------------------------------
// SSRF-hardened retrieval.
//
// EVERY URL THIS SUBSYSTEM FETCHES IS ATTACKER-INFLUENCED. A user pastes a
// property URL; a search result suggests a domain; a registry record carries a
// website field. All three reach this module, and a plain `fetch()` on any of
// them turns the server into a proxy for whatever the attacker names —
// including the cloud metadata endpoint, which on most providers hands out
// credentials to anything that asks.
//
// THE DEFENCES, and why each is not optional:
//
//   SCHEME       Only http/https. `file://` reads the disk, `gopher://` and
//                friends can speak to arbitrary TCP services.
//
//   DNS PINNING  The critical one. Validating a hostname and then calling
//                fetch() re-resolves it — a DNS-rebinding attacker answers the
//                first lookup with a public IP and the second with 169.254.169.254.
//                So we resolve ONCE, check every returned address, and connect
//                to the address we checked.
//
//   IP RANGES    Loopback, private, link-local, CGNAT, and the IPv6
//                equivalents including IPv4-mapped forms. `[::ffff:127.0.0.1]`
//                is loopback wearing a v6 costume and defeats a naive string
//                check.
//
//   REDIRECTS    Followed manually, with every hop re-validated. A public URL
//                that 302s to localhost passes an entry check and fails at the
//                destination, which is precisely the point of the attack.
//
//   SIZE + TIME  A bounded read. An endpoint that streams forever is a memory
//                exhaustion, and one that never responds holds a worker.
//
// This module never parses or executes what it retrieves. It returns bytes and
// a content type; interpreting them is somebody else's problem, deliberately.
// ---------------------------------------------------------------------------

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { parseV6Groups } from "../clientIp";
import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";

export const MAX_RESPONSE_BYTES = 2_000_000; // 2 MB
export const FETCH_TIMEOUT_MS = 10_000;
export const MAX_REDIRECTS = 3;

export type FetchRefusal =
  | "bad_scheme"
  | "bad_url"
  | "private_address"
  | "dns_failure"
  | "too_many_redirects"
  | "too_large"
  | "timeout"
  | "http_error"
  | "blocked_host";

export type SafeFetchResult =
  | { ok: true; url: string; status: number; contentType: string | null; body: string; bytes: number }
  | { ok: false; reason: FetchRefusal; detail: string };

/**
 * Hosts that must never be fetched regardless of what they resolve to.
 *
 * The cloud metadata services are here by name as well as by IP because a
 * hostname that resolves elsewhere today may resolve there tomorrow, and
 * because naming them documents the threat for the next reader.
 */
const BLOCKED_HOSTNAMES = new Set([
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
  "localhost",
]);

/** Reserved IPv4 ranges, as [network, prefix length]. */
const BLOCKED_V4: [string, number][] = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // RFC1918 private
  ["100.64.0.0", 10], // RFC6598 CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local — includes 169.254.169.254 metadata
  ["172.16.0.0", 12], // RFC1918 private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.168.0.0", 16], // RFC1918 private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved
];

function v4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let out = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    out = (out << 8) | n;
  }
  return out >>> 0;
}

function isBlockedV4(ip: string): boolean {
  const value = v4ToInt(ip);
  if (value === null) return true; // unparseable — refuse rather than allow
  for (const [network, bits] of BLOCKED_V4) {
    const base = v4ToInt(network);
    if (base === null) continue;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    if ((value & mask) === (base & mask)) return true;
  }
  return false;
}

/** 32-bit IPv4 embedded in two IPv6 groups, as a dotted string. */
const embeddedV4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

// Decided on the parsed GROUPS, never on the text: one address has many
// spellings (`::1` = `0:0:0:0:0:0:0:1`; `::ffff:127.0.0.1` = `::ffff:7f00:1`,
// which is how the WHATWG URL parser re-serialises it), and a prefix string
// check misses all but one of them.
function isBlockedV6(ip: string): boolean {
  const g = parseV6Groups(ip.replace(/^\[|\]$/g, ""));
  if (!g) return true; // unparseable: refuse rather than allow
  const zeros = (n: number) => g.slice(0, n).every((x) => x === 0);

  if (zeros(8)) return true; // :: unspecified
  if (zeros(7) && g[7] === 1) return true; // ::1 loopback
  // IPv4 in disguise: mapped ::ffff:a.b.c.d, and deprecated compatible ::a.b.c.d.
  if (zeros(5) && g[5] === 0xffff) return isBlockedV4(embeddedV4(g[6], g[7]));
  if (zeros(6)) return isBlockedV4(embeddedV4(g[6], g[7]));
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  if (g[0] === 0x0064 && g[1] === 0xff9b) return true; // NAT64 (well-known and local-use) reaches IPv4 space
  if (g[0] === 0x2001 && g[1] === 0x0000) return true; // Teredo: tunnels to an IPv4 endpoint
  if (g[0] === 0x2002) return isBlockedV4(embeddedV4(g[1], g[2])); // 6to4 embeds its IPv4 relay
  return false;
}

/** Is this literal address one we refuse to connect to? */
export function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isBlockedV4(ip);
  if (family === 6) return isBlockedV6(ip);
  return true; // not an IP at all — refuse
}

export interface UrlCheck {
  ok: boolean;
  reason?: FetchRefusal;
  detail?: string;
  /** The address we resolved and validated. Connect to THIS, not the hostname. */
  address?: string;
  hostname?: string;
}

/**
 * Validate a URL and resolve it once.
 *
 * The returned address is the whole point: the caller must connect to the
 * address that was checked, not re-resolve the hostname and hope it answers
 * the same way twice.
 */
export async function checkUrl(raw: string): Promise<UrlCheck> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "bad_url", detail: "Not a parseable URL." };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "bad_scheme", detail: `Scheme ${url.protocol} is not permitted.` };
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname) return { ok: false, reason: "bad_url", detail: "No hostname." };

  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith(".localhost") || hostname.endsWith(".internal")) {
    return { ok: false, reason: "blocked_host", detail: `Host ${hostname} is not permitted.` };
  }

  // A literal IP skips DNS but not the range check. URL keeps IPv6 literals
  // bracketed (`[::1]`), which isIP() does not recognise.
  const literal = hostname.replace(/^\[(.*)\]$/, "$1");
  if (isIP(literal)) {
    if (isBlockedAddress(literal)) {
      return { ok: false, reason: "private_address", detail: `${hostname} is a reserved address.` };
    }
    return { ok: true, address: literal, hostname };
  }

  let addresses: { address: string }[];
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    return { ok: false, reason: "dns_failure", detail: `Could not resolve ${hostname}.` };
  }
  if (!addresses.length) {
    return { ok: false, reason: "dns_failure", detail: `${hostname} resolved to nothing.` };
  }

  // EVERY address must be acceptable. A host that resolves to one public and
  // one private address is a rebinding attack with the work already done.
  for (const { address } of addresses) {
    if (isBlockedAddress(address)) {
      return {
        ok: false,
        reason: "private_address",
        detail: `${hostname} resolves to the reserved address ${address}.`,
      };
    }
  }

  return { ok: true, address: addresses[0].address, hostname };
}

/**
 * One GET to `url`, over a connection to `address` and nowhere else.
 *
 * The URL's hostname still drives the Host header, TLS SNI and certificate
 * verification; only the socket's destination is pinned. `lookup` is the one
 * hook every Node connection goes through (http, https, and happy-eyeballs
 * with `all: true`), so there is no second resolution to rebind.
 */
export function pinnedFetch(
  url: URL,
  address: string,
  opts: {
    timeoutMs: number;
    headers: Record<string, string>;
    /** Default GET. POST is for outbound webhooks (lib/ramp/partnerWebhooks.ts). */
    method?: "GET" | "POST";
    body?: string;
  }
): Promise<Response> {
  const family = isIP(address);
  if (!family) return Promise.reject(new Error(`pinnedFetch: ${address} is not an IP address`));
  const pinnedLookup = (
    _host: string,
    options: { all?: boolean } | number | undefined,
    cb: (err: Error | null, a: string | { address: string; family: number }[], f?: number) => void
  ) => {
    if (typeof options === "object" && options?.all) cb(null, [{ address, family }]);
    else cb(null, address, family);
  };
  const transport = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = transport.request(
      url,
      {
        method: opts.method ?? "GET",
        headers: opts.headers,
        lookup: pinnedLookup as never,
        agent: false, // no pooled socket from an earlier, differently-resolved request
        signal: AbortSignal.timeout(opts.timeoutMs),
      },
      (res) => {
        const headers = new Headers();
        for (const [k, v] of Object.entries(res.headers)) {
          if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
          else if (v !== undefined) headers.set(k, String(v));
        }
        const status = res.statusCode ?? 502;
        const noBody = status === 204 || status === 304 || (status >= 100 && status < 200);
        if (noBody) res.resume();
        resolve(
          new Response(noBody ? null : (Readable.toWeb(res) as ReadableStream<Uint8Array>), {
            status: status >= 200 && status <= 599 ? status : 502,
            headers,
          })
        );
      }
    );
    req.on("error", reject);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

/**
 * Fetch a URL with every defence applied.
 *
 * Redirects are followed BY HAND so each hop is re-validated. `redirect:
 * "manual"` is what makes that possible — the automatic mode would follow a
 * 302 into private space before we could look at it.
 */
export async function safeFetch(
  raw: string,
  opts: {
    maxBytes?: number;
    timeoutMs?: number;
    accept?: string;
    /** Tests only: replaces the socket layer. Receives the VALIDATED address. */
    transport?: typeof pinnedFetch;
  } = {}
): Promise<SafeFetchResult> {
  const maxBytes = opts.maxBytes ?? MAX_RESPONSE_BYTES;
  const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS;

  let current = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const check = await checkUrl(current);
    if (!check.ok) {
      return { ok: false, reason: check.reason ?? "bad_url", detail: check.detail ?? "Rejected." };
    }

    let res: Response;
    try {
      // Connect to the address checkUrl VALIDATED. Global fetch() would
      // resolve the hostname again, and a rebinding DNS server answers that
      // second lookup with 169.254.170.2 (the ECS credentials endpoint).
      res = await (opts.transport ?? pinnedFetch)(new URL(current), check.address!, {
        timeoutMs,
        headers: {
          // Identifies the crawler and gives operators a way to reach us. A
          // verification tool that hides what it is has no business reading
          // somebody's website.
          "User-Agent": "FurlPayPropertyVerifier/1.0 (+https://furlpay.com/travel/directscout)",
          Accept: opts.accept ?? "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        },
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "network error";
      return {
        ok: false,
        reason: /abort|timeout/i.test(message) ? "timeout" : "http_error",
        detail: message,
      };
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) {
        return { ok: false, reason: "http_error", detail: `${res.status} with no Location header.` };
      }
      // Resolve relative redirects against the current URL, then loop — which
      // re-validates the new target before anything connects to it.
      current = new URL(location, current).toString();
      continue;
    }

    if (!res.ok) {
      return { ok: false, reason: "http_error", detail: `HTTP ${res.status}` };
    }

    // Content-Length is a hint, not a promise; the streaming read below is what
    // actually enforces the bound. Checking it first avoids starting a read we
    // know will be refused.
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > maxBytes) {
      return { ok: false, reason: "too_large", detail: `Declared ${declared} bytes.` };
    }

    const body = res.body;
    if (!body) {
      return {
        ok: true,
        url: current,
        status: res.status,
        contentType: res.headers.get("content-type"),
        body: "",
        bytes: 0,
      };
    }

    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          return { ok: false, reason: "too_large", detail: `Exceeded ${maxBytes} bytes.` };
        }
        chunks.push(value);
      }
    } catch (e) {
      return { ok: false, reason: "http_error", detail: e instanceof Error ? e.message : "read failed" };
    }

    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return {
      ok: true,
      url: current,
      status: res.status,
      contentType: res.headers.get("content-type"),
      body: new TextDecoder("utf-8", { fatal: false }).decode(merged),
      bytes: total,
    };
  }

  return { ok: false, reason: "too_many_redirects", detail: `More than ${MAX_REDIRECTS} redirects.` };
}
