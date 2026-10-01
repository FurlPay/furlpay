# Edge trust boundary

This is the companion to `CLIENT_IP_TRUST_MODEL.md`, which holds the sources and the full derivation. This page is the picture.

**Status:** implemented in code and Terraform, and validated locally. Nothing is deployed to AWS, so the live path is **UNVERIFIED**.

## AWS: client → CloudFront → ALB → ECS (`infra/aws/modules/env/edge.tf`)

```text
                         INTERNET (untrusted: every header is client-chosen)
                               │  any X-Forwarded-For / X-Real-IP / X-Forwarded-Host / X-Origin-Verify
                               ▼
 ┌──────────────────────── CloudFront (api.<domain>) ────────────────────────┐
 │ WAF (rate rules key on the CONNECTION IP, not a header)                    │
 │ appends viewer IP        →  XFF: <client-typed…>, <viewer>                 │
 │ overwrites               →  X-Origin-Verify: <48-char secret>              │
 │ removes                  →  X-Forwarded-Proto                              │
 │ sets Host                →  origin-api.<domain> (viewer Host NOT forwarded)│
 │ TLS to origin            →  validates cert for origin-api.<domain>         │
 └────────────────────────────────┬───────────────────────────────────────────┘
          ═══ TRUST BOUNDARY 1 ═══ │ security group: CloudFront origin-facing prefix list, 443 only
                                   │ listener: default 404; forward ONLY if X-Origin-Verify matches
                                   ▼
 ┌────────────────────────────── ALB (eu-west-1) ─────────────────────────────┐
 │ xff_header_processing_mode = "append" (pinned)                             │
 │ appends CloudFront edge IP  →  XFF: <client-typed…>, <viewer>, <edge>      │
 │ sets X-Forwarded-Proto: https                                              │
 │ drop_invalid_header_fields = true                                          │
 └────────────────────────────────┬───────────────────────────────────────────┘
          ═══ TRUST BOUNDARY 2 ═══ │ app re-checks X-Origin-Verify (constant-time, fail closed)
                                   ▼
 ┌──────────────────── ECS task: Next.js standalone (HOSTNAME=0.0.0.0) ──────────────────────┐
 │ req.url / nextUrl.origin = https://0.0.0.0:3000  (bind address; NOT client-influenced)    │
 │ XFF passed through untouched (Next only sets it when absent)                              │
 │                                                                                           │
 │   lib/clientIp.ts  trustedClientIp(req)                                                   │
 │     FURLPAY_TRUSTED_PROXY_HOPS=2 → viewer = XFF[len-2], every proxy entry must be an IP   │
 │     anything else → null  (never a client value, never a placeholder)                     │
 │                                                                                           │
 │   lib/publicOrigin.ts  publicOrigin(req) → PUBLIC_API_ORIGIN (https://api.<domain>)       │
 │                                                                                           │
 │        ┌──────────────┬───────────────┬─────────────────┬───────────────────┐             │
 │        ▼              ▼               ▼                 ▼                   ▼             │
 │   rate limits    API-key IP      deposit-webhook    consent / audit    redirects, OAuth   │
 │   (null → one    allowlist       allowlist          records            issuer, DPoP htu,  │
 │   strict bucket) (null → deny)   (null → deny)      (null stored)      CSRF host          │
 └───────────────────────────────────────────────────────────────────────────────────────────┘
```

**Boot refuses (production):**
- `ORIGIN_VERIFY_REQUIRED=true` without `FURLPAY_TRUSTED_PROXY_HOPS`.
- `ORIGIN_VERIFY_REQUIRED=true` without a valid `PUBLIC_API_ORIGIN`.
- A hop count outside 1–8.
- A malformed `PUBLIC_API_ORIGIN`.

All are checked in `lib/bootConfig.ts`.

## Vercel: client → Vercel edge → function

The platform overwrites `x-real-ip` and `x-forwarded-for` and routes only the project's configured domains. With `FURLPAY_TRUSTED_PROXY_HOPS` and `PUBLIC_API_ORIGIN` unset, the same two functions read the platform values. `x-vercel-ip-country` is trusted only in this mode (`trustedClientCountry`).

## What an attacker can and cannot do

| Attempt | Result | Evidence |
|---|---|---|
| Rotate `X-Forwarded-For` / `X-Real-IP` to reset rate limits | Their values sit left of the proxy-appended entries and are never read | `clientIpTrust.spec.ts` (43 tests; 5/5 mutants killed) |
| Hit the ALB DNS name directly | TCP refused (prefix-list security group) | `edge.tf` (security group); UNVERIFIED live |
| Their own CloudFront distribution → our ALB | 404 at the listener (no secret) | `edge.tf` listener rule; UNVERIFIED live |
| Send their own `X-Origin-Verify` | CloudFront overwrites it | AWS docs (custom origin headers) |
| `Host` / `X-Forwarded-Host` injection to poison URLs | URL host is the bind address; public origin is config | Next 15.5.26 reproduction; `publicOrigin.spec.ts` |
| Cross-site POST with the victim's cookie | Origin ≠ configured public host → 403 | `publicOrigin.spec.ts` (mutant killed) |
| SSRF via DNS rebinding through `safeFetch` | Socket pinned to the validated address | `safeFetchPinning.spec.ts` |

## Not yet verified

- **A real request through the deployed CloudFront → ALB → ECS chain.** This needs an AWS deploy (BLOCKED_EXTERNAL). The procedure is in `CLIENT_IP_TRUST_MODEL.md` §"What is not verified".
- **The two ACM certificates.** `acm_certificate_arn` (us-east-1) and `alb_certificate_arn` (eu-west-1, covering `origin-*`) must be requested before apply (`docs/aws/RUNBOOK.md`).
