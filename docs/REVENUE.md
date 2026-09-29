# Revenue metering

How FurlPay records what it earns, and — more importantly — what it refuses to
call revenue.

Code: `apps/web/src/lib/revenue/`. Schema:
`supabase/migrations/0018_revenue_events.sql`. Dashboard: `/ops`.

---

## 1. What counts as revenue

Revenue is **the fee FurlPay keeps**, and only when there is evidence it was
collected.

A revenue event is written with `status: "realized"` only when the code path
holds proof: a signature-verified Stripe webhook naming a completed charge, or
an on-chain settlement observed at the required confirmation depth. Nothing is
realized because a request returned 200, and nothing is realized because an
environment variable says the system is live.

## 2. What counts as TPV

TPV (total payment volume) is **the gross amount that moved**. It is recorded
in `volume_minor`, it is not income, and it never appears in a revenue total.

If $10,000 crosses a rail and FurlPay keeps $25:

```
volume_minor = 1000000   (TPV, $10,000.00 in cents)
fee_minor    =    2500   (revenue, $25.00)
```

The schema has no column called `amount`. Anyone writing a query has to say
which of the two they mean.

## 3. Revenue vs pass-through

Money moving through FurlPay is mostly **not ours**. Three examples that are
deliberately not recorded as revenue:

| Flow | What it is | Recorded as revenue? |
| --- | --- | --- |
| Stripe `payment_intent.succeeded` | a customer funding their own account | **No.** Pass-through. When a ramp fee exists, record that fee — never the deposit |
| x402 payment to a third-party `payTo` | FurlPay facilitating someone else's resource | **No.** It is the registrant's income |
| Swap notional | the user's own money moving between tokens | **No.** Only the integrator fee could ever be ours |

The x402 rule is a literal comparison: revenue is recorded only when
`payTo === PAY_TO` (FurlPay's treasury).

## 4. Realized vs simulated

Most of this platform's money paths are a deliberate pre-licence simulation.
They still emit events — knowing the shape of the flow is useful — but with
`status: "simulated"`, and every aggregation excludes them from revenue.

**`INTEGRATION_MODE=live` does not reclassify anything.** Status is decided by
the code path that produced the event, from evidence it actually has. There is
no env var, flag or migration that turns simulated activity into revenue; the
only thing that does is a real integration emitting a real event.

Statuses:

| Status | Meaning | Counts as revenue? |
| --- | --- | --- |
| `pending` | earned, not yet in our control (e.g. an accrued integrator fee awaiting withdrawal) | No |
| `realized` | collected, with evidence | **Yes** |
| `reversed` | refunded/charged back. Carries a **negative** fee that reduces the total | Yes (negatively) |
| `voided` | never actually earned | No |
| `simulated` | produced by a pre-licence simulation path | **Never** |

## 5. Engine definitions

| Engine | What it means |
| --- | --- |
| `transaction` | a take on value moving — swap/bridge integrator fees, FX spread |
| `subscription` | recurring plan charges |
| `api` | pay-per-call and developer platform usage, including x402 |
| `protocol` | on-chain/network fees accruing to FurlPay |
| `card` | interchange and card programme economics |
| `stablecoin` | reserve spread and issuance/distribution fees |
| `custody` | custody and staking service fees |
| `aum` | management fees on assets held |

The last four have **no sources defined**. That is deliberate: adding a
placeholder so a dashboard tile renders would be fabricating revenue. They get
sources when their integrations exist.

## 6. Idempotency

The event `id` is derived from the underlying **business event**:

```
id = "{source}:{externalRef}"      e.g. "subscription_charge:cs_test_abc123"
```

and is the table's PRIMARY KEY. A redelivered webhook or a retried handler
collides **in Postgres**, not in a read-then-write in application code — that
shape has a gap two concurrent lambdas can both pass through, and the row is
money.

Deliberately excluded from the key: timestamps, amounts, status. Including any
of them would let a redelivery that recomputes an amount create a second row,
which is the exact double-count this prevents.

A duplicate insert is treated as **success** by callers, because "already
recorded" is what they wanted. A reversal gets its own id (`…:reversal`) so the
original row is never touched.

`revenue_events` is append-only, enforced by a trigger. A correction is a new
row. Books that can be edited cannot be audited.

## 7. Metric formulas

```
realized revenue   = Σ fee_minor WHERE status = 'realized'
net realized       = realized + Σ fee_minor WHERE status = 'reversed'   (negative)
pending            = Σ fee_minor WHERE status = 'pending'
simulated          = Σ fee_minor WHERE status = 'simulated'      ← not revenue

applicable volume  = Σ volume_minor WHERE volume_minor IS NOT NULL
                     AND status IN ('realized','reversed')

effective take rate (bps) = realized revenue / applicable volume × 10000
ARPU (per paying account) = realized revenue / COUNT(DISTINCT user_id
                                                     WHERE status = 'realized')
growth %                  = (current − prior) / prior      (null when prior = 0)
```

Two things that are easy to get wrong and are handled explicitly:

- **The take-rate denominator is not total TPV.** A flat subscription has no
  volume. Including it in the numerator but not the denominator inflates the
  rate. Numerator and denominator are drawn from exactly the same events.
- **Totals are per asset.** 100 USD-cents and 100 micro-USDC are not the same
  magnitude, so there is no blended total. A single cross-asset number needs FX
  rates at a point in time, which this layer refuses to invent.

## 8. Which engines produce real revenue today

| Engine | Source | Status today | Why |
| --- | --- | --- | --- |
| `subscription` | `subscription_charge` | **Real, realized** | Stripe `checkout.session.completed` — signature-verified, amount is Stripe's own, already in minor units |
| `api` | `x402_payment` | **Real, realized** when `payTo === PAY_TO` | Recorded on a confirmed settlement at required depth |
| `transaction` | `swap_integrator_fee` | **Simulated only** | See below |
| `card`, `stablecoin`, `custody`, `aum` | none | Not implemented | Blocked — see §9 |

### The swap gap (open)

The real Li.Fi integrator fee is **not recorded anywhere**, on purpose:

- `/api/swaps/execute` returns **unsigned calldata**. FurlPay never learns
  whether the user broadcast it, so booking a fee there would be a guess.
- `/api/swaps/status` observes a confirmed `DONE` transaction but carries **no
  fee figure** to attach to it.

Closing this needs a `quoteId → txHash` mapping persisted at execute time and
read back on the `DONE` observation. Until then only the demo-ledger path
(`/api/swaps` with `execute: true`, which refuses in production) emits events,
and they are `simulated`.

## 9. Blocked engines

| Engine | Blocker |
| --- | --- |
| `card` | BIN sponsor + issuer bank; PCI scope |
| `stablecoin` | money-transmitter / MiCA-class authorisation; reserve attestation |
| `custody` | qualified-custodian or trust charter |
| `aum` | investment-adviser registration |

These are business-development and regulatory dependencies, not engineering
ones. The code is the last step.

## 10. Using the layer from a new engine

```ts
import { recordRevenue, minor } from "@/lib/revenue/record";

await recordRevenue({
  source: "card_interchange",   // add to RevenueSource + SOURCE_ENGINE first
  status: "realized",           // only with evidence of collection
  externalRef: settlement.id,   // the business event — drives idempotency
  fee: minor(interchangeMinor, "USD"),
  volume: minor(spendMinor, "USD"),   // omit when there is no underlying flow
  userId: account.id,
});
```

Rules the recorder enforces, so you do not have to remember them:

- fee and volume must be the same asset,
- a fee may not exceed its volume (that is a major/minor unit mix-up, every
  time),
- a negative fee is only valid on a reversal,
- `feeBps` is derived, never passed in.

`recordRevenue` **never throws for store failures** — it logs and returns
`{ recorded: false }`. This is a deliberate asymmetry with settlement code,
which fails closed: there, a missing record risks paying twice; here, a missing
record risks under-reporting. Under-reporting is recoverable by replaying from
the provider. A customer's subscription must not fail because an analytics
table was unreachable.

## 11. Access

Revenue data is company accounting data. `/api/ops/revenue` is **ADMIN_ONLY**
(`requireOpsAdmin`) and rate-limited, and it returns **aggregates only** — no
event rows, no per-user breakdown, no Stripe session ids or transaction hashes.
Those exist in the table for reconciliation via direct database access; an HTTP
endpoint that returned them would turn one compromised admin session into a
dump of every customer's payment references.

`revenue_events` has RLS enabled with zero policies — service-role only,
matching the posture in `0001_init.sql` and `0016_rls_money_tables.sql`.
