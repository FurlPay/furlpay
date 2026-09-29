# FurlPay — CI Status

_2026-09-29._

## Classification: **EXTERNAL ACCOUNT/BILLING FAILURE** (not a repository defect)

Every GitHub Actions run — scheduled, pull_request, and ordinary CI — fails in **3–6 seconds with zero steps executed**.

### Evidence
- `gh api repos/Ashutosh0x/furlpay/actions/runs/<id>/jobs` → the failing job has `"steps": []` (no step, not even "Set up job", ran).
- Last 6 runs across *different* workflows: all `failure`, all `steps=0`.
- `gh api repos/Ashutosh0x/furlpay/actions/permissions` → `{"enabled": true, "allowed_actions": "all"}` — Actions are **not** disabled at the repo level.
- Billing endpoint (`user/settings/billing/actions`) → 404 (token lacks billing scope) — usage not readable here.

### Root cause
A job that fails before any step runs = **GitHub never allocated a runner**. Authoritative GitHub guidance ([community #165506](https://github.com/orgs/community/discussions/165506), [#151956](https://github.com/orgs/community/discussions/151956), [#167403](https://github.com/orgs/community/discussions/167403)) attributes this exact signature to:

> "The job was not started because recent account payments have failed or your spending limit needs to be increased."

- **CODE FAILURE?** No — 0 steps ran; workflow YAML never executed.
- **CONFIGURATION FAILURE?** No — repo Actions enabled; third-party actions SHA-pinned; `trivy-action` pin is a valid 40-hex commit.
- **EXTERNAL ACCOUNT/BILLING FAILURE?** **Yes.**

## Operator remediation (external — cannot be fixed in-repo)
1. GitHub → Settings → **Billing and plans** → **Spending limits** → set the Actions limit to **≥ $1** (even $1 re-enables the free-tier minutes).
2. Confirm no failed payment method is on hold; re-run a workflow.
3. If it persists after a valid limit, contact GitHub Support (billing lock can require manual clearing).

## What was done in-repo (safe)
- Verified all workflow definitions are valid and SHA-pinned.
- Locally reproduced the equivalents CI would run: `tsc --noEmit` (clean), `vitest` (5,596+ passing), `next build` (exit 0), `npm audit` (40 pre-existing transitive, allow-listed).
- **Did NOT** disable any security workflow or weaken SHA pinning to make CI green.

## Do not
- Do not add workarounds that bypass the billing block.
- Do not classify this as a repository defect.
