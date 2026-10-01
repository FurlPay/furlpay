# Client IP trust model

Status: implemented in the working tree on 2026-09-30. Not committed and not deployed.

**Scope:** how the application decides who the client is, and which proxy-supplied values it will accept, on both production topologies.

**Code:**
- `apps/web/src/lib/clientIp.ts`: the only reader of client-address headers.
- `apps/web/src/lib/publicOrigin.ts`: the only source of the public origin.

**Tests:**
- `lib/__tests__/clientIpTrust.spec.ts`: 43 tests; 5 of 5 mutants killed.
- `lib/__tests__/publicOrigin.spec.ts`: 13 tests; the CSRF mutant is killed.

## Sources

Every statement below comes from one of these:

- **[CF-XFF]** CloudFront, *Request and response behavior for custom origins*, section "Client IP addresses" and the header table.
- **[CF-ORP]** CloudFront, *Use managed origin request policies*, entry `AllViewerExceptHostHeader`.
- **[CF-CH]** CloudFront, *Add custom headers to origin requests*.
- **[CF-TLS]** CloudFront, *Require HTTPS for communication between CloudFront and your custom origin*.
- **[ALB-XFF]** Elastic Load Balancing, *HTTP headers and Application Load Balancers*.
- **[NEXT]** A local reproduction on next **15.5.26** (the repository's version), run as a standalone server with `HOSTNAME=0.0.0.0` exactly as `apps/web/Dockerfile` does. Procedure and output are under "Runtime behaviour".
- **[TF]** `infra/aws/modules/env/edge.tf` and `compute.tf` in this tree.

## Topologies

The repository defines two ways to serve production. The client-IP trust model depends on which one is live, and the application selects the model from deploy configuration.

| Topology | Evidence | Selected by |
|---|---|---|
| **Vercel**: client → Vercel edge → function | `docs/`, memory of the deployed project `web`; `furlpay.com` DNS | `FURLPAY_TRUSTED_PROXY_HOPS` unset |
| **AWS**: client → CloudFront → ALB → ECS Fargate → Next.js | [TF]; **nothing is applied**, see `AWS_DATA_PLANE.md` | `FURLPAY_TRUSTED_PROXY_HOPS=2` (task definition, `compute.tf`) |

This repository shows no Cloudflare in front of either path. No code or configuration reads a Cloudflare header, and the tripwire now forbids `cf-connecting-ip`. If a Cloudflare layer is ever added in front of CloudFront, it is one more appending hop, and the hop count must change with it.

## The twelve questions

**1. Public entry point.**
- AWS: the CloudFront distribution, aliased as `A`/`AAAA` records at `var.domain_name`. The origin hostname `origin-<domain>` resolves to the ALB but is not an entry point (see 8 and 9).
- Vercel: Vercel's edge.

**2. Which proxy adds each header.**

| Header | CloudFront | ALB | Next.js standalone |
|---|---|---|---|
| `X-Forwarded-For` | appends the viewer IP from the TCP connection, or creates the header [CF-XFF] | `append` mode (pinned): appends the IP of the connection it accepted, the CloudFront edge [ALB-XFF] | sets it to the socket peer **only when absent**; never appends [NEXT] |
| `X-Forwarded-Proto` | **removes** the viewer's [CF-XFF, header table] | sets it to the client→ALB protocol [ALB-XFF] | sets it only when absent |
| `X-Real-IP` | removes it (legacy settings) [CF-XFF]; forwarded under the all-viewer policy | — | — |
| `X-Origin-Verify` | added as an origin custom header, **overwriting** any viewer value [CF-CH] | the listener rule requires it [TF] | the app re-checks it, constant-time (`originVerify.ts`) |
| `Host` | not forwarded; set to the **origin** domain [CF-ORP, CF-XFF] | — | — |
| `X-Forwarded-Host` | forwarded as a viewer header (client-controlled) | — | sets it to `Host` only when absent [NEXT] |
| `CloudFront-Viewer-Address` | only added when a policy includes it [CF-ORP] | — | — |

**3. What can overwrite or append each header.**
- `X-Forwarded-For`: every hop appends, and none of them trims. `X-Forwarded-Proto` is replaced by the ALB. `X-Origin-Verify` is replaced by CloudFront.
- A viewer can **prepend** any `X-Forwarded-For` entries it likes. It can never write the entries appended after its own.

**4. Headers a public client can spoof.**
- Any `X-Forwarded-For` entry left of the last two.
- `X-Real-IP` (under the all-viewer policy).
- `X-Forwarded-Host`, `Forwarded`, `True-Client-IP`, `CF-Connecting-IP`, `Client-IP`.
- A **viewer-sent** `CloudFront-Viewer-Address`. Whether CloudFront strips it is not documented, and the configured policy does not add it, so it is never read.

**5. Values only trusted infrastructure can supply.**
- The last two `X-Forwarded-For` entries as they arrive at the task: the viewer written by CloudFront, and the CloudFront edge written by the ALB.
- `X-Forwarded-Proto` (the ALB).
- `X-Origin-Verify` (CloudFront, from a secret the client does not have).

**6. Trusted proxy hops.** Exactly **2** on AWS. This is AWS's documented example verbatim: "`X-Forwarded-For: 192.0.2.2,192.0.2.199`" for the path CloudFront → ELB → instance [CF-XFF]. It is configuration, not a client input: the Terraform task definition sets `FURLPAY_TRUSTED_PROXY_HOPS = "2"`. Production refuses to boot if the value is not an integer from 1 to 8, or if it is unset while `ORIGIN_VERIFY_REQUIRED=true` (`bootConfig.edgeTrustProblems`).

**7. How the application determines the client IP.** `trustedClientIp(req)`:
1. Read the hop count. An invalid value returns null.
2. Take the tail of `X-Forwarded-For`, bounded to 2,048 characters.
3. Require at least N entries.
4. Require every proxy-written entry after the viewer to be a valid IP.
5. Return entry N from the right, normalized.
6. Return **null** whenever any step fails. It never returns a placeholder, and it never falls back to another header.

On Vercel, it takes the platform-set `X-Real-IP`, then the first `X-Forwarded-For` entry, validated the same way.

**8. If CloudFront is bypassed.**
- The ALB security group admits TCP 443 only from `com.amazonaws.global.cloudfront.origin-facing` [TF], so a direct connection is refused at the network layer.
- Another customer's CloudFront distribution can reach that address range, but not our secret. CloudFront overwrites any viewer-supplied `X-Origin-Verify` [CF-CH], and the ALB listener's default action is a 404; only the rule matching the 48-character secret forwards [TF].
- The application re-checks the secret case-sensitively (`originVerify.ts`) and fails closed when it is required but missing.

**9. If the ALB is reached directly.** It can't be, from outside CloudFront's address ranges (point 8).
- Even if an attacker got a request to the task with `X-Forwarded-For: <victim>`, the chain would be `<victim>` plus whatever the ALB appends. The victim would be written by the attacker into a position the model does not trust only if the attacker controls the last hop, which requires both the prefix list and the secret.
- A request with no chain gets a single socket-peer entry from Next [NEXT]. That is one entry, fewer than 2, so the result is **null**.

**10. Multiple `X-Forwarded-For` values.**
- Duplicate header lines are joined in wire order by Node, as observed through Next [NEXT], and by `Headers.get`. The same right-to-left rule then applies. Every entry the client adds lands to the left of the proxy-appended ones, because both proxies append to the end [CF-XFF, ALB-XFF].
- Duplicate addresses and extra empty entries on the left are harmless. An empty or malformed entry in a trusted position voids the chain (null).

**11. IPv4 and IPv6.**
- The strict IPv4 parser has no leading zeros and no shorthand.
- IPv6 follows RFC 4291 in any form CloudFront may write [CF-XFF], plus the bracketed and bracketed-with-port forms the ALB may write [ALB-XFF]. Output is normalized to RFC 5952.
- IPv4-mapped IPv6 (`::ffff:a.b.c.d`) collapses to the IPv4 address, so one client cannot hold two rate-limit identities.
- Zone identifiers are rejected.

**12. Malformed values.** `1.2.3`, `999.999.999.999`, `hello`, `1.2.3.4 evil`, `01.2.3.4`, `0x7f.0.0.1`, over-long entries and fe80 addresses with zone ids all return null. A header of any size costs at most one 2,048-character slice.

## Runtime behaviour [NEXT]

**Setup:** a minimal app on next@15.5.26 with `output: "standalone"`, a route handler and middleware echoing what they see, started as `HOSTNAME=0.0.0.0 PORT=3917 node server.js`.

| Request as it reaches the task | `req.url` / `nextUrl.origin` | `x-forwarded-for` seen |
|---|---|---|
| `Host: <alb name>`, `X-Forwarded-Proto: https`, `XFF: 203.0.113.7, 130.176.0.1` | `https://0.0.0.0:3917` | unchanged |
| `Host: evil.example`, `X-Forwarded-Host: evil.example`, `X-Forwarded-Proto: http` | `http://0.0.0.0:3917` | `127.0.0.1` (set because absent) |
| two `X-Forwarded-For` lines: `9.9.9.9` then `203.0.113.7, 130.176.0.1` | — | `9.9.9.9, 203.0.113.7, 130.176.0.1` |

What this establishes:
- **The request URL's host is the bind address.** It is never `Host` or `X-Forwarded-Host`, so host-header injection cannot steer URL construction.
- **The request URL is also useless as the public origin on ECS.** Hence `publicOrigin()` and `PUBLIC_API_ORIGIN` (Terraform: `https://${var.domain_name}`); see "Related boundaries".
- **Protocol comes from `X-Forwarded-Proto`.** On AWS the ALB sets it and CloudFront strips the viewer's, so it is infrastructure-controlled. The application makes no security decision from it: secure cookies key on `NODE_ENV` (`session.ts`).
- **`socket.remoteAddress` on ECS is the ALB's private address**, never the user. Nothing in the application reads it.

## Consumers

**Every consumer goes through `trustedClientIp`.** The source tripwire fails CI on a new reader of any of these headers:
- `x-forwarded-for`, `x-real-ip`, `cf-connecting-ip`, `true-client-ip`, `x-client-ip`, `client-ip`, `forwarded`, `fastly-client-ip`, `x-cluster-client-ip`, `cloudfront-viewer-address`.

It also fails on any read of `x-forwarded-host`, `-proto`, `-port` or `-prefix`.

| Consumer | Use | On null |
|---|---|---|
| `rateLimitOr429` and the middleware API baseline (150/min) | rate-limit key | one shared, strict `untrusted` bucket per route, still split by the route's extra key (user or phone) |
| `deposit-detect` webhook | optional source allowlist (on top of the HMAC) and a pre-HMAC flood limit | an allowlist refuses; the limit uses the `untrusted` bucket |
| `apiKeyAuth` / `apiKeys.ipAllowed` | an optional allowlist **in addition to** the key | a configured allowlist refuses |
| Rain source check | advisory (the signature decides) | unrecognized |
| wallet transfer | device-intel risk signal | no IP signal |
| newsletter, wallet-handle consent, compliance authority requests | consent/audit evidence | stored as null |
| content leads | consent evidence, a `NOT NULL` column (0019) | stored as the literal `unestablished`, never a plausible address |
| `apikey.auth_failed` audit field | audit | null |

**Fallback policy (null).**
- Under the deployed topology a null cannot happen for a request that reached the task, so null means misconfiguration or a bypass attempt.
- Such requests share one budget: they are neither rejected outright (which would be a self-inflicted outage if the config drifts) nor given a per-request key (which would disable limiting).
- Routes that also key on a user or phone still separate by that key.

## Related boundaries (Host, Origin, forwarded host/proto)

**Public origin.**
- Every redirect, OAuth metadata document, DPoP `htu`, HTTP-signature target URI, checkout return URL and self-fetch now uses `publicOrigin()` / `publicRequestUrl()`.
- Before this change, all of them would have named `https://0.0.0.0:3000` on ECS.
  - Login redirects and OAuth issuers would have been broken.
  - DPoP and agent signatures would have been rejected (fail closed).
- `PUBLIC_API_ORIGIN` is validated as a bare https origin at boot.
- A tripwire forbids request-derived origins outside `publicOrigin.ts`.

**CSRF.**
- The Origin check compares against the configured public host. On AWS, `Host` is the ALB origin hostname, so every legitimate cookie POST would have been refused.
- A cross-site attacker controls neither `Host` (the victim's browser sets it) nor the configuration.
- `wallet/authorize` compared against `req.nextUrl.host` (the bind address) and now uses the public origin too.

**SSRF.**
- No backend fetch destination is derived from `Host`, `X-Forwarded-Host`, `Origin` or `Referer`. The self-fetches (`mcp` apiCaller, `cron/price-cards`) use the configured public origin.
- Outbound fetches of user-supplied URLs go through `property/safeFetch.ts`, which blocks private, link-local and metadata ranges (`isBlockedV4`/`isBlockedV6`, including 169.254.169.254).

**Caching.**
- The default behaviour is `Managed-CachingDisabled`.
- The only cached behaviour is `/static/*` (`CachingOptimized`), and no application route or public file lives there; Next's assets are under `/_next/static`. No personalized or rate-limited response is cacheable at CloudFront.
- WAF rate rules aggregate on the viewer's connection IP, which is not header-derived.

## What is not verified

**UNVERIFIED end to end:** nothing has been deployed to AWS, so there is no live request through CloudFront → ALB → ECS. The chain above rests on AWS documentation plus a local run of the exact Next version.

**The first request after deploy** should be checked with the request below. The application should log the viewer's real address as `trustedClientIp`, and a request to the ALB hostname should be refused.

```
curl -H 'X-Forwarded-For: 1.2.3.4' -H 'X-Real-IP: 1.2.3.4' https://<domain>/api/health
```
