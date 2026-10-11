import { createHmac, randomBytes } from "node:crypto";

// Hawk request signing as BVNK specifies it
// (https://docs.bvnk.com/bvnk/api-explorer/api-overview/authentication):
//   normalized = "hawk.1.header\n" + ts + "\n" + nonce + "\n" + METHOD + "\n"
//              + resource (path + query) + "\n" + host (lowercase) + "\n"
//              + port + "\n" + hash + "\n" + ext + "\n"
//   mac = base64(HMAC-SHA256(key, normalized))
// BVNK does not use Hawk payload or response validation, so `hash` is empty,
// and it sends no `ext`. Both are kept as parameters only so the
// implementation can be checked against the reference Hawk test vector.

export type HawkCredentials = { id: string; key: string };
export type HawkArtifacts = { ts: number; nonce: string; method: string; resource: string; host: string; port: number; hash?: string; ext?: string };

const NONCE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** Six alphanumeric characters from a CSPRNG (BVNK's samples use six). */
export function hawkNonce(length = 6): string {
  const bytes = randomBytes(length * 2);
  let out = "";
  for (let i = 0; out.length < length && i < bytes.length; i++) {
    // Rejection sampling: 248 is the largest multiple of 62 below 256, so
    // every character is equally likely.
    if (bytes[i] < 248) out += NONCE_ALPHABET[bytes[i] % 62];
  }
  return out.length === length ? out : hawkNonce(length);
}

export function hawkNormalizedString(a: HawkArtifacts): string {
  return ["hawk.1.header", a.ts, a.nonce, a.method.toUpperCase(), a.resource, a.host.toLowerCase(), a.port, a.hash ?? "", a.ext ?? ""].join("\n") + "\n";
}

export function hawkMac(key: string, a: HawkArtifacts): string {
  return createHmac("sha256", key).update(hawkNormalizedString(a)).digest("base64");
}

/** The Authorization header value for one request. */
export function hawkHeader(creds: HawkCredentials, a: HawkArtifacts): string {
  const mac = hawkMac(creds.key, a);
  const ext = a.ext ? `, ext="${a.ext}"` : "";
  return `Hawk id="${creds.id}", ts="${a.ts}", nonce="${a.nonce}"${ext}, mac="${mac}"`;
}

/** Header for a URL, with a fresh timestamp and nonce. */
export function hawkHeaderFor(creds: HawkCredentials, method: string, url: string, now = Date.now(), nonce = hawkNonce()): string {
  const u = new URL(url);
  const port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
  return hawkHeader(creds, { ts: Math.floor(now / 1000), nonce, method, resource: u.pathname + u.search, host: u.hostname, port });
}
