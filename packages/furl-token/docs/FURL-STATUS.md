# FURL — technical status and funding brief

**Prepared 2026-09-13. Every on-chain figure below was read from Solana mainnet
on that date** by `scripts/audit-mainnet.ts`, which is read-only and can be
re-run by anyone to reproduce the table.

Status labels used throughout:

| Label | Meaning |
| --- | --- |
| **LIVE** | Deployed on mainnet and verifiable on-chain right now |
| **COMPLETED** | Built, tested, and merged in this repository |
| **BLOCKED — FUNDING** | Engineering is done; the remaining input is capital |
| **NEEDS APPROVAL** | Prepared in code, deliberately not executed |

---

## 1. What FURL is

A fixed-supply Token-2022 payment token on Solana, used as FurlPay's ecosystem
token. It is **not** a stablecoin: no peg, no reserves, no redemption. USDC
remains the reserve-backed settlement asset for every payment path. That
distinction is enforced in code and in CI, not just in prose — see §6.

## 2. Mainnet status — **LIVE**

| Property | Value | Verified |
| --- | --- | --- |
| Mint | `FYatJq71zqvaQNLLtbBy4hQcsV25dMATYfCSVBzV3gY1` | `getAccountInfo` |
| Program | Token-2022 (`TokenzQd…PxuEb`) | account owner |
| Decimals | 6 | `getMint` |
| Total supply | 1,000,000,000 FURL (1e15 base units) | `getMint` |
| Mint authority | **ACTIVE** — `FgeSXvrW…JPUL` | `getMint` |
| Freeze authority | **None** — holders cannot be censored | `getMint` |
| Extensions | `MetadataPointer`, `TokenMetadata` only | TLV parse |
| Metadata | name/symbol/URI on-chain, Arweave-hosted | `getTokenMetadata` |
| Metadata update authority | deployer (metadata is mutable) | `getTokenMetadata` |
| Holders | **1** token account, holding **100%** | `getTokenLargestAccounts` |
| Deployer SOL | **0.048 SOL** | `getBalance` |
| Deployer USDC | **$0** (no token account) | `getParsedTokenAccountsByOwner` |

Audit result: **OK 21, NOTE 15, WARN 4, FAIL 0.** The four warnings are the four
known facts above: active mint authority, 100% concentration, low SOL, no USDC.

**Deliberately absent** (each verified, each a thing that makes a token unsafe to
hold): transfer fee, transfer hook, permanent delegate, default-frozen state,
confidential transfers, mint close authority.

## 3. Tokenomics — **LIVE, on-chain**

The allocation below is what was actually minted, in six transactions recorded
in `MAINNET-LAUNCH.md`. It is the only allocation; no other version is current.

| Allocation | Share | FURL |
| --- | --- | --- |
| Community & ecosystem | 40% | 400,000,000 |
| Liquidity | 20% | 200,000,000 |
| Treasury | 15% | 150,000,000 |
| Team & founders | 15% | 150,000,000 |
| Partnerships | 5% | 50,000,000 |
| Security & launch reserve | 5% | 50,000,000 |

There is **no investor allocation**, and none was ever minted. A CI test
(`furlSupplyApi.spec.ts`) fails the build if an investor bucket or the
superseded 30/20/15/15/12/8 split is reintroduced.

**All six allocations currently sit in one account.** They were minted to the
same owner, so the buckets are an accounting model, not six wallets. This is
stated on `/token` and in every document rather than left to be discovered.

## 4. Circulating supply methodology — **COMPLETED**

`GET /api/token/furl/supply`, built to CoinGecko's published endpoint
requirement (HTTPS, unauthenticated, JSON, numeric with decimals, safe for
30-minute polling). `?q=total` and `?q=circulating` return bare numbers for
CoinMarketCap-style consumers.

**Circulating supply is computed, never declared.** Issuer-held balances are read
from chain and subtracted, so today it returns **0** — there is no public float.
The excluded accounts ship in the response so the figure can be checked rather
than trusted. When the treasury migrates to multisigs, those addresses join the
exclusion list and the number continues to reflect reality with no constant to
edit.

An unreadable chain returns **503, never a number** — aggregators cache what they
are given, so a fabricated figure would outlive the outage.

## 5. Completed functionality — **COMPLETED**

| Capability | Where |
| --- | --- |
| FURL identity as one canonical source | `apps/web/src/lib/token/furl.ts` |
| Live mint/authority/concentration reads | `lib/token/furlChain.ts` |
| FURL balance reads (zero vs unreadable kept distinct) | `lib/token/furlBalance.ts` |
| Public token page with live chain state | `/token` |
| Integrator docs | `/docs/tokens/furl` |
| Identity + supply + disclosures API | `/api/token/furl`, `/api/token/furl/supply`, `/api/token/furl/balance` |
| Token-2022 `transferChecked` payment path | `lib/actions/solana.ts` |
| FURL-denominated merchant checkout sessions | `/api/checkout/session` |
| Mobile Solana account from the existing mnemonic | `native-app/lib/solana/wallet.ts` |
| SLIP-0010 ed25519 derivation | `native-app/lib/solana/slip10.ts` |
| ATA derivation without web3.js | `native-app/lib/solana/ata.ts` |
| Integer-only FURL amount conversion | `native-app/lib/solana/amount.ts` |
| Read-only mainnet audit | `scripts/audit-mainnet.ts` |

**Verification standard used throughout:** derivation code is checked against an
outside oracle, not against itself. SLIP-0010 against the official spec vectors;
Solana addresses and ATAs against `@solana/web3.js` / `@solana/spl-token`
(6/6 ATA vectors matched, and the deployer's derived ATA equals the account that
actually holds the supply on mainnet).

## 6. Honesty controls — **COMPLETED**

These are CI tests, so the claims cannot silently drift back:

- `custodyClaims.spec.ts` — fails the build if "2-of-2 MPC" custody language
  reappears on a public page.
- `furlSupplyApi.spec.ts` — fails if circulating supply is hard-coded, if the
  investor allocation returns, or if the allocation stops being 40/20/15/15/5/5.
- `furlToken.spec.ts` — fails if a second FURL mint address appears anywhere.
- `furlAmount.test.ts` — fails if the 6-decimal scale can produce a 1,000×
  amount (the `10_000_000 * 1e9` bug, which has appeared twice in planning docs).
- `config.test.ts` — fails if metadata claims a peg, reserves, or redemption.

## 7. Blocked on funding — **BLOCKED — FUNDING**

Engineering is complete for each; the missing input is capital.

**Correction, superseded — see below.** An earlier revision of this file said the
treasury migration was NOT funding-blocked, on the basis that the transfers cost
~0.032266 SOL against a 0.048203 SOL balance. That costed the six transfers and
their ATA rents but **not the creation of the multisigs they send to**.

**Squads V4 charges a 0.1 SOL deployment fee per multisig** (plus ~0.0018 rent
and 0.001 funding), which exceeds the entire current balance on its own. The
custody transition is therefore funding-blocked in every architecture:

| Architecture | Deploy | + migration | + reserve | Shortfall |
| --- | ---: | ---: | ---: | ---: |
| Six Squads | 0.6168 | 0.6491 | 0.6991 | **0.6509** |
| Three domains (recommended) | 0.3084 | 0.3407 | 0.3907 | **0.3425** |
| One Squad, six vaults | 0.1028 | 0.1351 | 0.1851 | **0.1369** |

Full analysis in `FURL-CUSTODY-ARCHITECTURE.md`. The transfers alone remain
affordable; the infrastructure they require is not.

| Item | Needs | Current |
| --- | --- | --- |
| Treasury migration — transfers only | ~0.0323 SOL | 0.0482 SOL — sufficient |
| Treasury migration — incl. Squads deployment | **0.185–0.699 SOL** | **0.0482 SOL — SHORT** |
| FURL/USDC liquidity pool | ~0.15–0.35 SOL to create + the deposit | 0.048 SOL, $0 USDC |
| Initial liquidity | A decided, defensible USDC amount | none |
| Jupiter routing | A pool with real liquidity | `TOKEN_NOT_TRADABLE` |
| DexScreener / Birdeye indexing | A tradable pair | `pairs: null` |
| CoinGecko / CMC listing | Liquidity + volume + application | supply API ready |

**Nothing about this ordering can be shortcut.** A pool is the prerequisite for
routing, routing for aggregator indexing, and indexing in practice for a
credible listing application. Jupiter's V3 verification is driven by Organic
Score, which specifically filters out inorganic activity — so manufactured
volume would actively work against listing, quite apart from being off-limits.

## 8. Needs approval — **NEEDS APPROVAL**

Prepared in code, not executed. None of these has been run.

| Action | Script | Reversible? |
| --- | --- | --- |
| Create six Squads multisigs | `create-multisigs.ts` (guides; creates nothing) | n/a — free |
| Migrate 1B FURL to multisigs | `migrate-allocations.ts` | No, if sent wrong |
| Revoke mint authority | `revoke-mint-authority.ts` | **Permanently irreversible** |
| Create a pool / add liquidity | `liquidity-plan.ts` (no execute path exists) | Effectively not |

## 9. Proposed use cases

These follow from what is already built, not from a wish list:

- **Merchant checkout in FURL.** The Token-2022 `transferChecked` path and
  FURL-denominated sessions already exist; pricing fails closed until a real
  FURL price is configured.
- **Solana Actions / Blinks.** A FURL pay button is already generated by the
  Actions endpoint when pricing is enabled.
- **Mobile self-custody.** The phone derives its Solana account from the same
  mnemonic as its Ethereum one, so it can hold FURL with nothing extra to back up.
- **Fee discounts and rewards.** Not built. They need a market price to discount
  against, which needs liquidity — and an unbacked discount is a promise, not a
  feature.

## 10. Grant-ready milestones

Each is independently verifiable and none requires trusting a claim:

1. **Treasury decentralisation** — six multisigs live, supply migrated, holder
   count > 1 verifiable via `getTokenLargestAccounts`.
2. **Supply finality** — mint authority revoked; `getMint` returns
   `mintAuthority: null`.
3. **Market existence** — a FURL/USDC pool with a Jupiter quote that returns a
   route instead of `TOKEN_NOT_TRADABLE`.
4. **Real payment volume** — merchant transactions settling in FURL, countable
   on-chain.
5. **Aggregator coverage** — DexScreener pair indexed; CoinGecko supply endpoint
   consumed.

## 11. Funding requirement — estimate, not a request

Figures are what the blocked items cost, not a round size.

| Item | Estimate | Note |
| --- | --- | --- |
| Pool creation (one venue) | ~0.2 SOL (~$40) | Raydium CPMM rent + fees |
| Operating SOL for transactions | ~0.5 SOL (~$100) | migration + ongoing fees |
| Initial USDC liquidity | **undecided** | the real number; must be chosen deliberately |
| Third-party security audit | not quoted | no audit exists today; stated plainly |

The USDC figure is deliberately left blank. Two planning documents have quoted
incompatible FURL prices — $0.20 and $0.0025, an 80× spread implying a $200M vs
$2.5M FDV — and the correct response is to decide it with the price-impact table
from `liquidity-plan.ts` in front of you, not to inherit either number.

## 12. Known risks, stated plainly

| Risk | Severity | Status |
| --- | --- | --- |
| 100% of supply under one key | **Critical** | Mitigation prepared, needs approval |
| Mint authority still active | **High** | Revocation prepared, irreversible, not run |
| Metadata update authority held by deployer | Medium | Metadata is mutable; not yet revoked |
| No liquidity → no price discovery | Medium | Funding-blocked |
| No third-party audit | Medium | Disclosed on `/token`; none claimed |
| Single deployer key backup | **High** | Local backup exists; offsite copies still needed |
