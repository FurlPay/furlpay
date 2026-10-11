# 05 — Mobile security

| Finding | State at `0dce509b` |
|---|---|
| F-15 / F-16 placeholder freeRASP identity | Already fixed. Config comes from the build (`app.config.js` → `extra.freerasp`); a release build without `FURLPAY_FREERASP_CERT_HASHES` (Android) or a valid Team ID (iOS) fails. Hashes must be the Play App Signing SHA-256, supplied by an authorized maintainer as an EAS secret, never invented. |
| F-18 tamper-detection start failure | Already fixed: integrity becomes "unknown" and money moves require step-up. |
| F-17 / F-33 attestation | Blocked. The app reports `attestation: "not_configured"`; no server-side Play Integrity or App Attest verification exists. Needs a Google Cloud project, Apple configuration and device testing. |
| F-19 iOS token cache | Already fixed: `AppDelegate` evicts the cache on `protectedDataWillBecomeUnavailable`. |
| F-39 certificate pins | Informational: nine SPKI pins; a rotation plan is required before the pinned roots change. |

No mobile code changed in this pass.
