# @furlpay/account-kit — STATUS: MOCK

**This package does not touch a blockchain.** Nothing in it deploys a contract,
submits a UserOperation, configures a paymaster, or places an on-chain escrow
hold. Read this before believing any value it returns.

## What it is

The intended *shape* of FurlPay's smart-account layer — Safe accounts from
passkey signers, paymaster configuration, and pre-authorisation escrow — with a
mock implementation so the surrounding lifecycle can be exercised without a
chain.

## What was wrong with it, and what changed (2026-09-13)

`deploySafe()` returned `deployed: true` for an address derived from a string
hash. Nothing had been deployed and nobody held keys to that address, but the
response was indistinguishable from a real deployment. Escrow ids came from
`Math.random()`, which AGENTS.md rule 6 forbids for anything security-relevant.

Fixed:

| Before | After |
| --- | --- |
| `deployed: true` | `deployed: false` — nothing was deployed |
| no mock marker | every result carries `mock: true` |
| live mode silently returned the same fake data | live mode (`mock: false`) **throws** `NotImplementedError` |
| `"esc_" + Math.random()` | `"esc_" + crypto.randomUUID()` |
| `pseudoAddress()` | `mockAddress()`, documented as never-deployed, never-fund-this |

The rule this follows is the repository's standing one: **fail visibly rather
than fabricate**. A mock that announces itself costs a caller one branch; a mock
that does not costs them a wrong belief about where their money is.

## What it would take to make this real

1. A bundler endpoint (Pimlico, Alchemy, or self-hosted) and an EntryPoint
   v0.7/v0.8 deployment on each target chain.
2. Safe v1.4.1 singleton + `SafeProxyFactory` addresses per chain, and real
   CREATE2 address prediction instead of `mockAddress()`.
3. The Safe passkey/WebAuthn signer module, so a passkey can actually authorise
   a UserOperation (today passkeys are used for *login*, not signing — see
   `docs/CUSTODY-DISCLOSURE.md`).
4. A deployed escrow contract, and bindings generated from its ABI rather than
   hand-written types.

Until all four exist, `mock: false` throws on purpose.

## Consumers

- `apps/web/src/app/api/wallets/route.ts` — constructs it with `mock: true` and
  labels its own response accordingly.
