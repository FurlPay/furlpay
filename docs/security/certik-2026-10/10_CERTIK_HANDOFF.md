# 10 — CertiK handoff

**Code under review:** branch `security/certik-remediation-oct11`, based on
`0dce509b` (PR #113, the production release candidate). Nothing on the branch
is deployed.

**Read first:** `01_FINDINGS_REGISTER.md` (all 42 findings, validated against
the code, with commits and tests), then `09_REMAINING_RISKS.md`.

**Changed in this pass:** AP2 single use and exact amounts (F-13, F-14);
streamed body bounds on every route (F-10, F-38); PolicyManager bound (F-6);
hosted-runtime session-secret refusal (F-7); bounded device signals (F-8);
mock MPC disabled in production (F-21); XSGD rate without a default (F-32);
labelled private-key redaction (F-42).

**Where independent depth is most useful:**
1. AP2 → x402 settlement end to end, including concurrent presentation and
   Redis failure modes.
2. The x402 facilitator and settlement path (`lib/x402.ts`,
   `X402Facilitator.sol`).
3. EVM contracts with Slither, fuzzing and invariant testing (not run here).
4. Webhook handlers' raw-body HMAC verification after the bounded-reader change.
5. Mobile attestation design once F-17/F-33 are implemented.

**Not claimed:** formal verification, CI evidence (Actions is billing-locked),
production MPC, server-side device attestation, or deployment of any change
listed here.
