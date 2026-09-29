# FurlPay Release Readiness Matrix

_2026-09-29 · branch `release/production-2026-09-29` @ `a05ad10`. PASS = verified in this environment. BLOCKED = needs a tool/host/credential unavailable here. UNKNOWN = not verifiable. No BLOCKED/UNKNOWN is upgraded to PASS._

| Component | Source | Test | Build | Release artifact | Production | Store |
|---|---|---|---|---|---|---|
| **Backend/Web** | PASS | PASS (5596 web + 307 CP + root pkgs) | see final report | Vercel deploy | LIVE (200/401) | n/a |
| **Database** | PASS (0001–0021) | PASS (schema/RLS tests) | n/a | migrations | **UNKNOWN** (no creds) | n/a |
| **Control plane / payments** | PASS | PASS (307 + 88) | PASS (pkg) | in web | gated (rail 503) | n/a |
| **Chrome Extension** | PASS | (tsc PASS) | **PASS** | **furlpayextension-1.0.0-chrome.zip** | n/a | **BLOCKED** (CWS auth+approval) |
| **Android (RN native-app v2.3.0)** | PASS | not run | **BLOCKED** (JDK 8; needs 17 + build) | — | — | **BLOCKED** |
| **Android (TWA v1.0.0)** | PASS | n/a | BLOCKED | — | — | deprecate (dup pkg id) |
| **iOS Guardian** | PASS | n/a | **BLOCKED** (no macOS/Xcode) | — | — | **BLOCKED** |
| **Wear OS (guardian)** | PASS | not run | **BLOCKED** (JDK 8; needs 17) | — | — | **BLOCKED** |
| **CI/CD** | PASS (14 workflows) | n/a | n/a | — | scheduled scans failing | n/a |
| **AWS** | PASS (Terraform) | **BLOCKED** (no terraform bin) | n/a | — | **UNKNOWN** (creds invalid) | n/a |
| **Security (app-layer)** | PASS | PASS (0 real route gaps) | n/a | — | — | full history gitleaks: not run |
| **Desktop** | early (v0.1.0) | n/a | excluded | — | — | n/a |

## Verified this session
- 5,596 web tests + 307 control-plane + root package suites (gateway/security/ledger/compliance) — **all green, 0 failures**.
- `tsc --noEmit` clean (apps/web, apps/extension).
- Chrome extension production build + zip produced (MV3, least-privilege, host scoped to furlpay.com).
- furlpay.com live (200); `/api/ops/health` auth-gated (401).
- Clean working tree; 16 logical commits + 3 Dependabot cherry-picks on the release branch.

## Blocked/unknown (honest)
- Web `next build` result — see final report (running at time of writing).
- Android/Wear builds — no JDK 17 (only JDK 8 present).
- iOS build — no macOS/Xcode.
- Prod DB migration state, AWS resources — no credentials.
- 6 Dependabot bumps (sharp/next/qs/…) — need re-apply via npm on the branch.
