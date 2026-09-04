# Agent-paid API — the FurlPay golden path

An autonomous agent pays for an API **per request**, under a budget somebody else set, and every step is recorded.

```
GET /search  →  402  →  identity  →  policy  →  budget reservation
             →  PaymentIntent  →  payment  →  settlement
             →  commit  →  ledger  →  audit  →  200
```

Nothing here is reimplemented. It composes four packages that already exist:

| Package | Owns |
|---|---|
| `@furlpay/gateway` | 402 challenge, quote binding, replay claims, settlement |
| `@furlpay/agent-trust` | who may spend, how much, atomically |
| `@furlpay/payment-intent` | the durable record a retry recovers |
| `@furlpay/ledger` | double-entry accounting |

---

## ⚠️ This runs on a TEST RAIL by default

**No money moves.** `TestPaymentRail` settles nothing.

It exists so the *control plane* — identity, policy, budget, intent, ledger, audit, revocation — can be demonstrated without a funded wallet. Every reference it emits is prefixed `TESTRAIL-`, which is **not valid base58** and cannot be mistaken for a Solana signature by a log, a CSV, or a careless human.

For real settlement, see [Running against Solana devnet](#running-against-solana-devnet).

---

## Run it

This is a workspace of the monorepo and depends on packages that are not all published, so install **from the repo root** once:

```bash
npm install          # repo root
```

Then two terminals, from this directory:

```bash
PORT=4021 FURLPAY_DEMO_BUDGET=0.05 npm run dev
```

```bash
npm run agent
```

The budget is deliberately **$0.05** so that 50 requests at $0.001 exhaust it and you see a real denial. Raise it with `FURLPAY_DEMO_BUDGET`.

## What you get

This is actual output, not an illustration:

```
[1] GET /search with no payment
    -> 402 Payment Required
    price      $0.001000
    network    test-network
    asset      TEST-USDC
    payTo      TESTRAIL-merchant

[2] authorising payment and retrying
    -> 200 OK
    paymentIntent  pi_90dfb37a-fff9-4b98-b876-4f128e0fd1d1
    ledger tx      txn_1
    settlement     TESTRAIL-000001   (rail: test)

[3] the same request again, same Idempotency-Key
    first  -> 200  intent pi_90dfb37a-…
    second -> 200  intent pi_90dfb37a-… (replayed)
    SAME PaymentIntent — charged once.

[4] spending the budget down until FurlPay refuses
    allowed 48, then stopped
    -> 403 exceeds_total
    403, not 402 — an exhausted agent is not told to pay again.

[5] revoking the agent
    -> 403 revoked

[6] what the operator can see
    ledger entries  50
    revenue         $0.050000
    audit events    206
      BUDGET_RESERVED        50
      BUDGET_COMMITTED       50
      SETTLEMENT_COMPLETED   50
      LEDGER_COMMITTED       50
      IDEMPOTENT_REPLAY      1
      POLICY_DENIED          4
      AGENT_REVOKED          1
```

**The numbers tie out.** $0.05 ÷ $0.001 = 50 payments — two from steps 2–3 plus 48 in the loop. Fifty ledger entries for fifty payments: one accounting event per logical payment, and the replay in step 3 added none.

(`paymentIntentId` values are generated per run; everything else above is deterministic.)

## Verify it

`npm run agent` *prints* the story. `npm test` *fails the build* when the story stops being true:

```bash
npm test
```

```
✔ an unpaid request is challenged, not served
✔ a paid request is served and settles on the test rail
✔ the same key replays the same intent and is charged once
✔ a reused key with a different request is refused, not replayed
✔ an exhausted budget is refused with 403, never 402
✔ a revoked agent is refused immediately
✔ the audit log records every decision, including the refusals
ℹ pass 7   ℹ fail 0
```

Those tests run the server over a real socket on an ephemeral port, so status codes, headers and JSON bodies are exercised exactly as a paying client meets them. The load-bearing assertions are the arithmetic ones: revenue must equal the budget *exactly*, and `BUDGET_RESERVED` must equal `BUDGET_COMMITTED + BUDGET_RELEASED` — a reservation left open is allowance that never comes back.

---

## The four things worth noticing

### 403, never 402, when policy refuses

A 402 means *pay and retry*. An agent that has exhausted its budget reads that as an instruction to pay again — in a loop, forever, because it is a machine and will not get bored. The `deny` decision is 403 and carries a machine-readable `reason`.

### Budget is reserved before settlement, never after

Inside `gateway.authorize()` the order is fixed: verify the payment's MAC and burn its nonce, **then** reserve budget, **then** settle. Reserving earlier would budget against a payer the client merely *claimed* to be. Settling earlier would take money from an agent that policy was about to refuse.

Every failure path releases. A payment that does not complete never permanently consumes allowance.

### One logical payment, one accounting event

Step 3 pays once and replays once. The ledger gained one entry, not two. `recoveryFor()` decides: a `COMMITTED` intent replays; anything that may have touched a chain **reconciles** rather than paying again (409, with the intent id, never a second payment).

The mirror case matters as much: the *same* key on a *different* request is **422**, not a replay. The request fingerprint covers method, path, **query string** and body — the query is part of the request, so `?q=cheap` and `?q=expensive` are not interchangeable. Replaying across them would hand a caller proof of a payment they never made. Pricing is keyed by path alone (`pathOf`), because a price must not vary with the query; identity is keyed by both, because the resource does.

### Unknown is not failure

`TestPaymentRail` can be configured to time out (`settleTimesOut`). It **throws** rather than returning `success: false`, because a timeout is the absence of evidence, not evidence of failure. The gateway releases the reservation and the intent stays recoverable.

---

## Running against Solana devnet

> **DEVNET FUNDING REQUIRED FOR LIVE SETTLEMENT.**
> The control-plane demo above is complete and real. Blockchain settlement is not, and this example will not pretend otherwise.

```bash
export FURLPAY_RAIL=solana-devnet
export FURLPAY_PAY_TO=<merchant devnet pubkey>
export FURLPAY_QUOTE_SECRET=<16+ chars>
```

The config **fails closed**: selecting the devnet rail without `FURLPAY_PAY_TO` or a real quote secret throws at startup rather than falling back to the test rail.

The RPC path is already verified against live devnet — reads, fee sampling, submission-failure classification, and block-height expiry all run against `api.devnet.solana.com`:

```bash
node ../../packages/solana-rpc/devnet-observe.mjs
```

A successful **transfer** has never been executed. The public faucet returns 429 and Helius devnet disables `requestAirdrop`. Fund a devnet key, then:

```bash
node ../../packages/solana-rpc/devnet-proof.mjs
```

Mainnet credentials in `apps/web/.env.local` are **never** used by any of this.

---

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `4021` | Server port |
| `FURLPAY_RAIL` | `test` | `test` or `solana-devnet` |
| `FURLPAY_DEMO_BUDGET` | `5` | Agent's total budget, USD |
| `FURLPAY_DEMO_AGENT` | `agent-demo` | Agent id |
| `FURLPAY_PRICE_ATOMIC` | `1000` | Price per call (atomic, 6dp) |
| `FURLPAY_PAY_TO` | — | **Required** on devnet |
| `FURLPAY_QUOTE_SECRET` | example value | **Required** (16+ chars) on a real rail |

## Operator endpoints

```
GET /admin/ledger          entries and derived revenue
GET /admin/audit           every decision, oldest first
GET /admin/revoke?agent=…  revoke immediately
```

## What this example is not

Storage is **in memory**, addressed exactly as tables would be — `(principalId, idempotencyKey)` is the composite a real `UNIQUE` constraint would enforce. Restart the server and it forgets. A production deployment needs a database behind those two maps and a shared store behind `SpendLimiter`, which is single-process today.
