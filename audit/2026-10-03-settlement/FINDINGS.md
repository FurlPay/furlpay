# Settlement security review: 2026-10-03

Machine-readable register: [`findings.json`](findings.json). Architecture, runbook and limits: [`docs/SETTLEMENT-CIRCUIT-BREAKER-RUNBOOK.md`](../../docs/SETTLEMENT-CIRCUIT-BREAKER-RUNBOOK.md).

**Sources.** Manual code review only. No Savant or CertiK report on FurlPay exists in the repository, so none is consolidated here. CertiK's public Liquid analysis is cited only as an external reference for FP-ELM-01. **This is not a clean audit.** It covers the EVM settlement path, ops emergency controls, the extension message boundary, and Elements exposure, nothing else.

## Severity matrix

| P0 | P1 | P2 | P3 | P4 | PN | Total |
|---|---|---|---|---|---|---|
| 0 | 0 | 1 | 7 | 3 | 1 | 12 |

No P0 or P1 found. The one P2 is a containment-control bypass. It's mitigated today only because production on-chain settlement is gated off (`ONCHAIN_SETTLEMENT_LIVE` / KMS); it would matter the moment settlement goes live.

## Register

| ID | Sev | Title | Status |
|---|---|---|---|
| FP-SET-01 | **P2** | Ops pause not enforced at the settlement boundary (TOCTOU, 4 unguarded callers) | fixed, pending deploy |
| FP-SET-02 | P3 | Control state fails open on store errors (settlement path) | fixed, pending deploy |
| FP-SET-03 | P3 | RPC chain id not verified before signing (viem local/KMS accounts) | fixed, pending deploy |
| FP-SET-04 | P3 | Success relied on receipt status alone | fixed, pending deploy |
| FP-SET-05 | P3 | No unresolved-settlement index or reorg re-check | fixed, pending deploy; reconciler not scheduled |
| FP-SET-08 | P3 | Gasless pending outcomes bypass the settlement store | open |
| FP-SET-10 | P3 | Rail-pause resume is single-operator, no step-up | open |
| FP-EXT-01 | P3 | Extension trusted content scripts for privileged messages | fixed (d138658), not published |
| FP-SET-07 | P4 | No USDC proxy-upgrade detection | open (hardening) |
| FP-SET-09 | P4 | One admin identity, so critical recovery is impossible | **founder decision** |
| FP-ELM-01 | P4 | Elements consensus bug: not in FurlPay's settlement path | not affected; partner check pending |
| FP-SET-06 | PN | Single-RPC deployments can't detect disagreement | awaiting prod env check |

## Settlement-specific summary
- **Finality and RPC trust:** chain id, head freshness, cross-provider head lag and hash agreement are now checked before every broadcast. One provider is reported as unverified, never as agreement (FP-SET-06).
- **Replay and duplicate payment:** already covered before this review by the single-use nonce claim (`kvSetNx`). The reconciler never re-sends.
- **Ledger reconciliation:** EIP-3009 settlement is non-custodial; nothing is posted to FurlPay's ledger on this path. Chain-vs-record consistency comes from receipt verification plus the reorg re-check.
- **Signers and relayers:** the breaker stops FurlPay broadcasting. It doesn't revoke the KMS key, and it can't stop third parties relaying a signed authorization (see the runbook, §7).
- **Circuit breaker:** implemented, durable, epoch-fenced and fail-closed. **Automatic halts are in shadow mode** until `SETTLEMENT_SAFETY_AUTOHALT=enforce` is set with approval.

## Retest
`apps/web`: `settlementSafety.spec.ts` 30/30, plus settler and x402 enforcement specs, 74/74 in total. `tsc --noEmit` with the project's TypeScript 5.5.3: 0 errors. Route-security scanner: clean. `routeManifest.spec.ts`: passes except for one route that isn't part of this change (`payouts/batch`, uncommitted work from another session). `apps/extension`: 228/228, tsc 0, `wxt build` OK. Mutation check: disabling the epoch fence fails the fence test.

## Residual risk
Everything marked open, PN, or pending deploy above. Nothing in this change is deployed, and production protection isn't claimed.
