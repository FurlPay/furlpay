# MFA: recovery codes, and the downgrade hole that was open

Two changes to `/api/security/mfa`, one of them a real vulnerability fix.

## 1. Turning MFA off required no second factor

`action: "disable"` used to do this:

```ts
if (body.action === "disable") {
  sec.totpEnabled = false;   // no code checked
  await persistAccount(user.id);
  ...
}
```

A valid session was the only thing required. That made the **second factor
removable with only the first**: anyone holding a stolen session — XSS, a
borrowed unlocked laptop, a lifted cookie — could strip MFA and keep long-term
access. That is the exact attack MFA is bought to prevent.

It was also silent. The handler left `totpSecret` in place, so nothing recorded
that the account had been downgraded, and a later re-enable looked like nothing
had happened.

The client made it explicit, which is how this was found:

> *Deliberately sends NO code: the route disables on the authenticated session
> alone and never checks one.*

Both sides are fixed. Disabling now requires a live TOTP code **or** a
single-use recovery code, and on success it clears `totpSecret` and the recovery
codes rather than leaving orphaned credential material behind. The audit entry
records which factor authorised it (`via: "totp" | "recovery"`).

`regenerate-recovery` sits behind the same proof, because replacing the set
invalidates the old one and is therefore also a credential change.

## 2. There was no recovery path at all

`getBackupCodes()` threw `NotWiredError` — correctly. Handing someone a printout
that unlocks nothing is worse than admitting the gap, and the repo's standing
rule is to fail visibly rather than fake it.

But the gap itself was serious: with TOTP as the only factor, a lost or wiped
phone meant a **permanently locked account**. MFA stops an attacker getting in;
with no recovery path it just as reliably stops the owner. The usual workaround —
a human agent switching MFA off on request — is a social-engineering hole far
larger than the one MFA closed.

`lib/mfaRecovery.ts` now implements it:

| Property | Choice |
| --- | --- |
| Count | 10 codes, minted together |
| Shape | `xxxxx-xxxxx`, 30-symbol alphabet excluding `I L O U` (≈49 bits) |
| At rest | **SHA-256 hashes only.** A recovery code is a second factor; a database read must not yield working codes |
| Single use | Consuming a code deletes its hash — a leaked used code is worthless, and replay fails |
| Comparison | `timingSafeEqual`, every candidate compared even after a match, so response time does not reveal a code's position |
| Randomness | `randomBytes` with **rejection sampling** — `% 30` would over-represent the first 16 symbols, a small but real entropy loss |

### Why SHA-256 and not bcrypt/argon2

Deliberate, and worth stating because it looks wrong at a glance. These are not
passwords: each code is CSPRNG output, so there is no dictionary to run and brute
force is hopeless regardless of hash speed. A slow KDF would add latency to a
rate-limited recovery flow and buy nothing. Human-chosen secrets would need the
opposite decision.

### When the user sees them

At **enrolment**, in the `verify` response — the one moment the user is present,
expecting a security step, and not yet locked out. Asking them to opt in later
means the people who most need codes are the ones who never generate them.

That response, and `regenerate-recovery`, are the **only** places plaintext codes
appear. `GET /api/security/mfa` returns `recoveryCodesRemaining` — a count, never
the codes or their hashes.

## UI

- Enrolment shows the codes once, in a dialog whose copy says they cannot be
  shown again, with a **Copy all codes** button.
- The disable dialog now collects a code. Its field accepts both shapes, so there
  is no digits-only filter — a recovery code is letters and a dash.
- "Recovery codes" reports how many remain and says plainly that we hold only
  hashes and cannot reshow them.
- One error message for both failure modes. "That TOTP code is wrong but recovery
  codes exist" would tell an attacker which factor to work on.

## Tests

- `lib/__tests__/mfaRecovery.spec.ts` — 23 behavioural tests: generation,
  distinctness, alphabet, hash-only storage, domain separation, normalisation
  (case/dashes/whitespace), single use, replay refusal, exhaustion, a
  wrong-length stored hash not throwing, and a distribution check that would
  catch a modulo fold.
- `app/api/security/mfa/__tests__/mfaDisable.spec.ts` — 13 tests pinning the
  route's shape: proof verified *before* the state change, secret and codes
  cleared, one error message, count-only in `GET`, plaintext returned in exactly
  two places, hashes never swapped for plaintext.

## Limitations

- **No step-up re-authentication on other credential changes.** Disabling MFA is
  now protected; changing email or password is governed by whatever those routes
  already do, which was not part of this pass.
- **Sessions on other devices are not revoked when MFA changes.** `revokeSession`
  is per-`jti`. Industry practice is to invalidate every session on a credential
  change; that needs a per-user session epoch and is not implemented.
- **No hardware-key-only path.** `hardwareKeys` exists on the account and
  passkeys are implemented separately, but `verifySecondFactor` accepts TOTP and
  recovery codes only.
