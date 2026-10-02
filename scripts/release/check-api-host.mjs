#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Is this host safe to be the shipped mobile app's API?
//
//   node scripts/release/check-api-host.mjs [host]      (default api.furlpay.com)
//
// Production native builds call https://api.furlpay.com/api (native-app/
// app.config.js, deploy/ENVIRONMENTS.md) and PIN its TLS chain to the anchors
// in native-app/plugins/withNetworkSecurityConfig.js (iOS mirrors them). A host
// that resolves and serves HTTPS can still be unusable by the app if its chain
// ends at an unpinned root. This checks all three, read-only:
//
//   1. DNS   — the name resolves.
//   2. TLS   — the chain's ROOT (found in Node's trust store, signature-
//              verified against the top served certificate) has an SPKI
//              SHA-256 that is one of the app's pins. Pins are read from the
//              plugin file itself, so this cannot drift from what ships.
//   3. HTTP  — GET /api/health answers 200.
//
// Exit 0 only when all three pass. Makes no change anywhere.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { lookup } from "node:dns/promises";
import { connect, rootCertificates } from "node:tls";
import { X509Certificate, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const host = process.argv[2] ?? "api.furlpay.com";
const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const plugin = readFileSync(join(repo, "native-app", "plugins", "withNetworkSecurityConfig.js"), "utf8");
const pins = new Set([...plugin.matchAll(/<pin digest="SHA-256">([A-Za-z0-9+/=]+)<\/pin>/g)].map((m) => m[1]));

const spki = (cert) => createHash("sha256").update(cert.publicKey.export({ type: "spki", format: "der" })).digest("base64");
let failures = 0;
const report = (ok, what, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

console.log(`host ${host}; ${pins.size} pins from withNetworkSecurityConfig.js`);

// 1. DNS
let addresses = [];
try {
  addresses = await lookup(host, { all: true });
  report(addresses.length > 0, "DNS resolves", addresses.map((a) => a.address).join(", "));
} catch (e) {
  report(false, "DNS resolves", e.code ?? e.message);
}

// 2. TLS chain terminates at a pinned root
if (addresses.length) {
  const chain = await new Promise((resolve) => {
    const s = connect({ host, port: 443, servername: host, timeout: 15_000 }, () => {
      const out = [];
      let c = s.getPeerCertificate(true);
      const seen = new Set();
      while (c && c.raw && !seen.has(c.fingerprint256)) {
        seen.add(c.fingerprint256);
        out.push(new X509Certificate(c.raw));
        c = c.issuerCertificate;
      }
      s.end();
      resolve({ ok: true, out, authorized: s.authorized, err: s.authorizationError });
    });
    s.on("error", (e) => resolve({ ok: false, err: e.message }));
    s.on("timeout", () => {
      s.destroy();
      resolve({ ok: false, err: "timeout" });
    });
  });

  if (!chain.ok) {
    report(false, "TLS handshake", chain.err);
  } else {
    report(chain.authorized, "TLS chain validates", chain.authorized ? "" : String(chain.err));
    const top = chain.out[chain.out.length - 1];
    const roots = rootCertificates.map((pem) => new X509Certificate(pem));
    // The served chain may or may not include the root; find the anchor.
    const anchor =
      chain.out.find((c) => roots.some((r) => r.fingerprint256 === c.fingerprint256)) ??
      roots.find((r) => top.checkIssued(r) && top.verify(r.publicKey));
    if (!anchor) {
      report(false, "chain root found in trust store", top.issuer.replace(/\n/g, ", "));
    } else {
      const pin = spki(anchor);
      const name = anchor.subject.split("\n").find((l) => l.startsWith("CN=")) ?? anchor.subject;
      report(pins.has(pin), "root is pinned by the app", `${name} spki=${pin}`);
    }
  }
}

// 3. HTTP
if (addresses.length) {
  try {
    const res = await fetch(`https://${host}/api/health`, { signal: AbortSignal.timeout(15_000) });
    report(res.status === 200, "GET /api/health", `status ${res.status}`);
  } catch (e) {
    report(false, "GET /api/health", e.cause?.code ?? e.message);
  }
}

console.log(failures ? `\n${failures} check(s) failed: ${host} is NOT usable by the shipped app.` : `\n${host} is usable by the shipped app.`);
process.exit(failures ? 1 : 0);
