# Arc mainnet activation gate

Arc becomes a live FurlPay rail when **every box below is ticked** — not when
the code compiles, not when the tests pass, and not when a testnet transaction
succeeds.

**Current state: `access: "sandbox"`. Zero boxes ticked. Arc has never been
contacted from this repository.**

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
- [ ] `arcSigner()` returns a real KMS-backed signer (today: returns `null`)
- [ ] The signing key is held in the same KMS the x402 settler requires — Arc
      does not get a weaker signing story than the rail that already exists
- [ ] No raw-key fallback exists on the Arc path, in any environment
- [ ] Signer failure is proven to fail closed (rail unregisters → 503)

### Network configuration
- [ ] `ARC_RPC_URL` set to an endpoint **independently verified** to be Arc
      mainnet. The mainnet RPC constant in this repository is **NOT verified** —
      see `ARC_DEPENDENCIES.md` §1
- [ ] Secondary RPC configured and failover tested
- [ ] `eth_chainId` returns **5042** from every configured endpoint
- [ ] Arc's documented finality behaviour read from Circle's own material, and
      `ARC_CONFIRMATIONS` set from it. **Do not inherit "instant finality" from
      a launch blog** — see `ARC_DEPENDENCIES.md` §4
- [ ] `ARC_RECEIPT_TIMEOUT_MS` reviewed against observed Arc block times

### USDC
- [ ] `ARC_USDC_ERC20` (`0x3600…0000`) confirmed against Circle's own Arc
      documentation for **mainnet**
- [ ] The 18-decimal native / 6-decimal ERC-20 split re-confirmed on mainnet —
      a chain upgrade that changed it would be silent and cost a factor of 10¹²
- [ ] A read-only `balanceOf` against the production signer address returns a
      plausible value

### Correctness, proven not assumed
- [ ] Authorization → execution path tested end to end on testnet
- [ ] Idempotency: the same authorization retried produces **one** transfer
- [ ] Crash recovery: process killed after submission, recovered from the hash
- [ ] Reconciliation compares FurlPay state against Arc on-chain state and
      reports discrepancies
- [ ] The **dual Transfer emitter** is handled in reconciliation — a single
      ERC-20 transfer emits two logs (18dp system + 6dp ERC-20) and counting
      both double-counts every payment
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
- [ ] Arc rail health exposed separately from FurlPay overall health — an Arc
      RPC outage must not take the control plane down
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
selectors** — only V2 works (`circlefin/arc-node` #110) — and the CCTP contract
addresses currently recorded in `ARC_DEPENDENCIES.md` §3 describe **testnet**
and must be re-read from Circle's official reference before mainnet.
