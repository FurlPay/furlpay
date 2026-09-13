# FURL — Solana Mainnet Launch Record

**Launched:** 2026-09-13 · **Network:** Solana mainnet-beta · **Program:** Token-2022

## Mint
- **Mint address:** `FYatJq71zqvaQNLLtbBy4hQcsV25dMATYfCSVBzV3gY1`
- **Solscan:** https://solscan.io/token/FYatJq71zqvaQNLLtbBy4hQcsV25dMATYfCSVBzV3gY1
- **Decimals:** 6 · **Total supply:** 1,000,000,000 FURL (raw 1,000,000,000,000,000)
- **Mint authority:** `FgeSXvrWcqE93byDoF3Vhwou7XTUhY42cYhs7vXkJPUL` (present — NOT yet revoked)
- **Freeze authority:** null
- **Name / Symbol:** FurlPay / FURL
- **Metadata URI:** https://gateway.irys.xyz/4WYcrbavrRd4BA7Ls61czF8z1cjNg6M3xPdzw24HQgFH
- **Image URI:** https://gateway.irys.xyz/FZZrqRxi2qg8ZN1ER8oh9n7QFGJocchTstNFojkREAkH

## Transactions
- **Create mint:** `3JB9KvNT9M8mnwnYZFKk3S2FwN6ddxrfv6xZ4eMWwh24c3ZcEscmWU8rg1EnNYKQtjXPq2H9ySgtbWX2H5gy7QcC`
- **Distribute (per allocation, all → deployer ATA):**
  - community 400,000,000 FURL — `5uWmYMta9FqcGFFvXvH7gkixTeG2P4Qqjh8crgq8p7sp4VM7STR5e7qgvfretCH494WwWhWDN5PRmVVotjRfuAZ5`
  - liquidity 200,000,000 FURL — `2f66HXq68YcQ595wZEZ2aAHpUPPok6RhHzPQqo58TC3QmNZ1W5Tk31ctnUfkSrKLmvUP7so26XsRB1TfMCZSocjH`
  - treasury 150,000,000 FURL — `2dDCMvgWN1hcWZQJQLSmQwj7oRR8uoqUX329kZSbSr2Hb6bTGW1zGSHYhfF1TVSopRr4mkUXQ5DWoNXZdYQQ88Fx`
  - team 150,000,000 FURL — `3WKMGbf3Ea8PLhzZUdJLafmzJsGKNpfTGoneA3qkZpzB2coU1nF6TJHEERAEAie8mHHK1b4e4jWQbCdWnYCEAbT6`
  - partnerships 50,000,000 FURL — `g3RDbKaUkPWCVUjRbkPpGBG9qcttqSNJu5nWGo83hneFLx9Zxcxwt72Gkki4ctdMmVJfdyGbBwBvbwBz28sdgHA`
  - reserve 50,000,000 FURL — `4MqR5qgtpYrPJqaJozA3QkQr2VRtjzFXQckNADPyL6C6zwDnVMZveKcZHe3CKrUNCC5cU49ZoLv35p3b63vZLSLT`

## Status
- Supply distributed: 100% to deployer ATA `EU2tUJ1CoU8VjTKEuK49FTBv1N2Hk5jpv2589Eq1eZ1S`
  (single-key concentration — migrate to multisig before real distribution).
- **Mint authority NOT revoked** — pending explicit confirmation.
- FURL implements no USD peg, reserves, or redemption; positioned as "intended to operate as" the ecosystem stablecoin.
- No liquidity pool exists; FURL is not tradable and has no market price.

Re-verified against mainnet 2026-09-13: supply 1,000,000,000,000,000 base units,
decimals 6, mint authority present, freeze authority none, source balance equals
the full supply. Jupiter's token API independently reports `holderCount: 1`.

## Product integration
FURL is wired into the web app: `/token` (public reference page with live chain
state), `/api/token/furl`, `/api/token/furl/balance`, FURL checkout on the Solana
Actions path (gated on `FURL_USD_PRICE`, fails closed), and FURL-denominated
merchant checkout sessions. See `docs/FURL.md`.

## Prepared, NOT executed
| Action | Script | Gate |
| --- | --- | --- |
| Migrate supply to six multisigs | `scripts/migrate-allocations.ts` | destinations unset; `--execute --i-understand-this-moves-real-funds` |
| Revoke mint authority | `scripts/revoke-mint-authority.ts` | `--execute --i-understand-this-is-irreversible` |
| FURL/USDC pool configuration | `scripts/liquidity-plan.ts` | no execute path exists |
