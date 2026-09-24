# FurlPay — environments

**Status: 2026-09-25.** Every row is marked with what is actually true, using
three distinct states. They are not synonyms:

| | meaning |
|---|---|
| **IMPLEMENTED** | the code or configuration exists in this repository |
| **VERIFIED** | a command was run and its output supports the claim |
| **NOT VERIFIED** | plausible, unproven — the evidence needs access this machine does not have |

This file exists because several planning documents have cited
`deploy/ENVIRONMENTS.md`, `deploy/WEB-AWS.md`, `aws/FURLPAY_*.md` and others
that **have never existed in this repository**. The facts in those documents
were largely right; the citations were invented. Anything asserted here is
traceable to a file path or a command below.

---

## 1. The environment variable

`FURLPAY_ENV` ∈ `development` | `staging` | `production`.

**IMPLEMENTED** — `apps/web/src/lib/flags.ts`, `financialEnvironment()`.

It is deliberately **not** `NODE_ENV`. Next sets `NODE_ENV=production` for every
built deployment including preview branches, so a preview would read as
production and either fail closed on everything or — far worse — be treated as
a place where real money may move.

When unset it **infers conservatively**: production only when
`NODE_ENV=production` *and* `VERCEL_ENV=production`, otherwise development.

> The pasted planning documents propose failing startup when `FURLPAY_ENV` is
> missing. The current behaviour defaults to the *safest* value instead. Both
> are defensible; the existing one has the advantage that it cannot take a
> healthy deployment down over a missing variable. Changing it is a decision,
> not a fix.

---

## 2. Money is gated per capability, not by one switch

**IMPLEMENTED** — `apps/web/src/lib/flags.ts`.

Twelve flags, each default OFF, each with its own kill switch:

```
BROKERAGE_LIVE          TOKENIZED_STOCKS_LIVE   ONCHAIN_SETTLEMENT_LIVE
ONCHAIN_BALANCES_LIVE   DEFI_COLLATERAL_LIVE    AI_TRADING_LIVE
CROSS_CHAIN_STOCKS_LIVE HARDWARE_WALLET_LIVE    CARD_ISSUING_LIVE
BANKING_LIVE            ONRAMP_LIVE             OFFRAMP_LIVE
```

Four gates, all of which must pass:

1. **enabled** — explicitly on for this deployment
2. **environment** — permitted in this environment
3. **credentials** — every credential the capability needs is actually present
4. **kill switch** — no operator has pulled the emergency stop

Gate 3 is why the file knows env var *names* rather than just booleans.
"Enabled but unconfigured" is the state that produces a fabricated success: the
flag says go, the provider client has no key, and a fallback invents a fill.

A separate, coarser switch exists: `INTEGRATION_MODE=live`
(`apps/web/src/lib/integrations.ts`), which fails closed when production
integrations are unconfigured.

> A single global `ENABLE_REAL_MONEY` has been proposed. It would be a
> **downgrade** — it is exactly the all-or-nothing switch this design replaced.

### Rail pauses

**IMPLEMENTED** — `apps/web/src/lib/ops/controls.ts`.

Durable, server-enforced pauses over `x402`, `mpp`, `lifi`, `cctp`, `transfers`,
plus a global pause. Every money route calls `assertRailActive()`. State lives
in KV so a pause applies across all serverless instances.

---

## 3. Per-client environment

**IMPLEMENTED 2026-09-24.** Before that date *no client had any environment
concept* — all four hardcoded production, and `eas.json` declared no `env` block
on any profile. A `development` EAS build, a preview build handed to a tester,
a debug Gradle install and an Xcode Debug run all talked to the production
backend.

| Client | Mechanism | File |
|---|---|---|
| React Native (Android + iOS) | `FURLPAY_ENV` → `EXPO_PUBLIC_API_BASE` | `native-app/app.config.js`, `eas.json` |
| Guardian Android | Gradle product flavor → `BuildConfig.API_BASE_URL` | `guardian/app/mobile/build.gradle.kts` |
| Guardian Wear OS | same flavor, same suffix | `guardian/app/wear/build.gradle.kts` |
| iOS + watchOS | xcconfig → Info.plist → `AppEnvironment` | `ios/FurlPayGuardian/Config/*.xcconfig` |
| Chrome extension | `import.meta.env.DEV`, origin-allowlisted | `apps/extension/lib/api.ts` |

| | dev | staging | prod |
|---|---|---|---|
| API base | `api-dev.furlpay.com/api` | `api-staging.furlpay.com/api` | `api.furlpay.com/api` |
| RN app id | `com.furlpay.app.dev` | `com.furlpay.app.staging` | `com.furlpay.app` |
| Guardian app id | `com.furlpay.guardian.dev` | `.staging` | `com.furlpay.guardian` |
| iOS bundle id | `com.furlpay.guardian.dev` | `.staging` | `com.furlpay.guardian` |
| APNs | sandbox | **production** | production |

### Two invariants that are not optional

**Phone and watch must share an application/bundle id.** Android pairs them by
identical `applicationId` through the Wearable Data Layer, so the environment
suffix sits on the *flavor* and is duplicated byte-for-byte in both
`build.gradle.kts` files; CI asserts it with `aapt2 dump packagename`. On iOS
the equivalent is `WKCompanionAppBundleIdentifier`, which carries the same
suffix — without it a staging watch app pairs with the tester's **production**
phone app. Breaking either produces a watch that shows no data and logs no
error.

**Staging uses production APNs.** TestFlight issues production push tokens even
for internal testers. A staging build registered for the sandbox receives
nothing, silently.

---

## 4. AWS

**IMPLEMENTED** — `infra/aws/`. Three fully isolated stacks; nothing shared but
the Route53 zone, the ECR repository and the Terraform state bucket.

| | dev | staging | prod |
|---|---|---|---|
| API host | `api-dev.furlpay.com` | `api-staging.furlpay.com` | `api.furlpay.com` |
| VPC CIDR | `10.10.0.0/16` | `10.20.0.0/16` | `10.30.0.0/16` |
| Fargate | 1 × 0.5 vCPU | 2 × 1 vCPU | 3–12 × 2 vCPU |
| Aurora | 0.5–1 ACU, single-AZ | 0.5–4 ACU, single-AZ | 2–16 ACU, multi-AZ |
| Backups | 7 days | 7 days | 35 days |
| Logs | 7 days | 30 days | 365 days |
| Delete protection | off | off | **on** |

Three subnet tiers by trust level: **public** (ALB only), **private** (Fargate,
NAT egress), **isolated** (Aurora + ElastiCache, *no default route at all*).

### VERIFIED

```
terraform fmt -check -recursive     clean
terraform validate  dev             Success! The configuration is valid.
terraform validate  staging         Success! The configuration is valid.
terraform validate  prod            Success! The configuration is valid.
```

Production refuses a tag-pinned image — proven to fire, not merely to parse:

```
-var container_image=repo/web:latest
  → Error: Invalid value for variable
    Production must deploy an image pinned by digest (…@sha256:…), not by tag.
-var container_image=repo/web@sha256:0123…cdef
  → plans clean
```

Re-run by CI on every `infra/**` change: `.github/workflows/infra-validate.yml`.

### NOT VERIFIED

- **No `terraform plan`, no `apply`.** Plan needs credentials and the S3
  backend. Validate proves internal consistency, *not* that this deploys.
- **No AWS resources exist.** Nothing costs money yet.
- Everything plan would catch is an API-call question: does this ACM certificate
  exist, is this hosted zone id real, is this name already taken.

---

## 5. Scheduled jobs

**IMPLEMENTED** — `infra/aws/modules/env/scheduler.tf`.

Five jobs in `apps/web/vercel.json`. Vercel Cron does not exist outside Vercel,
so on AWS they stop running silently — and two of the five are the jobs that
exist to tell you money has gone wrong.

| Vercel | EventBridge | Path |
|---|---|---|
| `15 6 * * *` | `cron(15 6 * * ? *)` | `/api/cron/reconcile` |
| `45 6 * * *` | `cron(45 6 * * ? *)` | `/api/cron/health` |
| `30 21 * * *` | `cron(30 21 * * ? *)` | `/api/cron/market-brief` |
| `5 13 * * *` | `cron(5 13 * * ? *)` | `/api/cron/price-cards` |
| `20 6 * * *` | `cron(20 6 * * ? *)` | `/api/cron/discord-welcome` |

The expressions are translated, not copied: Vercel uses 5-field UNIX cron,
EventBridge uses 6 and rejects `*` in both day-of-month and day-of-week —
exactly one must be `?`. Both are UTC.

Auth already existed: `apps/web/src/lib/cron/auth.ts` accepts
`x-furlpay-cron-key: <FURLPAY_CRON_SECRET>` for an external scheduler and
**refuses every job when neither secret is configured**. `x-vercel-cron` is
documented there as *not* a credential.

Failed invocations land on an SQS DLQ with an alarm. Without it a reconciliation
run that fails every retry is discarded, and the next signal is a customer.

---

## 6. KV / Redis

**Current: Upstash REST** (`apps/web/src/lib/kv.ts`), selected by
`UPSTASH_REDIS_REST_URL`/`TOKEN` or the `KV_REST_API_*` aliases. Falls back to a
bounded in-memory map, which **throws in production** rather than silently
serving per-lambda state for webhook dedup, auth challenges and rate limits.

### The 256 MB incident — VERIFIED, and the premise was wrong

A report claimed "99.5% of the previous Redis usage was market-data cache while
passkey authentication failed". That string appears nowhere in this repository,
and a direct read-only measurement of the configured store contradicts it:

```
node apps/web/scripts/kv-capacity-report.mjs
  DBSIZE           73 keys
  projected total  15.4 KB
  quota            256 MB   (0.0059%)
```

`profile:avatar:{id}` — the only family whose per-key size can plausibly reach
hundreds of MB — has **zero keys**. The configured database is not the one that
hit the quota. FurlPay has more than one Upstash database; re-run the report
against the failing deployment's before changing any TTL policy.

The market cache was in fact the one family that already carried a TTL.

### What the static audit did find

35 `kvSet` call sites pass no TTL; 8 `kvListPush` families have no TTL parameter
at all. One real defect **FIXED** (`e3f70cb`): `mkt:resolve:{SYMBOL}` cached
*negative* answers for 6 hours, keyed on a URL path segment gated only by
`/^[A-Z0-9]{1,8}(?:[.-][A-Z0-9]{1,4})?$/` — a format bound, not a cardinality
bound, admitting ~10¹² strings. ~1M requests to `/markets/<random>` retains
~238 MB of records that something does not exist. Unknown symbols now expire in
120 s; real ones keep the 6 h TTL. 180× reduction in retained negatives.

**NOT IMPLEMENTED:** the ElastiCache/Valkey migration. `infra/aws` provisions
ElastiCache and assembles a `rediss://` URL, but `kv.ts` still speaks the
Upstash REST protocol. Moving requires replacing that transport with a standard
client — not repointing a URL.

---

## 7. Blockchain

Arc (chain 5042) — **VERIFIED on mainnet 2026-09-25**, by `eth_call`, not from a table:

```
eth_chainId                                      0x13b2  (5042)
USDC(0x3600…0000).decimals()                     6
USDC(0x3600…0000).symbol()                       "USDC"
MessageTransmitterV2(0x81D4…4B64).localDomain()  26
TokenMessengerV2(0x28b5…cf5d).localMinter()      0xfd78…D002
TokenMinterV2.burnLimitsPerMessage(USDC)         10_000_000e6
```

The last line is load-bearing: a domain in a table proves intent, a non-zero
burn limit proves the burn leg resolves.

Arc's dual-interface decimals reproduced independently at a live balance:
`467048820775384575 ÷ 10¹² = 467048` exactly — 18 decimals natively, 6 through
ERC-20, discarding 820775384575 of sub-6dp dust the ERC-20 interface cannot
move.

**Chainalysis Sanctions Oracle is NOT deployed on Arc** (`eth_getCode` → `0x`,
vs 7116 chars on Arbitrum). A compliance escrow deployed there silently degrades
to registry-only screening. Recorded in `packages/contracts/scripts/deploy-compliance.ts`.

**NOT DEPLOYED:** no FurlPay contract exists on any mainnet. 11 Solidity
contracts, no `deployments/` directory, no recorded address.
`packages/contracts/deployment.yaml` says so in capitals.

---

## 8. Honest status

`PRODUCTION_READINESS.md` (6 Sep 2026): **"READY FOR TESTNET. Not ready for
real-money private beta. Not ready for mainnet."** Nothing since then changes
that. The money layer is a deliberate fail-closed simulation.

That is a real mitigation *now* and a blind spot *later*: the day
`INTEGRATION_MODE=live` flips, every BOLA, idempotency, race and replay path
becomes live for the first time, with no prior evidence it holds.

### Before real money

1. Run `terraform plan` against dev. Expect to iterate.
2. **Add the origin-verification check to the web middleware.** Until the app
   rejects requests without `X-Origin-Verify`, the ALB is reachable by any
   CloudFront distribution and the WAF in front of it protects nothing.
   Runbook: `docs/aws/RUNBOOK.md` §3.
3. Build the iOS target — the Swift work is reviewed but never compiled.
4. Assemble `stagingDebug` for phone and watch and confirm they pair.
5. Point a staging build at a real ACM-fronted host and confirm the handshake
   on Android **and** iOS. Certificate pins cover both hierarchies
   (`docs/audit/2026-09-25-remediation.md`), but that is unproven against a live
   ACM endpoint.
