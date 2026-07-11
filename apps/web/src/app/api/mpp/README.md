# MPP — Machine Payments Protocol endpoints

FurlPay speaks two agent-payment dialects over one settlement engine. The same
priced resources are payable via either:

- **x402** (Coinbase) — `X-PAYMENT` header. See `/api/x402/*`.
- **MPP** (Stripe/Tempo, `paymentauth.org` "Payment" HTTP auth scheme) — the
  `WWW-Authenticate: Payment` / `Authorization: Payment` flow below.

Both settle the same way: an EIP-3009 `transferWithAuthorization` submitted by
FurlPay's fee-payer on Arbitrum, with confirmation-depth gating, durable
single-use replay protection, and submitted-but-unconfirmed recovery.

## Flow (`GET /api/mpp/fx`)

1. `GET /api/mpp/fx?from=USD&to=EUR&amount=100`
   → `402` with `WWW-Authenticate: Payment id="…", realm="…", method="usdc-eip3009", intent="charge", expires="…", request="<base64url>"`
   The `request` decodes to `{ amount, currency, recipient, asset, network, maxAmountRequired, decimals }`.
2. Sign an EIP-3009 `TransferWithAuthorization` for `maxAmountRequired` (atomic
   USDC) to `recipient`, EIP-712 domain `{name:"USD Coin", version:"2", chainId, verifyingContract: asset}`.
3. Retry with `Authorization: Payment <base64url(credential)>` where the
   credential is `{ challenge: {…echoed…}, source?, payload: { signature, authorization } }`.
   → `200` + `Payment-Receipt: <base64url({ status, method, timestamp, reference })>`
   (`reference` is the settlement tx hash). Poll `/api/x402/settlement/[tx]` if
   a `402` carries `X-Payment-Pending`.

## Method: `usdc-eip3009`

The crypto method id. The `payload` proof is the EIP-3009 authorization +
signature (identical to x402's) — so any client that can sign an EIP-3009
authorization can pay a FurlPay MPP resource. The challenge `id` is a stateless
HMAC-SHA256 binding over the 7 spec slots (`realm|method|intent|request|expires|digest|opaque`).

Verified end-to-end against a local chain by `apps/web/scripts/mpp-e2e-local.mjs`
(real on-chain USDC move, receipt, replay rejected).
