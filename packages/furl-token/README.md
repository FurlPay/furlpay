# @furlpay/furl-token

Tooling to launch and operate **FURL**, the FurlPay ecosystem/utility token, on
Solana (Token-2022). Devnet-first. Mainnet is gated behind explicit flags, a
fully-populated allocation config, an external audit, and your legal review.

## What FURL is — and is not

FURL is a **utility/ecosystem token**. In this codebase it is deliberately:

- **not** a stablecoin — every payment path settles in **USDC**; FURL is not a unit of account.
- **not** a claim on customer funds, deposits, or FurlPay revenue.
- **not** redeemable by FurlPay for fiat or anything of value.

If FURL ever comes to represent customer funds or a promise of return, it is a
regulated instrument and the assumptions in `src/config.ts` no longer hold —
stop and get legal advice first.

> Code cannot make a token "pump." What this package does is make FURL
> **credible, fixed-supply, transparent, and hard to exploit.** Sustainable
> demand comes from real FurlPay usage, not from mechanics in the mint.

## The five questions (answer before mainnet)

1. **What is FURL?** A utility token for the FurlPay ecosystem.
2. **Why does it need to exist?** Ecosystem rewards / developer & merchant
   incentives / governance / feature access — pick the real ones; don't invent
   utility to manufacture buy pressure.
3. **How many can ever exist?** `maxSupply` in `src/config.ts`, enforced by
   **revoking the mint authority** right after the initial mint.
4. **Who controls supply & treasury?** Mint authority → revoked. Freeze
   authority → `null` (no one can freeze). Treasury/team/liquidity → separate,
   published, multisig wallets.
5. **What creates demand?** More FurlPay usage → more genuine ecosystem demand.

## Design decisions (locked at mint time)

| Property | Value | Why |
|---|---|---|
| Standard | Token-2022 | on-chain metadata without Metaplex; minimal extensions |
| Decimals | 9 | Solana default for non-stables (USDC is 6 — FURL is not USDC) |
| Max supply | fixed (`config.ts`) | hard cap via revoked mint authority |
| Extensions | `metadataPointer`, `tokenMetadata` only | no transfer tax, no permanent delegate, no transfer hook, no default-freeze |
| Freeze authority | `null` | holders cannot be censored |
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
