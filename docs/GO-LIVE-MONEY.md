# Going live with real money movement

This is the runbook to take FurlPay from **simulated settlement** to **real
on-chain USDC/stablecoin movement**. It reflects the 2026 x402 "exact/evm"
scheme (Coinbase x402 spec) and EIP-3009 `transferWithAuthorization` gasless
settlement.

The code path is complete and gated. Flipping to live is a matter of
configuration + operational setup, not new code — with the two exceptions
called out under "Still requires external work".

## What runs the money path

```
resource server            facilitator                 chain
GET /api/x402/fx ──402──▶  buildRequirements()  (quote, HMAC-bound)
client signs EIP-3009 ──▶  verifyPayment()  ── x402Signature.verifyAuthorizationSignature()  (EIP-712 ecrecover)
                           ── x402Settler.defaultSettler()  ── transferWithAuthorization on-chain
                           ── waitForTransactionReceipt(confirmations)  ── receipt
```

- `lib/x402.ts` — resource-server helper (`verifyPayment`): quote binding,
  replay claim, **signature verification + real settlement in live mode**.
- `lib/x402Facilitator.ts` — the `/verify` + `/settle` service. `verify()` now
  recovers the EIP-3009 signer in live mode; `settle()` uses the real settler
  and **fails closed** (`settler_unavailable`) if none is configured.
- `lib/x402Signature.ts` — EIP-712 `TransferWithAuthorization` recovery (viem).
- `lib/x402Settler.ts` — the real on-chain settler: submits the authorization,
  waits for the confirmation depth the amount requires (Attack I-A), pays gas
  as the fee-payer.

Mock vs live is controlled by `INTEGRATION_MODE` (or `X402_ENFORCE_SIGNATURE=1`):
- **mock (default):** structural checks + deterministic hash. Zero credentials,
  full demo. No real money.
- **live:** signature is cryptographically verified AND a real settler must be
  present, or the payment is refused. No fake settlements can credit balance.

## Go-live checklist

### 1. Provision the fee-payer signing key
`FACILITATOR_EVM_PRIVATE_KEY` is a **hot** key that pays gas and submits every
settlement. It never holds user funds (EIP-3009 moves payer → payTo directly),
but it must be protected:
- Dedicated account, funded with **gas only** (a little ETH on Arbitrum), topped
  up from cold storage — never the treasury.
- Production: prefer a **KMS/HSM-backed signer** (AWS KMS, GCP KMS, Turnkey,
  Fireblocks) over a raw env key. viem supports custom accounts; swap
  `privateKeyToAccount` in `x402Settler.ts` for a KMS account when you adopt one.
- Set it **Sensitive** in Vercel, Production scope only.

### 2. Set the settlement env
| Var | Value |
| --- | --- |
| `INTEGRATION_MODE` | `live` |
| `FACILITATOR_EVM_PRIVATE_KEY` | fee-payer key (Sensitive) |
| `X402_PAY_TO` | treasury receiving address (already set) |
| `ARBITRUM_RPC_URL` | a private RPC (Alchemy/QuickNode) — public RPC rate-limits |
| `X402_QUOTE_SECRET` | strong random (HMAC quote binding) |

Verify presence with the admin route `GET /api/security/env`.

### 3a. Verify locally first (no faucets, no keys)
The entire live path — 402 quote → EIP-3009 signing → ecrecover →
`transferWithAuthorization` on-chain → confirmation gate → replay rejection —
can be driven against a local chain with hardhat's well-known test accounts:

```
cd packages/contracts
npx hardhat node --config hardhat.config.local3009.ts        # chainId 421614
npx hardhat run scripts/deploy-mockusdc-local.ts --config hardhat.config.local3009.ts --network localhost
# enable interval mining so confirmations accrue (automine only mines on tx):
#   evm_setIntervalMining [1000] via RPC
cd ../../apps/web
# X402_ENFORCE_SIGNATURE=1 X402_NETWORK=arbitrum-sepolia
# ARBITRUM_SEPOLIA_RPC_URL=http://127.0.0.1:8545
# X402_USDC_ADDRESS=<deployed MockUSDC> X402_PAY_TO=<treasury>
# FACILITATOR_EVM_PRIVATE_KEY=<hardhat acct 0> X402_QUOTE_SECRET=<random>
npx next dev
node scripts/x402-e2e-local.mjs
```

Validated 2026-07-10: USDC moved payer → treasury on-chain (fee-payer paid
gas), 3-confirmation gate held, replay of the same authorization rejected
with `nonce already used`.

**Operational note (observed):** if `waitForTransactionReceipt` times out
(viem default 180s) the client gets 402 but the settlement may still land
on-chain — the payer is debited, the resource is not delivered, and the
burned nonce prevents re-presenting the same authorization. On Arbitrum One
(~0.25s blocks) 3–12 confirmations resolve in seconds so this is unlikely,
but the recovery path is `GET /api/x402/settlement/[tx]` — surface it to
paying agents in the 402 error body when settlement state is ambiguous.

### 3. Verify on testnet first
Set `X402_NETWORK=arbitrum-sepolia` (or `base-sepolia`) with a Sepolia fee-payer
and Circle testnet USDC. Drive a real 402 → sign → settle cycle with a funded
test wallet and confirm the tx on the explorer. `X402_ENFORCE_SIGNATURE=1` forces
the live path in a preview deployment without flipping global `INTEGRATION_MODE`.

### 4. Promote to Arbitrum One
Flip `X402_NETWORK=arbitrum`, real fee-payer, real RPC. Start with a low
per-call price cap and monitor the settlement log + `GET /api/x402/settlement/[tx]`.

## Readiness after this change

| Capability | Before | After config |
| --- | --- | --- |
| EIP-3009 signature verification | ✗ (string check only) | ✓ ecrecover, fail-closed |
| On-chain settlement | ✗ (mock hash) | ✓ real `transferWithAuthorization` |
| Confirmation-depth gate | logic only | ✓ enforced by the settler |
| Free-mint via fake settlement | possible if `live` + mock | ✓ closed (fails `settler_unavailable`) |

## Still requires external work (not code)

These cannot be closed in code and are the remaining gap to a full production
launch:
1. **Smart-contract audit** — `X402Facilitator.sol` and related contracts are
   unaudited. Engage an auditor before mainnet custody of any size.
2. **Treasury / custody operations** — cold-storage policy, key rotation,
   fee-payer top-up automation, incident runbook.
3. **Card issuer + custody partners** — real JIT card funding needs a live
   Marqeta / Stripe Issuing connection; real fiat needs a licensed partner.
4. **Provider credentials** — Coinbase CDP (onramp), Twilio/Google/Apple (auth),
   Sumsub/Persona (KYC) each flip from mock to live with their own keys.
