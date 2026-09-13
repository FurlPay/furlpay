# FURL custody architecture — research, options, and cost

**Prepared 2026-09-13. Nothing in this document has been executed.** No Squad was
created, no vault, no ATA, no transaction signed or submitted, no keypair loaded.

Status of every claim below is marked: **RESEARCHED** (from current official
docs), **PLANNED** (designed, not built), **DRY-RUN VERIFIED** (executed offline
against real data), or **NEEDS APPROVAL**.

---

## 1. Correction to the previous phase

The last report said the treasury migration was "NOT funding-blocked" because
the transfers cost ~0.032266 SOL against a 0.048203 SOL balance.

**That was incomplete and the conclusion was wrong.** It costed the six
`transferChecked` legs and their ATA rents — but not the creation of the
multisigs those legs send *to*. Squads V4 charges a **0.1 SOL deployment fee per
multisig**, which is more than the deployer's entire balance on its own.

Corrected: **every custody architecture is funding-blocked today.** The cheapest
viable one is short by ~0.087 SOL; the six-multisig design is short by ~0.60 SOL.
The shortfall is small in absolute terms — tens of dollars — but it is real, and
the previous phase should not have implied otherwise.

---

## 2. Squads V4 — **RESEARCHED**

Verified against current official documentation (docs.squads.so), 2026-09-13.
V2 documentation was not used.

| Property | Value |
| --- | --- |
| Mainnet program ID | `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf` |
| Deployment fee | **0.1 SOL, one-time, per multisig** |
| Account funding | 0.001 SOL |
| Network rent | ~0.0018 SOL |
| **Total per multisig** | **~0.1028 SOL** |
| Initial members | up to **10** at creation; more addable later by multisig approval |
| Threshold guidance | avoid 1-of-N (single point of failure); avoid N-of-N (one lost key locks the treasury). 2-of-3 and 3-of-5 are the cited reasonable shapes |
| V4 additions | time locks, spending limits, roles, **sub-accounts**, multi-party payments, address lookup tables |

### The decisive finding: one multisig can hold many vaults

A Squads V4 multisig has **multiple vaults, indexed 0, 1, 2, …**. Each vault is a
PDA derived from the multisig address plus its index. Vaults are *not* owned by
the Squads program — they behave as ordinary wallets that can send and receive,
and each has its own distinct address.

```
vaultPda = getVaultPda({ multisigPda, index })   // index 0, 1, 2, ...
```

This matters directly: **six separately-addressed, independently auditable
destinations do not require six multisigs.** One multisig with six vaults gives
six distinct on-chain addresses, six distinct Token-2022 ATAs, and six separately
verifiable balances — for one 0.1 SOL deployment fee instead of six.

**Vaults do not require separate creation or funding.** A vault PDA is derived,
not deployed; it becomes a real account when something is sent to it. The FURL
ATA under each vault does cost rent (~0.00203928 SOL each), and that cost is
already inside the migration estimate and is identical across every architecture.

---

## 3. Architecture options — **PLANNED**

Costs below are deployment only; all four then add the same ~0.032266 SOL
migration (six transfers + six ATA rents + fees + priority headroom).

### A. Six separate Squads — one per allocation

| | |
| --- | --- |
| Deployment | 6 × 0.1028 = **0.6168 SOL** |
| Total with migration | **0.6491 SOL** |
| Shortfall today | **0.6009 SOL** |
| Signer sets | up to 6 distinct |
| Keys required | 18–30 depending on thresholds |
| Blast radius | **Smallest** — compromising one signer set reaches one bucket |
| Operational complexity | **Highest** — six member lists, six thresholds, six recovery plans |
| Recovery complexity | Six independent procedures to maintain and rehearse |
| Separation of duties | **Strongest** — team and treasury need not share signers |
| Accounting clarity | Excellent — one multisig per bucket |
| Migration complexity | Six destinations to verify before sending |
| Liquidity implications | Liquidity multisig can be given its own signer set and spending limits |

### B. Four security domains

Treasury+Reserve · Community+Partnerships · Team · Liquidity

| | |
| --- | --- |
| Deployment | 4 × 0.1028 = **0.4112 SOL** |
| Total with migration | **0.4435 SOL** |
| Shortfall today | **0.3953 SOL** |
| Signer sets | 4 |
| Blast radius | Moderate — a compromise reaches one domain (worst case 20% of supply) |
| Operational complexity | Moderate |
| Separation of duties | Good — team is isolated from treasury, liquidity from both |
| Accounting clarity | Good, if each domain uses separate vault indices per bucket |
| Migration complexity | Four destinations, six vaults |

Grouping rationale: treasury and reserve share a risk profile (cold, rarely
signed, highest threshold). Community and partnerships share one (distribution
outflows). Team must be isolated because its incentives differ from every other
bucket. Liquidity must be isolated because it is the only bucket that will
routinely interact with a DEX program.

### C. One Squad, six vaults

| | |
| --- | --- |
| Deployment | 1 × 0.1028 = **0.1028 SOL** |
| Total with migration | **0.1351 SOL** |
| Shortfall today | **0.0869 SOL** |
| Signer sets | 1 |
| Keys required | 3–5 |
| Blast radius | **Largest** — clearing the threshold once reaches **all six vaults, 100% of supply** |
| Operational complexity | **Lowest** — one member list, one threshold, one recovery plan |
| Recovery complexity | One procedure |
| Separation of duties | **None** — the same signers control team, treasury and liquidity |
| Accounting clarity | Good — six distinct vault addresses, independently auditable |
| Migration complexity | Lowest — one multisig to verify, six vault addresses to derive |
| Liquidity implications | Liquidity operations are signed by the same set that controls the treasury |

**The honest summary of C:** it solves the *key-redundancy* problem (no single
key can move funds) but not the *separation-of-duties* problem (one signer set
still controls everything). That is a large improvement over today and a real
limitation.

---

## 4. Recommendation — **NEEDS APPROVAL**

### Recommended: **B, reduced to three domains initially**

**Treasury+Reserve (3-of-5) · Team (2-of-3) · Community+Partnerships+Liquidity (2-of-3)**

Deployment 3 × 0.1028 = **0.3084 SOL**; with migration **0.3407 SOL**.

Reasoning, in order of weight:

1. **Blast radius is the property actually being bought.** The Critical finding
   is that one key controls everything. Architecture C reduces that to "one
   signer *set* controls everything" — genuinely better, but a single successful
   social-engineering or supply-chain attack against that set still reaches 100%
   of supply. Splitting into three domains caps the worst case at 20% (liquidity
   group holds the most at 20%+40%+5% — see the caveat below).
2. **Team must be isolated on principle.** Team tokens vest to the same people
   who would be signing treasury transactions. A structure where the team can
   reach its own unvested allocation without an independent party is the thing
   token-holders are entitled to object to, and it costs 0.1 SOL to avoid.
3. **Liquidity will touch external programs.** The liquidity bucket is the only
   one that will sign against a DEX. Program interaction is a different and
   larger risk surface than a transfer, and it should not share a signer set with
   the cold reserve.

**Caveat on the three-domain grouping:** putting community (40%), partnerships
(5%) and liquidity (20%) together creates a 65% domain, which undercuts point 1.
If the budget allows four deployments, split liquidity out — that is the single
highest-value additional 0.1 SOL, giving Treasury+Reserve (20%), Team (15%),
Community+Partnerships (45%), Liquidity (20%).

### Why not A

Six is the best blast radius and the worst operational reality. Six member lists,
six thresholds and six rehearsed recovery procedures is a real ongoing burden,
and an unrehearsed recovery procedure is not a recovery procedure. Six separately
managed multisigs for a project with — as far as this repository shows — one
active operator would be six structures maintained in theory.

### Why not C, despite being 3× cheaper

Cost is not the deciding input here, and the brief is explicit about not choosing
on price. C is the right answer only if the honest answer to the signer question
(§5) is that there is exactly one human and no realistic co-signers. In that case
C is not merely cheaper — it is the only structure that is not theatre.

---

## 5. Signer specification — **NEEDS HUMAN INPUT**

No signer identities are invented. This is the specification they must satisfy.

### Per-multisig requirements

| Domain | Members | Threshold | Hardware required | Geographic separation |
| --- | --- | --- | --- | --- |
| Treasury + Reserve | 5 | **3-of-5** | **Yes — all five** | Yes, at least 2 sites |
| Team | 3 | **2-of-3** | Yes for ≥2 | Preferred |
| Community + Partnerships | 3 | **2-of-3** | Yes for ≥2 | Preferred |
| Liquidity (if split) | 3 | **2-of-3** | Yes for ≥2 | Preferred |

Thresholds follow current Squads guidance: never 1-of-N (a single point of
failure, i.e. today's problem with extra steps), never N-of-N (one lost key
permanently locks the bucket).

### The question that decides everything

> **How many independent humans will actually hold keys?**

**If the answer is one:** a multisig whose keys are all controlled by one person
is **NOT independent multi-party custody.** It is key redundancy — protection
against losing a single device, and nothing more. It does not protect against
that person being compromised, coerced, incapacitated, or mistaken, because
every key falls to the same attack. Three hardware wallets in one drawer is one
key with extra steps, and describing such a structure publicly as "multisig
secured" would be the same category of overstatement as the "2-of-2 MPC" claim
this repository already had to correct.

That is not an argument against doing it — key redundancy is still a large
improvement over one hot key — but it must be described accurately, internally
and publicly.

### Failure scenarios each configuration must answer

| Scenario | 3-of-5 | 2-of-3 |
| --- | --- | --- |
| One signer loses a device | Survivable: 3 of remaining 4 sign, then replace the member | Survivable: remaining 2 sign, then replace |
| Two signers lose devices | Survivable: exactly 3 remain | **Total loss of that bucket** |
| One signer compromised | Remaining signers must remove them **before** the attacker finds a second key — a race, needing a pre-written plan | Same, with less margin |
| One signer permanently unavailable | Survivable | Survivable, but the multisig is then effectively 2-of-2 — replace immediately |

### Rules

- **Same person on multiple hardware wallets ≠ independent security.** State the
  real number of humans in any public description.
- **No signer key shared across critical multisigs.** A key on both Treasury and
  Team collapses the separation those two structures exist to create.
- **Every member must be identifiable by name before creation.** A member address
  nobody can attribute is an unexplained party with signing power.
- **Recovery must be rehearsed before funding**, not documented and assumed.
- **Test with a trivial amount first.** Send a token dust amount through the full
  propose→approve→execute flow before any allocation is migrated.

---

## 6. Exact cost model — **DRY-RUN VERIFIED** (arithmetic, offline)

| Component | SOL |
| --- | --- |
| Current deployer balance | **0.048203** |
| Migration transactions (6 transfers + 6 ATA rents + fees + headroom) | 0.032266 |
| Squads deployment, per multisig | 0.102800 |
| Operational reserve (recommended) | 0.050000 |

| Architecture | Deploy | + Migration | + Reserve | **Minimum** | **Shortfall** |
| --- | ---: | ---: | ---: | ---: | ---: |
| A — six Squads | 0.6168 | 0.6491 | 0.6991 | 0.6991 | **0.6509** |
| B — four domains | 0.4112 | 0.4435 | 0.4935 | 0.4935 | **0.4453** |
| **B3 — three domains (recommended)** | 0.3084 | 0.3407 | 0.3907 | **0.3907** | **0.3425** |
| C — one Squad | 0.1028 | 0.1351 | 0.1851 | 0.1851 | **0.1369** |

**Reason for the shortfall, precisely:** the 0.1 SOL Squads deployment fee is
charged per multisig and exceeds the entire current balance (0.048203 SOL) even
once. The migration transfers themselves remain affordable; the custody
infrastructure they send into is not.

At ~$200/SOL the recommended architecture needs roughly **$78 of SOL**, of which
~$69 is currently missing. This is the smallest funding requirement in the whole
project and it gates the only Critical finding.

---

## 7. Migration sequence — **PLANNED**, not executed

Each step must complete and be independently verified before the next begins.

1. **Approve the signer architecture** — §5 answered, members named. *(no chain)*
2. **Fund the deployer** with the architecture's minimum + reserve. *(inbound only)*
3. **Deploy the Squads** via the Squads app, reading each member address aloud.
4. **Verify each Squad on-chain** — program owner is `SQDS4ep…52pCf`, threshold
   and member list match what was approved, no extra member.
5. **Derive and verify vault addresses** for every allocation index.
6. **Derive the Token-2022 ATA** for each vault; confirm the ATA derives under
   Token-2022, not legacy SPL.
7. **Dust test**: send a trivial FURL amount to one vault, then move it back out
   through the full propose→approve→execute flow. An untested multisig is an
   assumption.
8. **Paste destinations into `src/treasury.ts`**, run `plan:multisigs --verify`.
9. **Run the migration dry run**; require **all 20 gates green**.
10. **Execute the migration** with `--execute --i-understand-this-moves-real-funds`.
11. **Verify every balance** on-chain against the published allocation.
12. **Verify circulating supply** still reports 0 with the new issuer registry.
13. **Only then** revoke mint authority (§8).
14. **Separately** decide metadata authority (§9).
15. **Only later** consider liquidity, with pricing decided deliberately.

---

## 8. Mint authority — **NEEDS APPROVAL**, keep ACTIVE for now

Unchanged this phase: mint authority remains
`FgeSXvrWcqE93byDoF3Vhwou7XTUhY42cYhs7vXkJPUL`.

**The ordering principle is absolute: MIGRATION → VERIFY EVERYTHING → THEN
REVOKE.** Revoking before verified migration removes the ability to re-mint if
the migration proves wrong, and there is no recovery from that combination.

Requirements for the future revocation (script prepared, never run):

- assert the mint is `FYatJq71…V3gY1`
- assert the owning program is Token-2022
- assert the current authority equals the expected deployer
- assert the loaded signer equals that authority
- assert supply is exactly 1e15 base units (revoking early strands the remainder)
- print the exact instruction, accounts and serialized transaction
- dry-run by default; require `--execute --i-understand-this-is-irreversible`
- verify the postcondition `mintAuthority === null` after landing

**Revocation is permanent.** There is no instruction that restores an authority
set to `None`. Any future issuance would require a new mint and a public
migration.

---

## 9. Metadata authority — **NEEDS APPROVAL**, keep ACTIVE

Update authority remains the deployer, so **metadata is mutable — the token is
not immutable and must not be described as such.** Standard is native Token-2022
`MetadataPointer` + `TokenMetadata`; this is **not** Metaplex and no Metaplex
migration is appropriate.

Recommendation unchanged: **keep mutable.** The URI has not yet been rendered by
a single external consumer — no wallet, explorer or aggregator has displayed FURL
from this metadata in anger — and freezing an untested pointer freezes something
unverified.

Checklist for when revocation becomes appropriate:

- [ ] Treasury migration complete and verified
- [ ] At least two external consumers (wallet + explorer, or aggregator) render
      name, symbol and logo correctly from the on-chain metadata
- [ ] Arweave URI confirmed resolving from more than one gateway
- [ ] `external_url` confirmed as the long-term domain
- [ ] No pending correction to name, symbol, description or image
- [ ] Decision taken in the same session as the mint-authority revocation, so
      both irreversible acts get one deliberate review

---

## 10. Which risk each step reduces

| Step | Risk reduced | From → to |
| --- | --- | --- |
| Fund deployer | none directly — unblocks everything below | — |
| Deploy Squads + migrate | **CRITICAL: 100% under one key** | Critical → Medium (one signer *set*, or Low with real separation) |
| Dust test before migrating | prevents a new failure: funds into an unusable structure | — |
| Verify balances + circulating | prevents silent misallocation and supply misreporting | — |
| Revoke mint authority | **HIGH: unlimited issuance possible** | High → eliminated |
| Offsite encrypted key backups | **HIGH: single local backup** | High → Low |
| Revoke metadata authority (later) | MEDIUM: metadata mutable | Medium → eliminated |
| Third-party audit | MEDIUM: no external review | Medium → Low |

Note that **preparation reduces nothing.** Every risk above stays exactly where
it is until the corresponding step is actually executed.
