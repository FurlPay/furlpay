# Arc compliance decision — the sanctions oracle is absent, and that is fine

**Decided 2026-09-25.** Evidence in
[`ARC-CIRCLE-OFFICIAL-REFERENCES.md`](./ARC-CIRCLE-OFFICIAL-REFERENCES.md).

## The question as it was posed

On Arbitrum, FurlPay screens counterparties by calling a **Chainalysis sanctions
oracle** contract. Measured on Arc mainnet: **that oracle is not deployed.** The
question was framed as: which of these do we do?

- **A.** Deploy our own on-chain sanctions registry on Arc.
- **B.** Screen off-chain against a commercial provider.
- **C.** Proceed without screening on Arc.

## The answer: none of them

The framing contained a false premise — that the absence of the oracle leaves
FurlPay with no authoritative list to check. It does not.

**Arc's USDC is a full Circle FiatTokenV2, and it exposes its own blocklist as a
free view call.** Probed on mainnet, `0x3600…0000` answers
`authorizationState`, `DOMAIN_SEPARATOR`, `nonces`, `blacklister`
(`0x2a2b7ff3…8467`), `masterMinter`, `paused` (false), `decimals` (6), and:

```
isBlacklisted(address) -> bool
```

Verified on **both** Arc networks, using the address Arc publishes expressly "for
testing restricted value transfer behavior":

| | testnet (5042002) | mainnet (5042) |
|---|---|---|
| `isBlacklisted(0x70997970…79C8)` | **TRUE** | false |
| `isBlacklisted(0x8b1332e6…0f98)` | false | false |

True on testnet, false on mainnet — exactly as documented. The view is real,
authoritative, and exercisable without involving a real sanctioned party.

**So the decision is: screen against Circle's USDC contract directly.**
Implemented in `apps/web/src/lib/chains/arcCompliance.ts` — no deployment, no
vendor, 20 tests.

## Why this is better than the oracle it replaces, not merely equivalent

This is the part worth being precise about, because "we couldn't find the oracle
so we did something else" and "the something else is strictly better" are very
different claims.

**A third-party screening list and the list that reverts your transfer are two
different lists.** The gap between them is a real failure mode: a payment passes
screening, then reverts on-chain, after the user has been told it will succeed.
Every integration against an external provider carries that divergence, and
closing it requires reconciling two datasets that are updated on different
schedules by different parties.

Here there is no gap to close. **The contract queried is the contract that
enforces.** `isBlacklisted` returning false and the transfer not reverting are the
same fact, read at two moments. That eliminates:

- divergence between screening and enforcement,
- a subscription and an API key to keep current,
- a vendor in the decision path,
- and an integration that can be down while the chain is up.

It is also free — a public `eth_call`, no key.

## Why not A (deploy our own registry)

`compliance/SanctionsRegistry.sol` + `SanctionsCheck.sol` exist for exactly this,
and deploying them on Arc would make compliance **worse**.

They mirror an oracle's answer into our own storage. On Arc that creates a
*second* list which can drift from the one that actually reverts transfers, and
drift in the permissive direction means we authorise a payment the chain then
refuses. A mirror is a reasonable design when the enforcing contract is opaque.
Arc's is not. Adding a cache in front of a free, authoritative, always-current
source buys nothing and can be wrong.

It also costs an owner key, a deployment, a write path to keep current, and 121
lines of unaudited Solidity on the critical path.

**Rejected.** Recorded in
[`ARC-DEPLOYMENT-ARCHITECTURE.md`](./ARC-DEPLOYMENT-ARCHITECTURE.md) as
do-not-deploy-on-Arc.

## Why not B (commercial provider) — for *this* question

For the narrow question "would USDC refuse to move value to or from this address",
a provider is strictly worse: it is the divergence problem above, paid for.

That is not an argument against commercial screening in general. It is an argument
that it does not answer *this* question better than the enforcing contract does.
See **Scope** below for what it would be needed for.

## Why not C (proceed without screening)

Not considered seriously, and worth stating why so the option is closed rather
than left open.

The instruction governing this work is that a missing compliance dependency must
not be bypassed. Beyond that, C is not even operationally attractive: on Arc a
blocklisted transfer is **mined, consumes gas, and moves nothing**. Without a
pre-check, every blocklisted counterparty costs a failed on-chain transaction and
produces a customer-facing failure at the worst possible moment — after the user
has committed. Screening is cheaper than not screening here.

## Scope — what this decision does NOT cover

Stated narrowly, because a compliance control described loosely gets relied on for
things it does not do.

`isBlacklisted` answers **one** question: *would Circle's USDC contract on Arc
refuse to move value to or from this address right now.*

It is **not**:

- **AML.** No transaction-pattern analysis, no structuring detection, no
  behavioural risk scoring.
- **KYC.** Says nothing about who controls the address.
- **Transaction monitoring.** A point-in-time check, not a continuous one.
- **A sanctions determination.** It reports Circle's blocklist. Circle's blocklist
  is informed by sanctions lists, but it is Circle's operational list and not a
  legal conclusion.
- **Coverage of non-USDC assets.** EURC, USYC and cirBTC on Arc have their own
  contracts and were not probed. A FurlPay path that settles in those needs its
  own answer.

If FurlPay needs any of the above — and a regulated money-transmission business
eventually does — that is a separate programme, and a commercial provider is
likely part of it. This decision does not substitute for it and must not be cited
as though it did.

## The design that follows: fail closed, with three states

The implementation's central property is that **there is no path from an
unanswered check to a passed one.**

An unreachable RPC does not mean "not blocked". It means we do not know. A
screening check that reports *clear* when it could not reach the list is worse
than no check at all, because it launders an unknown into an assurance — and it is
the most likely failure in production, since RPCs fail far more often than
addresses get blocklisted.

So `ArcScreeningStatus` is `"clear" | "blocked" | "unknown"`, and **no boolean
anywhere collapses it.** Every failure path yields `unknown`:

| Path | Result |
|---|---|
| `eth_call` throws | `unknown` + reason |
| Empty `0x` return | `unknown` — we measured the function exists, so an empty return means this is not Arc's USDC |
| Non-boolean word (e.g. `2`) | `unknown` — guessing which way to round is exactly the decision not to make silently |
| Unparseable result | `unknown` |

A test sweeps all of these and asserts none can produce `clear`.

`assertArcPartiesClear` throws on `unknown` **as well as** on `blocked`. The only
way past it is a positive answer from the enforcing contract.

**Both parties are screened.** Arc reverts a transfer to *or from* a blocklisted
address, so screening only the recipient leaves the sender to be discovered as a
failed receipt after gas has been spent.

**A `blocked` result is never retried.** A blocklist is a standing issuer
decision, not a transient error; retrying burns gas indefinitely and tells the
user nothing. The error message says so, and `isPermanentArcFailure` classifies it
for the code path that handles reverts.

## Operational requirements this creates

1. **The fee treasury must be in the screened set.** If `feeTreasury` is
   blocklisted, every fee-bearing payment reverts — a total outage that presents
   as "all payments failing", indistinguishable at a glance from an RPC problem. A
   screening check that only ever runs against customers will not see it.
   (Finding R6, [`ARC-SECURITY-REVIEW.md`](./ARC-SECURITY-REVIEW.md).)
2. **Screen before building a batch**, not per item. One blocklisted party reverts
   an entire `batchPay` (R5).
3. **Record what was checked and when.** `ArcScreeningResult` carries `checkedAt`
   and `source`. A blocklist answer is only true as of an instant, and a stored
   "clear" with no timestamp cannot be reasoned about later.
4. **Do not cache aggressively.** A newly blocklisted address is precisely the case
   where a stale cached `clear` is harmful.

## Residual risk

Accepted, and stated rather than mitigated because it cannot be closed from
off-chain:

**An address blocklisted between screening and inclusion.** Arc finalises on
inclusion and blocks are sub-second, so the window is small — but it is not zero.
The consequence is a reverted transfer, which is the same outcome as no screening
at all for that one payment, so screening never makes this worse. Handled by
checking `receipt.status` and classifying the revert rather than by trying to
eliminate the race.

**Circle can blocklist the platform's own addresses.** Nothing in this design
changes that; `pause()` and `setFeeTreasury` are the response, and detection
depends on requirement 1.

## Status

| | |
|---|---|
| Decision | Screen against Circle's USDC `isBlacklisted` on Arc |
| Implemented | `apps/web/src/lib/chains/arcCompliance.ts`, 20 tests |
| Wired into a settlement path | **No.** The module exists and is tested; nothing calls it yet. |
| Exercised against a real blocklisted address | Verified as a **view** on testnet. **A blocklist-revert has not been exercised in a real transfer** — that needs a testnet deploy and is step 5 of the deployment sequence. |

The last two rows are the honest gap. A guard that exists is not a guard that
runs, and this decision is not in force until `assertArcPartiesClear` is on the
Arc settlement path.
