# @furlpay/account-kit

Furlpay smart-contract SDK — deploy Safe smart accounts from passkeys, configure gas sponsorship, and manage time-locked pre-authorization escrows.

[![npm](https://img.shields.io/npm/v/%40furlpay%2Faccount-kit)](https://www.npmjs.com/package/@furlpay/account-kit)

The on-chain layer behind Furlpay wallets, exposed programmatically:

- **Safe / ERC-4337 smart accounts** deployed from Passkey (WebAuthn) signers — no seed phrases
- **Paymaster** — sponsor gas outright or bill it in USDC/EURC against a developer balance
- **Escrow** — time-locked pre-authorization holds (authorize → capture/release), the on-chain equivalent of a card auth

A built-in mock provider (`mock: true`, the default) exercises the full lifecycle with no chain, RPC, or funds — ideal for tests and CI.

## Install

```sh
npm install @furlpay/account-kit
```

## Quick start

```ts
import { AccountKit } from "@furlpay/account-kit";

const kit = new AccountKit({ chain: "base" }); // mock mode by default

// 1. Deploy a Safe controlled by a device passkey
const safe = await kit.deploySafe([
  { credentialId: "cred_1", publicKey: "0x04ab…" },
]);

// 2. Sponsor its gas
await kit.configurePaymaster(safe.address, { mode: "sponsor" });
// …or bill gas in USDC:
await kit.configurePaymaster(safe.address, { mode: "erc20", feeToken: "USDC" });

// 3. Pre-authorize, then capture (or release) like a card auth
const hold = await kit.escrow.create(safe.address, merchantAddress, 120);
await kit.escrow.capture(hold, 87.5);   // capture ≤ authorized amount
// await kit.escrow.release(hold);      // or release the hold
```

## Why escrow matters for AI agents

Escrow holds are the primitive for **bounded agent spending**: fund a hold an agent can draw against, capped and expiring, revocable by the owner. See the [agent-allowances issue](https://github.com/FurlPay/furlpay-account-kit/issues/1) and the [spend-mandates RFC](https://github.com/FurlPay/furlpay-x402/issues/1).

## Supported chains

`ethereum` · `polygon` · `base` (default) · `arbitrum` · `gnosis`

## Going live

Pass `mock: false` with `rpcUrl` and `bundlerUrl` to submit real UserOperations through your bundler.

## Security

Report vulnerabilities to hello@furlpay.com — please don't open public issues.

## License

MIT
