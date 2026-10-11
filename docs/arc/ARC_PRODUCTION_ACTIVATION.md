# Arc mainnet activation gate

Arc becomes a live FurlPay rail when **every box below is ticked** — not when
the code compiles, not when the tests pass, and not when a testnet transaction
succeeds.

**Current state (2026-10-09): `access: "sandbox"`.** Boxes ticked below are
ticked by code and tests in this repository plus read-only checks against Arc —
**not** by a transaction. No FurlPay transaction has been sent on Arc testnet or
mainnet, no KMS key is provisioned, and the deployment, audit and last-box items
are open. Ticked ≠ live.

---

## Why a checklist instead of a flag

`ARC_RAIL_LIVE` and `ARC_MAINNET_ACTIVATED` are two environment variables, and
an environment variable is a thing a tired person sets at 2am during an
incident. This file is what those variables are supposed to *mean*. Setting them
without the boxes below is not a shortcut to being live; it is a way to be
wrong about being live.

The capability registry (`packages/control-plane/src/capability.ts`) is the
machine-readable half of this. It must not say `access: "live"` until this
document says so.

---

## The gate

### Deployment
- [ ] FurlPay contracts deployed to **Arc testnet** (if any are required — see
      "Do we even need a contract?" below)
- [ ] `deployments/arc-testnet.json` written with real address, tx hash, block,
      bytecode hash, constructor args, git commit, chain id, timestamp
- [ ] Deployed bytecode checked with `eth_getCode` against the intended artifact
      — an address in config is not evidence that the right code is at it
- [ ] Source verified on the Arc explorer
- [ ] The same, repeated for **Arc mainnet**

### Signer
- [x] `arcSigner()` returns a KMS-backed signer — code only (`36e2b149`):
      `createKmsAccount({keyId:"furlpay-settlement", purpose:"settlement"})`;
      `null` without a KMS. **The key itself is not provisioned.**
- [x] The signing key is held in the same KMS the x402 settler requires
      (`lib/kmsAccount.ts`, purpose `settlement`)
- [x] No raw-key fallback exists on the Arc path — `arcSigner.spec.ts`
      "is null without a KMS — there is no raw-key path"
- [x] Signer failure fails closed: without a signer the rail is never
      registered, so `railAdapterFor("arc_usdc_transfer")` is `null` (tested)

### Network configuration
- [x] `rpc.mainnet.arc.io` independently verified to be Arc mainnet
      (2026-10-09, `ARC_DEPENDENCIES.md` §1). Setting `ARC_RPC_URL` in the
      hosted environment is still an ops step.
- [ ] Secondary RPC configured — **failover is code-complete and tested**
      (`33ade752`, `proxyFailover.spec.ts`, `rpcFailover.spec.ts`); no second
      provider is configured (ARC-P5-001)
- [x] `eth_chainId` is proven per endpoint before use (`proveChain` in
      `lib/payments/merchant/rpc.ts`; the signer refuses a mismatch)
- [x] Finality read from Arc's own docs (ARC-Pn-003); deposit policy is
      1 confirmation with bounded finality
- [ ] `ARC_RECEIPT_TIMEOUT_MS` reviewed against observed Arc block times

### USDC
- [x] `0x3600…0000` has code on Arc mainnet (1,798 bytes) and answers the
      ERC-20 interface (approve/allowance/transferFrom simulated, ARC-Pn-002)
- [x] The 18/6 split re-confirmed on mainnet 2026-10-09: 477 of 477 ERC-20
      Transfer logs paired with a system-emitter log at exactly 10¹²
- [ ] A read-only `balanceOf` against the production signer address returns a
      plausible value

### Correctness, proven not assumed
- [ ] Authorization → execution path tested end to end on testnet
- [ ] Idempotency: the same authorization retried produces **one** transfer
- [ ] Crash recovery: process killed after submission, recovered from the hash
- [ ] Reconciliation compares FurlPay state against Arc on-chain state and
      reports discrepancies
- [x] The **dual Transfer emitter** is handled in collection and
      reconciliation, and native-only sends are credited (`e82e7f0f`;
      `arcCollection.spec.ts`: credited once, never twice; dust held)
- [ ] Nonce management tested with concurrent submissions from multiple workers

### Security
- [ ] Contracts reviewed. **Nothing in `packages/contracts/` has been audited.**
      Do not tick this because tests pass
- [ ] Gas ceiling (`ARC_GAS_CEILING`, 200k) validated against observed mainnet
      gas for an ERC-20 transfer
- [ ] Wrong-chain, amount-substitution, recipient-substitution and replay
      attacks re-run against the production configuration
- [ ] Agent blast radius re-measured with Arc reachable

### Operations
- [x] Arc chain health exposed separately (`0654d326`): head age, height and
      per-endpoint state in the operations console; stale head or unreachable
      RPC raises a fingerprinted alert (`faa83c5f`)
- [ ] Arc metrics emitting (submissions, settlements, indeterminate, gas cost,
      RPC latency, reconciliation discrepancies)
- [ ] Alerting on `INDETERMINATE` — that state means money may be in flight
      with an unknown outcome and it is the one a human must see
- [ ] Runbook written for: RPC outage, signer outage, stuck transaction,
      reconciliation mismatch

### The last box
- [ ] **One controlled real-value transaction observed on Arc mainnet**, its
      receipt independently verified on the Arc explorer by someone who did not
      run the code, and its evidence record produced

**Only then** may `capability.ts` say `access: "live"`.

---

## Do we even need a contract on Arc?

Worth asking before deploying anything, because `packages/contracts/` contains
ten Solidity files and "it exists" is not a reason to deploy it.

A simple FurlPay USDC payment on Arc is an **ERC-20 `transfer`** to the
recipient. That needs **no FurlPay contract at all** — the adapter calls USDC
directly. The contracts earn their place only if FurlPay needs on-chain escrow
(`FurlPayEscrow`), on-chain policy attestation (`ComplianceEscrow`,
`AttestationRegistry`) or x402 facilitation on Arc (`X402Facilitator`).

**Recommendation: ship the plain ERC-20 path first.** It is the shortest route
to a genuine Arc payment, it has the smallest attack surface, and it needs no
audit. Deploy contracts when a product requirement demands them, not to make the
integration look more substantial.

---

## What is NOT on this list, deliberately

**Circle Paymaster.** Paymaster lets a user pay gas in USDC on a chain whose gas
is not USDC. On Arc, gas *is* USDC. It is architecturally redundant here, and
Circle's own Paymaster supported-chain list does not include Arc. Recorded as
`UNSUPPORTED_OR_UNNECESSARY_ON_ARC` rather than as a gap.

**CCTP on Arc.** A separate gate. CCTP is how USDC *arrives* on Arc from another
chain; this document is about FurlPay *paying* on Arc. They share a signer and
nothing else. CCTP has its own additional requirement: **Arc rejects CCTP V1
selectors** — only V2 works (`circlefin/arc-node` #110). The mainnet and testnet
CCTP V2 addresses were verified on-chain on 2026-10-09 (`ARC_DEPENDENCIES.md`
§3); a round trip has not been executed.
