# FURL — open decisions

**Prepared 2026-09-13.** Nothing in this document has been executed. Each section
ends with a recommendation; none of them is acted on automatically.

---

## 1. Metadata update authority — keep or revoke?

**Current state (read from chain):** the Token-2022 `TokenMetadata` extension is
present and its update authority is `FgeSXvrWcqE93byDoF3Vhwou7XTUhY42cYhs7vXkJPUL`
— the deployer. Name, symbol, URI and the four additional metadata fields
(`project`, `chain`, `role`, `external_url`) can all still be changed by that key.

The `uri` points at `https://gateway.irys.xyz/4WYcrbavrRd4BA7Ls61czF8z1cjNg6M3xPdzw24HQgFH`,
which returns HTTP 200 `application/json` with name `FurlPay`, symbol `FURL`, and
an image at `…/FZZrqRxi2qg8ZN1ER8oh9n7QFGJocchTstNFojkREAkH` (200, `image/png`,
123,954 bytes). The Arweave data itself is immutable; the POINTER to it is not.

### Option A — keep metadata mutable

**For:** the logo, description and `external_url` can still be corrected. That
matters more than usual here, because none of them has ever been exercised by a
real integration — no wallet, explorer or aggregator has yet rendered FURL from
this metadata in anger, so the first real consumer may well surface a problem.

**Against:** one key can change what the token calls itself. A compromise of the
deployer key is already a total-loss event for the supply; metadata control adds
the ability to make the token impersonate something else on the way out.

### Option B — revoke metadata authority

**For:** immutability. Name, symbol and URI become permanent, which is a genuine
assurance for holders and removes one capability from a compromised key.

**Against:** permanent. A wrong URI, a broken logo, or a future domain change
can never be fixed. Revocation would also lock in `external_url` pointing at
furlpay.com, which is fine today and is an assumption about the next decade.

### Recommendation — **A, keep it mutable, for now**

Two reasons, both about sequencing rather than preference:

1. **The metadata has not been battle-tested.** FURL has one holder, no pool and
   no aggregator rendering it. The first time a wallet or explorer displays this
   token properly is the first real test of the URI and the image, and that has
   not happened. Freezing before that test is freezing something unverified.
2. **It is not the binding risk.** The deployer key already controls 100% of
   supply and the mint authority. Revoking metadata authority while those remain
   is tidying a window while the door is open. The migration and the mint
   revocation are the decisions that actually move the risk needle.

**Revisit when:** the treasury migration is complete AND at least one external
consumer (wallet, explorer, or aggregator) has rendered FURL from this metadata
correctly. Then revoke, in the same session as the mint-authority decision, so
both irreversible acts get one deliberate review rather than two casual ones.

---

## 2. Mint authority — the revocation, when it happens

Not a question of *whether* so much as *when*. The script
(`scripts/revoke-mint-authority.ts`) is prepared and refuses to run without
`--execute --i-understand-this-is-irreversible`, and it pre-flights supply so it
cannot strand unminted tokens.

**Ordering matters:** revoke AFTER the treasury migration, not before. If
anything about the migration proves wrong and needs a re-mint, that option ends
permanently at revocation. The cost of waiting is that "can they print more?"
stays answered by a promise for a few more weeks; the cost of going early is
unrecoverable.

Note that FURL can never become a compliant fiat-backed stablecoin on this mint
regardless — freeze authority is already `null` and cannot be added — so
revoking forecloses less than it appears to.

---

## 3. Squads multisig configuration — **NEEDS HUMAN INPUT**

The thresholds are proposed in `src/treasury.ts`; the **members are not, and
must not be invented.**

| Bucket | Threshold | Members |
| --- | --- | --- |
| Community & ecosystem (40%) | 2 of 3 | **NEEDS HUMAN INPUT** |
| Liquidity (20%) | 2 of 3 | **NEEDS HUMAN INPUT** |
| Treasury (15%) | 3 of 5 | **NEEDS HUMAN INPUT** |
| Team & founders (15%) | 2 of 3 | **NEEDS HUMAN INPUT** |
| Partnerships (5%) | 2 of 3 | **NEEDS HUMAN INPUT** |
| Security & launch reserve (5%) | 3 of 5 | **NEEDS HUMAN INPUT** |

### The questions that must be answered before any multisig is created

1. **Who are the signers?** A 2-of-3 needs three people or three devices that
   will not all be lost together. A one-person project cannot honestly operate a
   2-of-3 — three keys in one drawer is one key with extra steps.
2. **Is there a second human at all?** If every signer is the same person, a
   multisig protects against device loss but not against that person being
   unavailable, coerced, or mistaken. That is still an improvement over today,
   but it should be described accurately rather than as distributed control.
3. **What happens when a signer is lost?** At 2-of-3, one lost key is
   survivable; two is total loss of that bucket. Squads members can be changed
   by the threshold, so recovery means the remaining signers acting in time.
4. **What happens when a signer is compromised?** Same mechanism, opposite
   urgency: the remaining signers must remove the compromised member before the
   attacker reaches the threshold. That is a race, and it needs a plan written
   before it is needed.
5. **Where do the keys live?** Separate hardware, separate locations. Hardware
   wallets are strongly preferred for the 3-of-5 buckets (treasury, reserve).

**A single key must not be able to move any treasury.** With the thresholds
above, none can — but only if the members are genuinely distinct. Verifying that
is a human act, done by reading the member list in the Squads UI, which is
exactly why `create-multisigs.ts` guides and verifies rather than creates.

**Recommendation:** if there is currently only one human with one set of
hardware, start with the two 3-of-5 buckets (treasury, reserve) using three
distinct hardware devices plus two trusted co-signers, and defer the rest until
signers exist. A smaller number of genuinely-distributed multisigs beats six
theatrical ones.

---

## 4. CoinGecko — neither track fits yet

| Track | Requirement | FURL today |
| --- | --- | --- |
| **Live listing** | Active trading on a CoinGecko-tracked exchange | ✗ no pool, no trading |
| **Preview listing** | A clear **scheduled TGE date and time**, verifiable official announcements, and the **exchange(s) where the token will trade** | ✗ TGE already happened (2026-09-13); no scheduled venue or date to announce |

FURL sits in an awkward middle: it is minted and live on-chain, so it is not an
"upcoming token" with a future TGE — but it is not trading anywhere, so it is not
listable live either. **Preview Listing is designed for tokens that have not
launched yet**, and applying with a TGE in the past and no named exchange would
be an application that cannot be evaluated.

**What is ready now:** mint address, decimals, supply endpoint (chain-derived),
logo (Arweave), official URL, explorer links, tokenomics, and the disclosures.

**What is missing, and cannot be fabricated:** a live market, a named exchange,
a trading pair, and a date. All four follow from the pool, which is
funding-blocked.

**Recommendation:** do not submit to either track. Revisit the day a pool exists
and Jupiter returns a route instead of `TOKEN_NOT_TRADABLE`. Submitting earlier
spends a first impression on an application that cannot succeed.

---

## 5. Initial FURL price — still undecided, deliberately

Two planning documents have quoted **$0.20** and **$0.0025** — an 80× spread,
implying a $200,000,000 or a $2,500,000 FDV for the same token. Neither has been
chosen, and neither should be inherited by default.

`scripts/liquidity-plan.ts` now prints a banner when it runs on illustrative
defaults, and takes the price as an argument precisely so the number has to be
entered deliberately. Its price-impact table is the input to this decision: if a
mid-size buy moves the quote double digits, the resulting "price" is not a market
price and the FDV must not be published as a valuation.

**Recommendation:** decide this in the same session that funds the pool, with the
impact table on screen, and write down the reasoning. Not before.
