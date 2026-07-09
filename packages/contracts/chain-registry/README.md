# FurlPay Chain — EIP-155 Chain ID Registration (7402)

Prepared submission for the community chain registry at
[ethereum-lists/chains](https://github.com/ethereum-lists/chains). Chain ID
**7402** was verified unclaimed against `chainid.network/chains_mini.json` on
2026-07-09 — re-verify immediately before opening the PR, since IDs are
first-come-first-served.

## Differences from the internal playbook draft

- **Filename** is `eip155-7402.json` (hyphen). The `eip155:7402.json` form in
  the playbook is not accepted by the repo tooling (and is an invalid filename
  on Windows).
- **`slip44: 1` removed** — coin type 1 denotes a testnet; this entry is for
  mainnet.
- **`decimals: 18` is intentional** even though USDC is 6-decimal on parent
  chains: Arbitrum Orbit normalizes a custom gas token to 18 decimals on the
  child chain, and the registry describes the child chain.
- **`parent`** declares the chain as an L3 settling to Arbitrum One
  (`eip155-42161`) with the canonical bridge URL.
- **Explorer `standard: "EIP3091"`** — required for wallets to deep-link
  transactions; Blockscout (the default Orbit explorer) is EIP-3091 compliant.

## Submission checklist (do this only at L3 launch time)

The registry CI **checks that RPC endpoints respond** and return the declared
chain ID, so this PR can only merge once the chain is actually live.

1. Confirm `https://rpc.furlpay.com` answers `eth_chainId` with `0x1cea` (7402).
2. Fork `ethereum-lists/chains`, copy this file to `_data/chains/eip155-7402.json`.
3. Add the icon: `_data/icons/furlpay.json` pointing at an IPFS-pinned 512x512
   PNG (the `"icon": "furlpay"` reference fails CI without it).
4. `npx prettier --write _data/chains/eip155-7402.json _data/icons/furlpay.json`
5. Run the repo checks locally: `./gradlew run`.
6. Open the PR and wait for GitHub Actions to go green.

No fee — the registry is a free, open-source PR.
