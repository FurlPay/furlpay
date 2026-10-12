# Release checklist — @furlpay/x402-guard and @furlpay/agent-trust

**Status: PREPARED, NOT PUBLISHED.** Nothing in this document has been run
against the npm registry. `npm publish` requires explicit approval.

Prepared 2026-09-25.

## Merged commits

| Repo | PR | Merge commit | `main` HEAD |
|---|---|---|---|
| FurlPay/x402-guard | #7 | `369c49c0cab8d8543634f1f94044eb0fccfae13c` | same |
| FurlPay/agent-trust | #1 | `261afb10f968ed3bcc82c6639eeedfbc4a8019ac` | same |

A follow-up fix is **open, not merged**: FurlPay/agent-trust#2 (`fix/approval-unreachable`).
It must land before agent-trust is published — see Blockers.

## Validation, from a clean clone of each merged `main`

Not from the working tree used to prepare the sync.

| | x402-guard | agent-trust |
|---|---|---|
| `npm ci` | ok | ok |
| `npm run build` | ok | ok |
| `npx tsc --noEmit` | clean | clean |
| `npm test` | **117 tests, 112 pass, 0 fail, 5 skipped** | **73 tests, 73 pass, 0 fail** |

The 5 skips in x402-guard are the Redis integration suite, which requires a live
Redis and skips itself when none is configured. They are pre-existing and are
skips, not failures.

**GitHub Actions did not run.** Every workflow on both repos reports
*"The job was not started because your account is locked due to a billing issue."*
The results above are local runs. **Do not represent this as CI passing** —
there is currently no CI gating these repositories at all.

## Public API verification

Resolved by importing the built output through the package entrypoints, then by
installing the packed tarball into a scratch project.

**x402-guard** — 17 root exports. Confirmed present:
`RedisNonceStore`, `RedisAllowanceStore`, `RedisMandateSpendStore`,
`RedisSettlementCapacityLimiter`, `windowKeyFor`, `evaluateSpendAuthorization`,
`assertValidWindow`, `isRolling`, `windowEndsAt`, `evaluateMandate`,
`matchesPattern`, `SettlementCapacityLimiter`, `guardedSettle`, `guardedCharge`,
`MemoryNonceStore`, `MemoryAllowanceStore`, `requestBindingHash`.

Two names on the review checklist resolve differently and are **not** missing:

- `RedisCapacityLimiter` is exported as **`RedisSettlementCapacityLimiter`**,
  matching the in-memory `SettlementCapacityLimiter`.
- `WindowSpec` and `SettlementAuthorization` are **types**, erased at runtime.
  Both verified present in `dist/mandate.d.ts` and `dist/policy.d.ts`.

All four subpaths resolve for a consumer: `.`, `/redis`, `/mandate`, `/policy`.

**agent-trust** — 15 root exports, all previously published names intact.
`issueApproval`, `verifyApproval`, `approvalFromExtra`,
`APPROVAL_SIGNING_DOMAIN` (= `x402-approval/v1`), `X402_APPROVAL_EXTRA_KEY`
present in the approval module.

## Package contents (`npm pack --dry-run`)

**x402-guard** — 23 files. `dist/` (js + d.ts), `src/`, `harness/`, README,
LICENSE, package.json. No `.env`, no keys, no test files, no CI config, no
monorepo material.

**agent-trust** — 14 files **before** the fix; 12 after. The pre-fix tarball
shipped `dist/tests/spend.test.js` (12.7kB of compiled test code).

## Versioning

Source on `main` is identical to the monorepo packages (verified file-by-file,
ignoring line endings). npm and `main` carry the **same version numbers for
different content** — that is the reason a bump is mandatory before publish.

| Package | npm today | Proposed | Why |
|---|---|---|---|
| `@furlpay/x402-guard` | 0.2.0 | **0.3.0** | Additive: new `/redis`, `/mandate`, `/policy` subpaths and the mandate surface. `SettlementCapacityLimiter` keeps its name and now implements a new `CapacityLimiter` interface — no removal, no signature change. Minor. |
| `@furlpay/agent-trust` | 0.1.0 | **0.2.0** | Additive: `/approval` and `/spend` subpaths, `index.ts` +186/−0. Minor. |

No major bump is justified for either. Neither has breaking changes, and no
consumer migration is required.

**One caveat on the approval signature format.** `issueApproval` signs
`x402-approval/v1|<payload>` rather than the bare payload. That is a format
change, but `approval.ts` has never been in a published release, so no existing
signature is invalidated and it is additive from the registry's point of view.
Mandate and booking-token signing were deliberately left un-domained for exactly
the opposite reason — changing those would invalidate every mandate signed under
published 0.1.0, and needs a major version.

## Security review (implementation read, not test names)

**`releaseProvenUnsettled()` cannot incorrectly restore spend.** The concern is
real and the code closes it. The TypeScript does `HMGET` then `EVAL` — two round
trips — so a commit can land in between. The Lua opens with
`if redis.call('GET', KEYS[1]) ~= 'pending' then return 0 end`, so:

- after `commit()` (which sets the nonce to `settled` and deletes the
  reservation) a release finds no reservation and returns false before the
  script runs; even if it ran, the nonce guard returns 0;
- two concurrent releases: the first deletes the nonce, the second sees a
  missing nonce, fails the `== 'pending'` test, and refunds nothing.

Double-refund is prevented twice over. The refunded amount is read from the
reservation record, not supplied by the caller.

**Residual risk, by design.** A release *deletes* the nonce rather than marking
it, returning the payment to a replayable state. That is correct only when the
caller has positive proof no settlement landed — the method name states the
precondition, and no timer can satisfy it. A caller that releases on a timeout
reopens replay for the payment most likely to have settled.

## Findings

| Severity | Finding | Status |
|---|---|---|
| **High** | The entire approval API was **unreachable by any published import path**. `exports` declared only `"."`, and `index.ts` does not re-export `approval.js`, so `issueApproval`/`verifyApproval` shipped inside the tarball and could not be imported. The README and furlpay-x402#1 both document that import. | Fix open in agent-trust#2 |
| Medium | agent-trust published compiled test code (`dist/tests/*`) — `rootDir: "."` plus `files: ["dist"]`. | Fix open in agent-trust#2 |
| Medium | x402-guard declared no `typescript` devDependency and built only inside the monorepo; a clean standalone `npm run build` failed with `'tsc' is not recognized`. | Fixed in #7 |
| Medium | agent-trust's `npm test` ran one file; `test/agent-trust.test.js` was never executed and had been failing to load. | Fixed in #1 |
| Informational | No CI on either repo — Actions is billing-locked account-wide. Local runs are the only verification. | Open, outside this work |
| Informational | Both packages are ESM-only (`"type": "module"`, no `require` condition). A CJS consumer gets `ERR_PACKAGE_PATH_NOT_EXPORTED`. Deliberate, but undocumented. | Open |

## Blockers before publish

1. **agent-trust#2 must merge.** Publishing 0.2.0 without it ships an approval
   API that cannot be imported — the exact claim the RFC makes.
2. Version bumps are not yet applied to either `package.json`.
3. No CI. Accepting these releases means accepting local-only verification.

## Publish commands — DO NOT RUN WITHOUT APPROVAL

```bash
# 1. merge FurlPay/agent-trust#2 first

# 2. bump, from a clean clone of each merged main
npm version minor --no-git-tag-version     # 0.2.0 -> 0.3.0 / 0.1.0 -> 0.2.0
git commit -am "chore: release" && git tag vX.Y.Z && git push --follow-tags

# 3. verify what would ship, one last time
npm ci && npm run build && npm test && npm pack --dry-run

# 4. publish
npm publish --access public
```

## Rollback

npm does not allow re-publishing a version. If a bad version ships:

```bash
npm deprecate @furlpay/<pkg>@X.Y.Z "broken: <reason>; use X.Y.Z+1"
# publish the corrected patch immediately
```

`npm unpublish` is available only within 72 hours and only if nothing depends on
the version; prefer deprecate-and-supersede. Do not unpublish a version another
package has resolved.

## Post-publish verification

```bash
npm view @furlpay/<pkg> version dist-tags
mkdir /tmp/verify && cd /tmp/verify && npm init -y && npm install @furlpay/<pkg>
node --input-type=module -e "import('@furlpay/x402-guard/policy').then(m=>console.log(Object.keys(m)))"
node --input-type=module -e "import('@furlpay/agent-trust/approval').then(m=>console.log(Object.keys(m)))"
```

The second command is the one that would have caught the High finding above.

---

# Security release, 2026-10-12: `@furlpay/agent-trust@0.2.0` and `@furlpay/x402@0.2.0`

**Status: STAGED ON NPM, NOT PUBLISHED.** Releasing needs the owner's 2FA
approval, and agent-trust must be re-staged first (see Release procedure).

## Vulnerabilities

| # | Package | Source | Defect | Severity | Fixed in |
|---|---|---|---|---|---|
| 1 | x402 | external report | With `bindingSecret` set, the single-use claim key was the quote id, not the EIP-3009 nonce. A quote is free with every 402, so one authorization under N quotes released the resource N times and reached `settle()` N times. | Medium (resource over-delivery; on-chain nonce consumption is the only backstop, and only at `finalized` strength) | FurlPay/furlpay-x402#15 |
| 2 | agent-trust | external report | Spend caps compared IEEE-754 doubles: a $0.30 mandate refused $0.20 after $0.10. | Low (availability) | FurlPay/agent-trust#4, monorepo #121 |
| 3 | x402 | found in remediation | The nonce was compared as a string, so `0xAB…`, `0xab…` and `ab…` (one on-chain nonce) were three claims. This replayed a payment with binding OFF. An empty nonce was a shared key. | Medium | #15 |
| 4 | x402 | found in remediation | Claims expired on a fixed 1h TTL while `validBefore` was unbounded, so a long-lived authorization became replayable after an hour. | Medium | #15 |
| 5 | agent-trust | found in remediation | `verifyBookingToken` read `spent` and the single-use flag before `await nonces.add()` and wrote them after it. Concurrent bookings each passed the cap: 3×$60 cleared $100, and a single-use mandate was spent twice, with the default in-memory store. | **High** (spend over the user-signed cap) | #4, #121 |

## Threat model, after the fix

- **x402.** The replay identity is `n:<network>:<canonical nonce>` in every mode, claimed atomically before settlement. The quote restricts the resource, price, recipient and network, never the identity. A claim is held until `validBefore` + 10 minutes. Settlement outcomes: success keeps the claim; a definite decline releases it; an exception keeps it ("unknown is not failed"); insufficient strength releases it, and a retry can grant at most once. A store that throws fails closed. Untrusted fields remain: `from` is not part of the key (a payer-controlled value would mint keys against a facilitator that reports success at broadcast), and with `skipLocalVerification` the recipient is unchecked locally (pre-existing, documented as unsafe).
- **agent-trust.** All limit decisions use integer micro-dollars. Amounts that cannot be read back exactly are refused, not rounded. The cap check and reservation are one synchronous step, rolled back on replay or nonce-store failure. Budgets are per `AgentTrust` instance: route one mandate to one verifier.

## Compatibility and migration

- agent-trust: the signed v1 format is unchanged, and existing mandates and tokens verify. New refusals: more than 6 decimal places, exponent forms, non-finite, negative, or ≥ $1e9, at issue and at verify. `TrustDecision.remainingUsdExact` is new. No in-house consumer uses the booking path (`apps/web` imports only `keyIdOf` and `verifyRequest`).
- x402: new optional `claim(key, holdUntilMs)` argument. Shared stores must keep keys until then (Redis: `SET k 1 NX PXAT <holdUntilMs>`). `claimKey`'s third argument is ignored. New refusals: a malformed nonce, or no usable `validBefore`, returns `malformed_payload`. First npm release; 0.1.0 was never published.

## Verification (local only; CI is billing-locked on both GitHub accounts)

| Check | agent-trust | x402 |
|---|---|---|
| Suite, Node 26 | 95/95 (standalone and monorepo copy) | 88/88 |
| Suite, Node 18.20.8 | 95/95 | 88/88 |
| New tests failing on the vulnerable code | 13 of the 20 targeted tests + both property tests | 13 of 19 targeted + the property test (seed 1: 7 grants for one nonce) |
| `tsc` | 0 errors | 0 errors |
| `npm audit` | 0 vulnerabilities, no runtime deps | 0, no runtime deps |
| Tarball | 12 files, no tests, no secret patterns | 17 files, no tests, no secret patterns |
| Installed-tarball smoke | `.`, `/approval`, `/spend` import; $0.30 cap: 0.10 ✓, 0.20 ✓, 0.01 ✗ | ESM + CJS; one nonce, 3 quotes: ✓ ✗ ✗ |

Source parity: `src/*`, tests, README and tsconfig are byte-identical between FurlPay/agent-trust and `packages/agent-trust` (CR-stripped). package.json differs only in JSON escaping.

## Release procedure

1. Merge FurlPay/furlpay-x402#15 and FurlPay/agent-trust#4 (no branch protection, no CI available).
2. **agent-trust: reject the stale staged artifact** (stage id `2d2007a1-…`, shasum `047e0d35…`, built before the README and comment sync). Re-stage from merged `main`:
   `npm stage reject <id>`, then `npm ci && npm test && npm stage publish --access public` (npm ≥ 12).
3. x402: its staged artifact (`1ffe54ba-…`) was built from `937d2dc`; no shipped file has changed since. Confirm the shasum on the npm approval page equals a fresh `npm pack` of merged `main`.
4. Approve both staged releases on npmjs.com with 2FA. The packages do not depend on each other; order does not matter.
5. Verify: `npm view @furlpay/<pkg> version dist-tags` and the Post-publish verification commands above. x402's `latest` currently points at npm's `0.0.0-stage` placeholder; approval must move it to `0.2.0`.
6. Deprecate the vulnerable release:
   `npm deprecate @furlpay/agent-trust@0.1.0 "Spend caps can be exceeded by concurrent bookings and refuse exact-cap bookings; upgrade to 0.2.0"`
7. Merge monorepo #121.

Rollback: a published version cannot be replaced. Deprecate it and publish 0.2.1.

## Credentials

Two npm access tokens (prefixes `npm_lE27…`, `npm_eENA…`) were pasted into a chat
session on 2026-10-12. They do not appear in any repository, git history, npm
log or `~/.npmrc`; their only on-disk copy is that session's transcript. Treat
both as compromised: revoke them at npmjs.com → Access Tokens, review the
account's recent publishes, and prefer npm trusted publishing (OIDC from GitHub
Actions) once Actions billing is restored. `~/.npmrc` on the release machine
holds a third, already-invalid token that npm uses as project config when run
outside a package directory; replace it.

## Monitoring and incident response

- x402: alert on `payment_already_used` spikes per resource (replay attempts) and on `settlement_unknown` (claims held on unknown outcomes). A claim-store error surfaces as a thrown `gate()` and should page.
- agent-trust: alert on the `exceeds remaining allowance` rate and on nonce-store errors (each one rolls back a reservation).
- Reporters: credit per SECURITY.md once 0.2.0 is published.

## Remaining limitations

- `packages/gateway` claims `x402:nonce:<raw nonce>` with the same spelling weakness as #3. Not fixed here.
- agent-trust budgets are process-local.
- No third-party audit. No CI. Mocked facilitators prove SDK behaviour, not on-chain settlement.
