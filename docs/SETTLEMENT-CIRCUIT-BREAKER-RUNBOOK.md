# Settlement circuit breaker: architecture, procedures, limits

**Status, 2026-10-03:**
- **Implemented and tested. Not deployed.** Production runs `ea2ee50`, which predates all of this.
- **Automatic halts default to SHADOW mode.** Shadow mode records what it *would* halt and halts nothing. It is observation, not protection.
- **Production has no admin account** (`FURLPAY_ADMIN_EMAIL` unset), so the operator procedures below can't be carried out in production until that's fixed (finding FP-SET-09).

Legend: **[impl]** implemented in code, **[manual]** an operator step, **[proposed]** not built, **[assumption]** unverified.

Code (`apps/web/src/`):
- `lib/settlementSafety.ts`: state machine
- `lib/settlementDetectors.ts`: chain/RPC/receipt checks
- `lib/settlementGuard.ts`: pre/post-broadcast gates
- `lib/settlementTokenMonitor.ts`: token integrity
- `lib/settlementReconcile.ts`: reconciler
- `lib/settlementSweep.ts`: scheduled pass
- `app/api/ops/settlement-safety`: operator API
- `app/api/cron/settlement-safety`: scheduler entry

Tests: `lib/__tests__/settlementSafety.spec.ts`, `settlementHardening.spec.ts`, `settlementPaths.spec.ts`.

## 1. Money paths (verified 2026-10-03)

```
x402 facilitator ─┐
account funding ──┤
x402 paywall ─────┼─> createEvmSettler()  [KMS signer]
MPP ──────────────┤     beforeBroadcast ─> writeContract ─> receipt ─> afterReceipt
gasless ──────────┘
PolicyWrapper settle / tranche ─┐
escrow release / refund ────────┴─> complianceGuard  [relayer key; refused in production]
                                     assertMoneyWriteAllowed ─> beforeBroadcast ─> writeContract
```

- **[impl]** Every path above passes `beforeBroadcast`: chain health, velocity cap, the ops global pause, then the durable breaker state, failing closed.
- **[impl]** Settler paths also pass `afterReceipt`, which accepts exactly one authorized Transfer plus AuthorizationUsed. A mismatch surfaces as pending, never as settled. All five settler callers write the settlement store, so reconciliation sees them.
- **[impl]** PolicyWrapper/escrow writes need `ONCHAIN_SETTLEMENT_LIVE` outside development. A raw relayer key is refused in production.
- Their receipts are **not** event-verified, because the wrapper has a different event surface. That's a residual gap.
- **Outside the breaker, by design:** user-signed relays (`/api/chain/rpc` `eth_sendRawTransaction`) and `/api/mpc/sign`, which returns signatures and doesn't broadcast. Users' own keys and funds are not FurlPay's to gate.
- **No peg-out and no bridge exist in FurlPay.** "Peg-out" appears only in `chaintracker/`, a read-only Liquid intel feed.

## 2. The Elements issue
On 2026-09-06 at 13:53 UTC, Liquid block 4,050,336, an ambiguous key in Elements' rangeproof/surjection-proof validation cache let an attacker mint about 4,000 unbacked L-BTC. About 4,000 BTC left through a normal peg-out. Affected versions are v0.14.1 through v23.3.3; it's fixed in v23.3.4 (2026-09-09). No CVE ID was stated (source: Blockstream's incident assessment).

FurlPay runs no Elements node and holds no Liquid asset in any money path. `@furlpay/elements` is an unrelated UI package. **[assumption]** No partner accepts L-BTC on FurlPay's behalf; the founder should confirm this.

## 3. State machine [impl]

| State | Settlement | Entered by | Leaves by |
|---|---|---|---|
| NORMAL | allowed if checks pass | approved recovery; clean sweep from DEGRADED | any trip |
| DEGRADED | **blocked** | a "degrade" finding | a clean sweep (the only automatic return), or escalation to HALTED |
| HALTED | **blocked** | a "halt" finding, manual halt, reorg | mitigate → RECOVERY_PENDING |
| RECOVERY_PENDING | **blocked** | mitigate with passing checks | enough approvals → NORMAL; any trip → HALTED |

- **Scopes:** `global` and `network:<name>`.
- **Storage:** Redis.
- **Epoch fence:** every trip increments the epoch *before* writing state, and NORMAL counts only at the current epoch.
- **Fail closed:** any read failure refuses settlement.

## 4. Detectors [impl]

| Signal | Source | Threshold | Action |
|---|---|---|---|
| `chain_id_mismatch` | each RPC's `eth_chainId` | ≠ expected | halt |
| `rpc_hash_disagreement` | block hash at a common height | any difference | halt |
| `rpc_unavailable` / `head_stale` / `rpc_head_divergence` | probes | all down / `SETTLEMENT_MAX_HEAD_AGE_S` (120) / `SETTLEMENT_MAX_PROVIDER_LAG_BLOCKS` (50) | degrade |
| `rpc_unverified` | one provider configured | n/a | report |
| `rpc_not_independent` | two configured URLs share a domain (hostnames only; URLs never logged) | n/a | report |
| `receipt_mismatch` | confirmed receipt logs | not exactly the authorized transfer | halt |
| `settlement_reorged` | reconciler re-reads 24h of confirmations | receipt gone or reverted | halt |
| `settlement_velocity` | per network per hour | `SETTLEMENT_MAX_PER_HOUR` (off unless set) | halt |
| `token_implementation_changed` / `token_admin_changed` | ZeppelinOS proxy slots vs pins | any change | halt (critical) |
| `token_owner_changed` | `owner()` vs pin | any change | halt (high) |
| `token_paused` / `token_monitor_unavailable` | `paused()`; any unreadable field | true / unreadable | degrade |

**Token pins.** Read on-chain on 2026-10-03 for USDC on Arbitrum, Base and Polygon, and XSGD on Arbitrum. All four use the ZeppelinOS `AdminUpgradeabilityProxy` slots; their EIP-1967 slots are empty. A test fails if an allowlisted mainnet asset has no pin. **A legitimate issuer upgrade halts that network.** That's intentional; see §6.5.

**Disagreement doesn't prove which provider is right.** A halt on disagreement means "we can't tell", never "provider A is correct".

## 5. Recovery [impl]

Endpoint: `POST /api/ops/settlement-safety`. Every action needs the ops admin role.

| Action | Requires | Effect |
|---|---|---|
| `{action:"halt", scope, reason, severity?}` | no step-up (halting must be fast) | manual halt |
| `{action:"mitigate", scope, incidentId, notes}` | a step-up claimed atomically (one step-up = one action). Chain health, token integrity and reconciliation re-run server-side and must pass with zero unresolved settlements | HALTED → RECOVERY_PENDING |
| `{action:"approve", scope, incidentId, evidence}` | the same step-up claim and checks | records an approval |

Approval rules:
- Approvals are bound to the incident and epoch, and expire after 30 minutes.
- **Critical incidents need 2 distinct approvers, one of whom isn't the mitigator.** High needs 1.
- `SETTLEMENT_RECOVERY_MIN_APPROVERS` only raises these floors.
- There's no override.

Resuming a *rail/global ops pause* (`/api/ops/controls`, `paused:false`) now also needs an atomic step-up claim.

> **Second approver (FP-SET-09) [impl].** `SETTLEMENT_RECOVERY_APPROVER_EMAILS` lists up to 5 accounts that may **only** read breaker state and `approve`. They can't halt, mitigate, or reach any other admin route.
>
> They still need:
> - a non-guest session;
> - an atomic step-up claim on each approval;
> - to be a different user from the mitigator and from the other approvers.
>
> The `compliance_officer` role grant couldn't serve here, because issuing it needs two admins. With the list unset there are no extra approvers, and critical recovery stays fail-closed.
>
> **[manual, founder]** In production, set:
> 1. `FURLPAY_ADMIN_EMAIL`. Today *nobody* can halt, pause, resume or recover through the API.
> 2. `SETTLEMENT_RECOVERY_APPROVER_EMAILS` to a **different person's** account.
>
> Until both are set, the env kill switch (`FURLPAY_MONEY_KILL_SWITCH`, which needs a redeploy) and automatic halts in enforce mode remain the only controls.

## 6. Procedures

### 6.1 Enable shadow mode
**[manual]** Shadow is the default: deploy with `SETTLEMENT_SAFETY_AUTOHALT` unset. Then confirm that `GET /api/ops/settlement-safety` reports `"mode":"shadow"`, and that `GET /api/cron/settlement-safety` (with the cron secret) returns `outcome.status` ok. Watch the transition history for `shadow:` entries for at least a week of real traffic.

### 6.2 Staging drill (two operators, A and B)
**[manual]**
1. Set `FURLPAY_ENV=staging` and use a testnet network.
2. A: manual halt on `network:arbitrum-sepolia`. Verify a test payment returns `settlement_halted` (503 or 402) and nothing is broadcast.
3. A: step-up, then `mitigate`, which should be refused while checks fail. Fix the cause, then mitigate again.
4. A: `approve` → `awaiting_approvals`.
5. B: step-up, then `approve` → NORMAL. A test payment now settles.
6. Repeat with a second trip landing between 4 and 5. The approval must fail (`epoch_moved` or incident mismatch).
7. Make Redis unavailable (bad token in staging): settlement must refuse with `control_plane`.

### 6.3 Enable automatic halts
**[manual, needs founder approval]** Only after 6.2 passes and the shadow history shows no false positives you'd act on. Set `SETTLEMENT_SAFETY_AUTOHALT=enforce` and redeploy. **Rollback:** unset it and redeploy. Existing halts stay until recovered; they are never auto-cleared by a mode change.

### 6.4 Investigate an incident
`GET /api/ops/settlement-safety` shows scope, state, incident ID, signal, evidence and history. Evidence lists provider *indexes*, never URLs.
- **Chain/RPC:** compare every configured provider with a block explorer. Rotate out the odd one; don't pick a winner from the disagreement itself.
- **`receipt_mismatch` / token change:** compare the token's implementation and admin with the issuer's published addresses.
- **Signer compromise:** global halt, then **outside this system:** disable the KMS key and drain the fee-payer's gas.

### 6.5 A token upgrade halt
Check the new implementation against the issuer's announcement. Update the pin in `settlementTokenMonitor.ts` in a reviewed commit and deploy. Then mitigate and approve.

### 6.6 Unresolved settlements
Recovery is impossible while any exist. For each one, check `GET /api/x402/settlement/[tx]` and an explorer:
- **Confirmed:** the next sweep or recovery check moves it to confirmed.
- **Never landed:** it becomes `abandoned` after 30 minutes. A human records the customer impact.

**Never re-send.** The payer re-signs with a fresh nonce if a new payment is wanted. A `settlement_reorged` tx keeps its "confirmed" record; treat it as a payee who wasn't paid.

### 6.7 Restore service
Mitigate (with notes) → approvals → confirm with a testnet or minimal payment → write the post-incident review: cause, evidence, approvers, policy version, and the detector or test that should have caught it.

## 7. Limits (operational, not code defects)
- **Broadcast race:** a halt written between the gate's read and `writeContract` doesn't stop that one transaction. The window is one KV round trip. The epoch fence guarantees nothing *after* it. An external broadcast can't be made atomic with a KV read.
- **Third-party relay:** a payer's signed EIP-3009 authorization is a bearer instrument until `validBefore`. FurlPay halting doesn't stop someone else submitting it.
- **A consistently lying single RPC** can't be detected. Configure two independent providers (FP-SET-06).
- **Detection latency** of the sweep equals its cadence. The Vercel cron runs daily (`vercel.json`). **[proposed]** an external scheduler calling `/api/cron/settlement-safety` with `FURLPAY_CRON_SECRET` every few minutes; it needs approval.
- **External systems** run outside this gate: Circle (pause/blacklist), CCTP, LI.FI, ramps. Rail pauses (`scope: rail`) stop only the routes that check them.

## 8. Deployment checklist
1. **[manual]** Merge `fix/settlement-hardening` (CI on the PR must pass).
2. **[manual]** `npm run deploy:prod` from a clean tree. Default shadow mode means behavior changes only through request-level refusals: wrong chain, unreadable state, all RPCs down, stale head, a halted gate.
3. **[manual]** Verify: production SHA equals the merge commit; `GET /api/health` is OK; the cron route returns 503 without its secret and ok with it; the ops route reports `mode: shadow`.
4. **[manual, founder]** Set `FURLPAY_ADMIN_EMAIL`. Before enabling settlement, also set `ARBITRUM_RPC_URL` and `ARBITRUM_RPC_URL_FALLBACK` from two different providers.
5. Then 6.1 → 6.2 → 6.3.

No database migration is required: state lives in the existing Upstash Redis. Rollback is reverting the commit. Persisted `settle:safety:*` keys become inert.

## Test matrix
1 normal ✓ · 2 wrong chain ✓ · 3 hash disagreement ✓ · 4 stale ✓ · 5 confirmation depth ✓ · 6 reorg ✓ · 7 duplicate instruction: existing nonce claim · 8 receipt conflict ✓ · 9 ledger vs chain: N/A (non-custodial path) · 10 halt mid-flight ✓ · 11 queued retry ✓ · 12 restart ✓ · 13 conflicting transitions ✓ · 14 unauthorized operator: `requireOpsAdmin` · 15 single approver ✓ · 16 stale/replayed approval ✓ · 17 unresolved after recovery ✓ · 18 new anomaly in recovery ✓ · 19 alert failure ✓ · 20 control-plane failure ✓

Round 2 adds: gasless confirmed, pending and halted ✓ · compliance-guard gate + production key refusal ✓ · token pins and every policy ✓ · sweep clears only DEGRADED, halts on token change, honors shadow, reconciles, respects its budget ✓ · concurrent step-up claims ✓ · RPC independence without leaking URLs ✓
