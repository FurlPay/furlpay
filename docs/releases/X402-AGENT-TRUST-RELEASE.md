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
