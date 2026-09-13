# FURL — token, integration, treasury, liquidity

Every statement in this document carries a label:

| Label | Meaning |
| --- | --- |
| **FACT** | True now, and verifiable on-chain or in this repository. |
| **PLANNED** | We intend to build it. Not built. |
| **PROPOSED** | A specific option written down for a decision. Not chosen. |
| **REQUIRES APPROVAL** | Prepared in code, deliberately not executed. Moves funds or is irreversible. |

Last reviewed: 2026-09-13.

---

## 1. The token

| | |
| --- | --- |
| Mint | `FYatJq71zqvaQNLLtbBy4hQcsV25dMATYfCSVBzV3gY1` |
| Program | Token-2022 (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`) |
| Name / symbol | FurlPay / FURL |
| Decimals | 6 |
| Supply | 1,000,000,000 FURL = 1,000,000,000,000,000 base units |
| Network | Solana mainnet-beta |
| Created | 2026-09-13 |
| Metadata | `https://gateway.irys.xyz/4WYcrbavrRd4BA7Ls61czF8z1cjNg6M3xPdzw24HQgFH` (Arweave, immutable) |
| Icon | `https://gateway.irys.xyz/FZZrqRxi2qg8ZN1ER8oh9n7QFGJocchTstNFojkREAkH` (Arweave, immutable) |

**FACT** — all of the above, verified against mainnet on 2026-09-13 via
`getMint` and confirmed independently by Jupiter's token API, which reports the
same mint, symbol, decimals, program and supply.

**FACT** — extensions enabled: `metadataPointer`, `tokenMetadata`. Nothing else.
No transfer fee, no transfer hook, no permanent delegate, no default-frozen
account state, no confidential transfers. Each omission is deliberate and
documented in `src/config.ts`.

**FACT** — freeze authority is `null`. No account can ever be frozen; holders
cannot be censored. This cannot be added later — it would require a new mint.

**FACT** — mint authority is **ACTIVE**, held by
`FgeSXvrWcqE93byDoF3Vhwou7XTUhY42cYhs7vXkJPUL`. More FURL can technically be
minted. The 1B cap is published intent, **not** yet enforced by the runtime.

### What FURL is not

**FACT** — FURL implements **no USD peg, no reserves, and no redemption
mechanism**. It is a fixed-supply payment token. It is not a claim on FurlPay or
on any asset, carries no profit expectation, no dividend, no governance right,
and is not registered with any financial regulator. No third-party audit or
attestation exists.

FurlPay positions FURL as the ecosystem's payment currency, *intended* to operate
as its stablecoin. That is positioning. Do not publish copy calling FURL a $1
stablecoin, fully backed, guaranteed, risk-free, or redeemable. A USD stablecoin
is **more** regulated than a utility token, not less — it needs reserves,
redemption, attestations, and (in the EU) e-money-token authorisation under MiCA.
USDC remains the reserve-backed settlement asset for every payment path.

---

## 2. Tokenomics

**FACT** — the published allocation model, and that it sums to exactly 1B with no
rounding loss (asserted by `tests/treasury.test.ts` and
`src/lib/__tests__/furlToken.spec.ts`):

| Allocation | Share | FURL | Required custody |
| --- | --- | --- | --- |
| Community & ecosystem | 40% | 400,000,000 | multisig 2/3 |
| Liquidity | 20% | 200,000,000 | multisig 2/3 |
| Treasury | 15% | 150,000,000 | multisig 3/5 |
| Team & founders | 15% | 150,000,000 | multisig 2/3 |
| Partnerships | 5% | 50,000,000 | multisig 2/3 |
| Security & launch reserve | 5% | 50,000,000 | multisig 3/5 |
| **Total** | **100%** | **1,000,000,000** | |

**FACT** — the custody column is **PLANNED**, not current. Today all six
allocations were minted to the same owner, so 100% of FURL sits in **one**
Token-2022 associated token account (`EU2tUJ1CoU8VjTKEuK49FTBv1N2Hk5jpv2589Eq1eZ1S`)
controlled by **one** keypair. Jupiter independently reports `holderCount: 1`.

**FACT** — this is a security risk, and it is published rather than hidden:
a single key compromise is a total loss of the entire supply; nothing on-chain
prevents that account from moving or selling everything; and no allocation is
independently auditable. It is stated on `/token`, in `src/config.ts`, and in
`MAINNET-LAUNCH.md`.

**FACT** — circulating supply outside the deployer is effectively zero. There is
no vesting contract.

---

## 3. Payment integration

**FACT** — FURL rides the existing Solana Actions payment path. It is a parameter
to the same builder that produces SOL and USDC transactions, not a parallel
system (`apps/web/src/lib/actions/solana.ts`).

| Surface | Status |
| --- | --- |
| `POST /api/actions/pay/[orderId]?asset=FURL` | **FACT** — builds a Token-2022 `transferChecked`, idempotently creates the merchant token account, splits the platform fee in FURL. |
| `GET /api/actions/pay/[orderId]` | **FACT** — offers the FURL button only when FURL pricing is configured. |
| `GET /api/token/furl` | **FACT** — identity, allocation model, live authorities, concentration, disclosures. |
| `GET /api/token/furl/balance?owner=…` | **FACT** — FURL balance for any address; 503 (never 0) when the chain is unreadable. |
| `POST /api/checkout/session` with `token: "FURL"` | **FACT** — merchant sessions may be denominated in FURL. No oracle involved: the session amount is in token units. |
| `/token` | **FACT** — public reference page with live on-chain state. |
| `/docs/tokens/furl` | **FACT** — integration documentation. |

### Pricing fails closed

**FACT** — FURL has no oracle and no market. The USD→FURL conversion uses
`FURL_USD_PRICE`, and with it unset the FURL button is not rendered and a
`?asset=FURL` POST is rejected. No rate is ever assumed. The configured price is
also range-checked (`$0.000001`–`$1,000,000`) so a mistyped value cannot size a
transfer. SOL converts via its live Pyth oracle; USDC is quoted 1:1.

**FACT** — FURL checkout is therefore **disabled** on any deployment where
`FURL_USD_PRICE` is unset, which is every deployment today.

### Correctness properties under test

**FACT** — `apps/web/src/lib/__tests__/furlPayments.spec.ts` and
`furlBalance.spec.ts` assert: Token-2022 program id on every instruction;
`transferChecked` carrying the mint and 6 decimals; exact fee split summing to the
quoted total; refusal to build without a price; rejection of an absurd price; u64
overflow and round-to-zero refusals; zero-vs-unreadable balance distinction;
multi-account summation; decimals-mismatch refusal; and SOL/USDC regression.

### Not built

**PLANNED** — fee discounts for paying in FURL; rewards paid in FURL; travel
bookings priced in FURL; an in-app FURL balance card (blocked: account wallet
linking verifies EVM addresses only — `chainFamily: "evm"` — so the app has no
Solana address to read for a signed-in user; `/token`'s lookup covers any address
in the meantime).

---

## 4. Wallet / treasury architecture

**FACT** — `src/treasury.ts` defines one destination per allocation, the custody
model each requires, and the refusals that block an unsafe migration: an unset
address, a malformed address, a destination equal to the deployer (a no-op that
looks like progress), a duplicate address shared by two buckets, multisig custody
with no recorded threshold, and legs that do not sum to the supply.

**FACT** — every destination is currently `null`, so `assertMigrationReady()`
throws and the migration cannot run. This is asserted by a test.

**PROPOSED** — Squads multisigs per allocation with the thresholds in the table
above; no private keys or seed phrases anywhere in this repository, ever; only
public addresses committed.

**REQUIRES APPROVAL** — `scripts/migrate-allocations.ts`. Dry-run is the default
and prints every leg, the derived destination token accounts, expected
post-migration balances, live chain state, and an unsigned base64 transaction per
leg. Execution needs all six destinations set, `--execute`, and
`--i-understand-this-moves-real-funds`. It re-reads each destination balance first
and refuses to double-send. It never creates or funds a wallet.

```
npm run plan:migrate -w @furlpay/furl-token      # dry run, moves nothing
```

---

## 5. Mint authority decision

**REQUIRES APPROVAL** — `scripts/revoke-mint-authority.ts` prepares the exact
`SetAuthority(mint, MintTokens, None)` transaction, prints its accounts, data and
serialized form, pre-flights the chain (refusing if supply ≠ 1B, which would
strand the remainder forever), and exits without sending.

```
npm run plan:revoke -w @furlpay/furl-token       # prepares, sends nothing
```

**PROPOSED — Model A, fixed-supply payment/utility token.** 1B hard cap enforced
by the runtime; supply finality anyone can verify; simplest architecture. Cost:
FURL can never be minted again, so any future supply mechanism needs a new token.

**PROPOSED — Model B, real stablecoin issuer.** Mint/burn retained behind a
multisig, driven by deposits and redemptions, with segregated reserves, 1:1
redemption, third-party attestations, issuer controls, and authorisation under the
applicable regime.

**FACT** — FURL implements none of Model B. And because freeze authority is
`null` and cannot be added to an existing mint, Model B is already only reachable
via a re-launch with a new mint. That makes revocation a smaller decision than it
appears: it forecloses an option that is in practice already foreclosed for this
mint.

**FACT** — not revoked. Nothing has been executed.

---

## 6. Liquidity

**FACT** — no liquidity pool exists. FURL is not tradable anywhere: Jupiter's
quote API returns `TOKEN_NOT_TRADABLE`, and DexScreener returns `pairs: null`.
FURL has no market price. Any figure quoted for it today is not derived from a
market.

**FACT** — venue compatibility, verified 2026-09-13:

| Venue | Token-2022 | Notes |
| --- | --- | --- |
| Raydium CPMM | Supported | The modern standard, cheaper than AMM v4. ~0.2 SOL for pool rent + token accounts + priority fees. |
| Orca Whirlpools | Supported | `MetadataPointer` and `TokenMetadata` are on the supported list and need **no Token Badge** — which is exactly and only what FURL enables. Concentrated liquidity gives far better depth per dollar inside a chosen range. |
| Meteora | Supported | DAMM v2 (constant product, configurable fees) and DLMM. Routed by Jupiter. |
| Jupiter | n/a | Aggregates the above; routes the pair once a pool with real liquidity exists. No application needed for routing. |

FURL triggers none of the extensions that require a badge or are unsupported —
those are precisely the ones `src/config.ts` deliberately omits.

**PROPOSED** — `scripts/liquidity-plan.ts` computes a FURL/USDC configuration and
prints the implied price, FDV, pool share of supply, exact constant-product price
impact per trade size, venue notes, LP custody plan and costs. It has **no
execute path at all** — by construction, not by a flag.

```
npm run plan:liquidity -w @furlpay/furl-token -- --usdc 25000 --furl 5000000
```

**PROPOSED** — LP custody: the position is owned by the liquidity multisig, not
the deployer key; the pool address and LP owner are published on `/token` once
they exist; any lock is read and understood before use (locking is itself
irreversible for its duration).

**REQUIRES APPROVAL** — creating the pool, and any deposit of USDC or FURL into
it. The initial price must be chosen because it is defensible, not because it
makes FDV look large; read the price-impact table before choosing.

**FACT — prohibited, without exception:** wash trading, self-trading, volume
manufacturing, splitting the treasury across wallets to disguise concentration,
fake holders, price manipulation, and announcing a listing, partnership or audit
that does not exist.

---

## 7. Verification and indexing status

Measured 2026-09-13. **Indexing is not verification** — the first means a
platform can see the token, the second means a platform has reviewed and blessed
it.

| Platform | Status | Evidence |
| --- | --- | --- |
| Solana Explorer | **INDEXED** | Reads the chain directly; the mint resolves (`getMint` returns supply 1e15, decimals 6). |
| Solscan | **INDEXED** | Same; the token page is the canonical explorer link. Solscan's own API/page rejects unauthenticated programmatic probes (403), so this is asserted from the on-chain read, not from a scrape. |
| Jupiter | **INDEXED, NOT VERIFIED** | Token API returns full metadata, `tokenProgram` Token-2022, `holderCount: 1`, `freezeAuthorityDisabled: true`, tags `["unknown","token-2022"]`, `organicScore: 0` / `"low"`. The `unknown` tag is the not-verified state. |
| Jupiter routing | **NOT TRADABLE** | `/swap/v1/quote` returns `TOKEN_NOT_TRADABLE`. Needs a pool. |
| DexScreener | **NOT INDEXED** | `pairs: null`. Indexes pairs, not mints — nothing to index until a pool exists. |
| Birdeye | **NOT DETERMINED** | Public API requires a key (401 without one). Like DexScreener it is pair-driven, so expect nothing before a pool. |
| Phantom | **DISPLAYS, NOT VERIFIED** | Wallets render any Token-2022 holding with its on-chain metadata. A "verified"/trusted-list badge is a separate state with no public API to confirm; treat as not verified. |
| CoinGecko | **APPLICATION REQUIRED** | `/coins/solana/contract/<mint>` → `coin not found`. Listing requires a submission and, in practice, real liquidity and volume. |
| CoinMarketCap | **APPLICATION REQUIRED** | Same shape; listing is an application, not an automatic index. |
| Arweave metadata | **LIVE** | Metadata URI returns HTTP 200 `application/json` with matching name/symbol; icon returns 200 `image/png`, 123,954 bytes. |

**FACT** — the ordering implied above: a pool is the prerequisite for Jupiter
routing, which is the prerequisite for DexScreener/Birdeye, which is in practice
the prerequisite for a credible CoinGecko/CMC application. Paying anyone for
"verification" before that chain exists buys nothing.

---

## 8. Security considerations

**FACT — fixed in this work:**

1. *u64 overflow and float scaling in payment amounts.* The USD→token conversion
   was `BigInt(Math.round(amountUsd / price * 10 ** decimals))`: float error
   before rounding, a product that can pass `Number.MAX_SAFE_INTEGER` (where
   `Math.round` is a no-op on an already-imprecise value), and no u64 bound. Now
   `usdToTokenBaseUnits` pins precision through a decimal string, refuses an
   amount that rounds to zero, and refuses one that exceeds u64. A test proved
   the first version of the fix still threw an opaque `BigInt` conversion error
   past 1e21 (`toFixed` switches to exponential notation); the range check now
   runs before formatting.
2. *Unbounded configured price.* `FURL_USD_PRICE` is range-checked, so a mistyped
   `0.0000000001` cannot turn a $25 order into 250 billion FURL (AGENTS.md rule 8).
3. *A Token-2022 read failure reported as an empty balance.* `readSolanaBalances`
   swallowed a failed Token-2022 query with `.catch(() => ({ value: [] }))`.
   Since xStocks and FURL are Token-2022, that rendered a real position as "you
   hold nothing". The failure now propagates.
4. *Mint validation at the transaction boundary.* `assertFurlMint` runs before a
   FURL transfer is built, and `isFurlMint` compares case-sensitively — base58 is
   case-sensitive, so a folded comparison would accept a string that is not this
   mint.
5. *Balance reads cannot be redirected.* `/api/token/furl/balance` pins the mint
   in code; no query parameter can point it at a lookalike token. Owner addresses
   are validated with `new PublicKey()` in try/catch, not a regex (AGENTS.md
   rule 9).

**FACT — verified correct, no change needed:** `transferChecked` (not bare
`transfer`) so the runtime validates mint and decimals; idempotent merchant ATA
creation; ATAs derived with the Token-2022 program id on every path; fee legs
summing exactly to the quoted total; rate limits on both new public routes
(AGENTS.md rule 2) and both classified in `security/route-manifest.json`; no
secrets in any committed file; only public addresses in config.

**FACT — open risks, not code-fixable:**

- Supply concentration in one key (§2). Mitigation is §4, and it needs approval.
- Mint authority active (§5). Mitigation is §5, and it is irreversible.
- No liquidity, therefore no price discovery (§6).
- `getOrder()` in `lib/actions/solana.ts` is still a fixed $25 stub; a production
  Blink must resolve the order from the ledger. Unchanged by this work, and
  unrelated to FURL, but it bounds what the Blink path means today.
- Replay: the Actions endpoint returns an *unsigned* transaction, so
  double-spend protection is the chain's (blockhash + signature uniqueness) plus
  merchant-side reconciliation. There is no server-side idempotency key on the
  Blink POST because it mints no state.

---

## 9. Approval gates

Nothing in this table has been executed.

| Action | Moves funds | Irreversible | Prepared by |
| --- | --- | --- | --- |
| Migrate 1B FURL to six multisigs | Yes | No (but a wrong destination is) | `scripts/migrate-allocations.ts` |
| Revoke mint authority | No | **Yes, permanently** | `scripts/revoke-mint-authority.ts` |
| Create FURL/USDC pool | Yes | Effectively | `scripts/liquidity-plan.ts` (plan only — no execute path) |
| Deposit initial liquidity | Yes | No | — |
| Lock LP position | Yes | For the lock duration | — |
| Burn any FURL | Yes | **Yes** | Not written. |
| Enable FURL checkout (`FURL_USD_PRICE`) | No | No | Config only — but it makes FURL payable, so set it to a defensible price. |
