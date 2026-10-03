# Settlement circuit breaker: architecture, runbook, limits

Status as of 2026-10-03: **implemented and unit-tested. Not deployed. Automatic halts run in SHADOW mode by default.** Shadow mode records what it *would* have halted and halts nothing. It is observation, not protection.

Code: `apps/web/src/lib/settlementSafety.ts` (state machine), `settlementDetectors.ts` (checks), `settlementGuard.ts` (the settler's two calls), `settlementReconcile.ts`, `app/api/ops/settlement-safety/route.ts`. Tests: `lib/__tests__/settlementSafety.spec.ts`.

## 1. What actually settles (verified 2026-10-03)

FurlPay has **one** irreversible on-chain execution boundary for EVM settlement:

```
/api/x402/facilitator/settle ─┐
/api/account/fund ────────────┤
lib/x402.ts (paywall) ────────┼─> x402Facilitator.settle() / defaultSettler()
lib/mpp.ts ───────────────────┤      └─> x402Settler.createEvmSettler()
/api/transfers/gasless ───────┘            ├─ beforeBroadcast(network)    <- NEW
                                           ├─ walletClient.writeContract(transferWithAuthorization)
                                           ├─ waitForTransactionReceipt(minConfirmations)
                                           └─ afterReceipt(logs, expected) <- NEW
```

- **What moves:** EIP-3009 `transferWithAuthorization`. Payer funds go directly to the payee, and FurlPay's fee-payer pays only gas. FurlPay never custodies the transferred funds on this path.
- **Signer:** KMS account (`FURLPAY_KMS_PROVIDER` + `FACILITATOR_EVM_ADDRESS`). A raw key is refused in production.
- **Pre-existing controls:** `ONCHAIN_SETTLEMENT_LIVE` flag (off by default outside dev), asset allowlist re-checked at signing, bounded gas, canonical amount parsing, single-use nonce claim (`kvSetNx`) blocking duplicate settlement, amount-scaled confirmation depth, replacement tracking.
- **There is no peg-out and no bridge in FurlPay's execution path.** "Peg-out" appears only in `chaintracker/`, a read-only intel bot that observes Liquid peg-outs through Blockstream's public Esplora API.

## 2. The Elements issue

**What it is.** On 2026-09-06 at 13:53 UTC (Liquid block 4,050,336), an attacker exploited Elements' rangeproof/surjection-proof **validation cache**. The cache key omitted fields (Bug A, 2018). The later fix concatenated fields without length prefixes (Bug B), which allowed collisions. One transaction passed validation with outputs not backed by inputs, inflating supply by about 4,000 L-BTC. Through SideSwap's normal peg-out, about 4,000 BTC was released on Bitcoin mainnet at 14:28 UTC. Affected versions: **v0.14.1 through v23.3.3**. Fixed in **Elements v23.3.4**, released 2026-09-09; it adds a `-norangeproofcache` option. No CVE ID was stated in Blockstream's assessment, and none is assigned here.

**Does it affect FurlPay? No, as far as the repository shows:**
- No Elements node, RPC, library or Liquid asset exists in any settlement, signing, ledger or reconciliation path. `@furlpay/elements` is an unrelated UI widget package; the shared name is coincidental.
- `chaintracker/src/mempool/liquid/esplora.ts` reads Liquid data from a third party and never signs. During the incident window its peg-out observations would have included unbacked L-BTC flows. That's a data-quality issue in an intel feed, not a funds risk.
- **Unknown, needs external confirmation:** whether any FurlPay partner (ramp, OTC desk, treasury counterparty) accepts L-BTC. If one does, the exposure sits with them and FurlPay can't stop it.

No Elements dependency was added.

## 3. State machine

| State | Settlement | Entered by | Leaves by |
|---|---|---|---|
| NORMAL | allowed (if checks pass) | approved recovery; `clearDegraded` | any trip |
| DEGRADED | **blocked** | a "degrade" finding (data needed to prove safety is missing) | monitor clears it when the signal passes (the only automatic return), or escalation to HALTED |
| HALTED | **blocked** | a "halt" finding, manual halt, reorg | `mitigate` → RECOVERY_PENDING |
| RECOVERY_PENDING | **blocked** | `mitigate` with passing checks | enough approvals → NORMAL; any new trip → HALTED |

**Scopes:** `global`, and `network:<name>`. The settler checks both. Nothing narrower exists, because every settlement on a network shares one fee-payer key and one RPC trust root, so they can't be isolated from each other.

**Durability:** state lives in Redis (`settle:safety:state:<scope>`), and history in `settle:safety:history` (last 500 transitions).

**Epoch fence:** every trip increments `settle:safety:epoch:<scope>` *before* writing state. NORMAL counts only if it was written at the current epoch. A resume racing a new trip can't clear that trip, and a lost write reads as HALTED.

**Fail-closed:** if the state, the epoch, the ops global pause, or the velocity counter can't be read, settlement is refused. In production the in-memory KV fallback is refused by `lib/kv.ts`, so a missing Redis config also means refusal.

## 4. Detectors

| Signal | Source / trust | Threshold | Action | Recovery |
|---|---|---|---|---|
| `chain_id_mismatch` | `eth_chainId` from each provider | ≠ `EVM_CHAIN_IDS` | halt (critical) | fix RPC config; human approval |
| `rpc_hash_disagreement` | block hash at a common height (min head - 5), per provider | any difference | halt (critical) | identify the forked/lying provider |
| `rpc_unavailable` | all providers fail | n/a | degrade | providers answer |
| `head_stale` | newest head timestamp | `SETTLEMENT_MAX_HEAD_AGE_S`, default 120s | degrade | chain advances |
| `rpc_head_divergence` | head heights | `SETTLEMENT_MAX_PROVIDER_LAG_BLOCKS`, default 50 | degrade | providers converge |
| `rpc_unverified` | only one provider configured | n/a | report only | configure `<NET>_RPC_URL_FALLBACK` |
| `receipt_mismatch` | confirmed receipt logs from the pinned token | not exactly one Transfer(from,to,value) plus AuthorizationUsed(from,nonce) | halt (critical); tx recorded **pending**, never success | human reconciles the tx |
| `settlement_reorged` | reconciler re-reads receipts confirmed in the last 24h | receipt missing or reverted | halt (critical) | human reconciles each tx |
| `settlement_velocity` | count per network per hour | `SETTLEMENT_MAX_PER_HOUR`; **off unless set** (no history to derive it from) | halt (high) | review traffic |
| `manual_halt` | operator | n/a | halt (critical by default, or high) | approvals |

A healthy probe result is cached for 10s per instance. Unhealthy results are never cached.

### Deliberately not implemented (no observable signal in this architecture)
Bridge-message reconciliation (there's no bridge). Ledger-vs-chain balance comparison on this path (EIP-3009 is non-custodial; nothing is posted to FurlPay's ledger). Contract-admin-change detection for USDC (possible: watch the FiatToken proxy `Upgraded` event. Tracked as finding FP-SET-07).

## 5. Recovery

Recovery is `POST /api/ops/settlement-safety` and requires the ops admin role.
1. `{action:"mitigate", scope, incidentId, notes}`: needs a fresh step-up. Chain health and reconciliation are **re-run server-side**. Unhealthy checks, or any unresolved settlement, block the move to RECOVERY_PENDING.
2. `{action:"approve", scope, incidentId, evidence}`: needs a fresh step-up, which this action consumes. Checks re-run on every approval. Approvals:
   - are bound to the incident and epoch (a new trip discards them);
   - expire after 30 minutes;
   - count each distinct approver once;
   - **critical needs 2 approvers, one of whom isn't the mitigator**; high needs 1. `SETTLEMENT_RECOVERY_MIN_APPROVERS` can raise these floors, never lower them.
3. There's no force or override action. The only path to NORMAL is step 2.

> **Founder decision required.** Only one account can hold the admin role (`FURLPAY_ADMIN_EMAIL`, `lib/authz.ts`). With one admin, a **critical** incident can't be resumed. This is intentional: it fails closed. Resolving it means a second admin identity, or an explicit decision to accept single-operator recovery, which is not implemented.

## 6. Runbook

**Every incident:** `GET /api/ops/settlement-safety` shows state, incident ID, signal, evidence and history. Before acting, write down the incident ID and the list of unresolved transactions.

- **Suspected consensus issue (any chain):** manual halt on `network:<net>`, or `global` if the signer or multiple chains are involved. Compare a block explorer with every configured RPC. Don't mitigate until the chain's own operators have published guidance and your providers agree.
- **RPC disagreement or reorg:** identify which provider differs (evidence lists provider indexes, never URLs). Rotate it out of `<NET>_RPC_URL`/`_FALLBACK`, redeploy, and confirm `findings` is empty in the mitigate response. For `settlement_reorged`, re-check every listed tx against a third source. A tx that vanished means the payee wasn't paid, and the resource was released anyway. That's a customer-impact review, **never an automatic re-send**.
- **Unexpected withdrawal or receipt behavior (`receipt_mismatch`):** treat the token contract as suspect. Check the USDC proxy implementation address against Circle's published one. Keep the scope halted until it's explained.
- **Reconciliation mismatch:** every pending or abandoned tx must be resolved by a human, either confirmed via `GET /api/x402/settlement/[tx]` or written off with a note. Recovery is impossible while any remain.
- **Signer or relayer compromise:** global halt. Then **outside this system:** disable the KMS key (AWS KMS `DisableKey`) and drain the fee-payer's gas balance to cold storage. The breaker stops FurlPay from broadcasting. It does not revoke the key.
- **Recovery and post-incident review:** record root cause, evidence, approvers and policy version (all stored on the record). Add a detector or test for anything that should have been caught.

## 7. What this cannot stop
- A transaction already broadcast. There's a residual window of milliseconds between the gate's read and `writeContract`; the epoch fence guarantees nothing *after* it gets through.
- **Someone else relaying a payer's signed EIP-3009 authorization.** It's a bearer instrument on-chain until `validBefore`. FurlPay halting doesn't invalidate it.
- A single RPC provider that lies consistently (chain ID, heads and receipts all agree with itself). Configure a second, independent provider.
- External systems: Circle (USDC freeze/pause), CCTP, ramp partners, and LI.FI routes run outside this gate. LI.FI/CCTP are user-signed and use the route-level rail pauses only.
- Rail pauses (`/api/ops/controls`, scope `rail`) still stop only the routes that check them. The **global** pause and this breaker are enforced in the settler.

## 8. Rollout
1. Merge. Default is shadow mode, so behavior changes only through request-level refusals (wrong chain, unreadable state, all RPCs down, stale head). Those are correctness fixes, not a policy change.
2. Configure a second RPC per settlement network (`ARBITRUM_RPC_URL_FALLBACK`).
3. Watch `history` for `shadow:` entries against real traffic. Tune `SETTLEMENT_MAX_HEAD_AGE_S`. For local hardhat (docs/GO-LIVE-MONEY.md §3a), set a large value, since an idle automine node's head is stale by design.
4. Drill on staging: manual halt → mitigate → approve, with two operators.
5. **With founder approval:** `SETTLEMENT_SAFETY_AUTOHALT=enforce`.
6. Only after there's traffic history: set `SETTLEMENT_MAX_PER_HOUR`.

No database migration is required: state lives in the existing Upstash Redis. Rollback is reverting the commit. Any persisted halt keys (`settle:safety:*`) become inert, and you can delete them deliberately.

## Test matrix (`settlementSafety.spec.ts`)
1 normal ✓ · 2 wrong chain ✓ · 3 hash disagreement ✓ · 4 stale ✓ · 5 confirmation depth (reconciler) ✓ · 6 reorg ✓ · 7 duplicate instruction: covered by the existing nonce claim (`x402Facilitator`, `kvSetNx`) · 8 receipt conflict ✓ · 9 ledger vs chain: N/A on this non-custodial path; 8 and 6 cover chain-vs-record · 10 halt mid-flight ✓ · 11 queued retry ✓ · 12 restart ✓ · 13 conflicting transitions ✓ (x2) · 14 unauthorized operator: `requireOpsAdmin` on the route (not unit-tested here) · 15 single approver ✓ · 16 stale/replayed approval ✓ · 17 unresolved after recovery ✓ · 18 new anomaly in recovery ✓ · 19 alert failure ✓ · 20 control-plane failure ✓
