# @furlpay/furl-token

Tooling to launch and operate **FURL**, the FurlPay ecosystem's USD-denominated
payment currency on Solana (Token-2022). Devnet-first. Mainnet is gated behind
explicit flags, a fully-populated allocation config, an external audit, and your
legal review.

## What FURL is — implementation vs. intent

**Current on-chain implementation** — exactly what the mint provides today:

- a plain Solana **SPL / Token-2022** token,
- **6 decimals** (USD-payment convention, matches USDC on Solana),
- **fixed supply** per the configured mint parameters,
- **no** built-in USD peg, **no** reserves, **no** issuance/redemption mechanism.

**Product intent** — what FURL is meant to become:

- the FurlPay ecosystem's **USD-denominated stablecoin / payment currency** for
  travel purchases, everyday payments, merchant payments and rewards.

These are kept separate on purpose. Choosing 6 decimals makes amounts read like
money; it does **not** create a peg. Until the peg, reserves, redemption and the
matching compliance posture (MiCA e-money-token rules, US stablecoin
legislation) exist and are attested, describe FURL as **"intended to operate as"**
the ecosystem stablecoin — never as a live, reserve-backed, 1:1-redeemable one.
**USDC** remains the external, reserve-backed asset supported for payment and
settlement today.

> Code cannot make a token "pump." What this package does is make FURL
> **fixed-supply, transparent, and hard to exploit.** Sustainable demand comes
> from real FurlPay usage, not from mechanics in the mint.

## Design decisions (locked at mint time)

| Property | Value | Why |
|---|---|---|
| Standard | Token-2022 | on-chain metadata without Metaplex; minimal extensions |
| Decimals | **6** | USD-payment convention; matches USDC on Solana. Irreversible. |
| Max supply | fixed (`config.ts`) | hard cap via revoked mint authority |
| Extensions | `metadataPointer`, `tokenMetadata` only | no transfer tax, no permanent delegate, no transfer hook, no default-freeze |
| Freeze authority | `null` today | holders can't be frozen now; a production stablecoin may need one → new mint |
| Mint authority | revoked after initial mint | supply cannot be inflated |

Banned extensions and the reasons are documented in `src/config.ts`. Several of
these choices are **irreversible** or can only change via a brand-new mint, so
`config.ts` is the source of truth — review it before running anything.

## Scripts

```bash
# 0. run the pure invariant tests (no network)
npm test

# 1. create a local deployer keypair (stored OUTSIDE the repo, prints address)
npx tsx scripts/new-deployer-keypair.ts
export FURL_KEYPAIR=~/.config/solana/furlpay-deployer.json

# 2. DEVNET end-to-end: airdrop, create mint, mint supply, verify, (optional) revoke
npx tsx scripts/devnet-e2e.ts

# --- individual steps (both default to a DRY RUN; add --execute) ---
npx tsx scripts/create-furl-mint.ts --cluster devnet --execute
FURL_MINT=<addr> npx tsx scripts/mint-and-lock.ts --cluster devnet --execute
```

### Mainnet (do not run casually)

Mainnet refuses to start unless every allocation wallet in `config.ts` is set
and `revokeMintAuthorityAfterInitialMint` is true, AND you pass
`--i-understand-this-is-irreversible`. Even then it only creates the mint;
minting supply and revoking authority are separate, deliberate invocations.
Publish the mint address, allocations, vesting and authority state on the
official site before liquidity.

## Key handling (mandatory)

- The deployer secret lives at a file path you pass via `FURL_KEYPAIR` — never
  in the repo, never in `.env`, never in a `NEXT_PUBLIC_*` var.
- `new-deployer-keypair.ts` refuses to write inside the repo and refuses to
  overwrite an existing key.
- Deployer ≠ treasury. Treasury/team/liquidity are separate wallets; use a
  multisig for anything holding value.

## Verified references (2026-09-12)

- Token-2022 program & extensions — https://www.solana-program.com/docs/token-2022
- Metadata pointer + token metadata ordering — https://solana.com/docs/tokens/extensions/metadata
- SetAuthority / permanent revocation — https://solana.com/docs/tokens/basics/set-authority
- USDC canonical addresses — https://developers.circle.com/stablecoins/usdc-contract-addresses
