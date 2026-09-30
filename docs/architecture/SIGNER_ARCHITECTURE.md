# Signer architecture (mobile)

**FurlPay has no hardware-wallet support.** This document describes the seam that lets one be added without rewriting transaction flows. Nothing here is a Ledger, Trezor or Tangem integration, and none has been started.

## 1. The interface

`native-app/lib/signing/types.ts` → `AccountSigner`

| Member | Required | Notes |
|---|---|---|
| `kind`, `label` | yes | `device-key`, `ledger`, `trezor`, `tangem`, `keystone`, `onekey`, `walletconnect`, `mpc` |
| `capabilities()` | yes | `trustedDisplay`, `clearSigning`, `eip712`, `eip1559`, `prehashedOnly`, `presence`, `supportedChainIds` |
| `getAddress({ displayOnDevice })` | yes | |
| `signTransaction(tx)` | yes | EIP-1559; returns raw + hash + `from` |
| `signMessage(message)` | **optional** (added Sep 30 2026) | EIP-191 |
| `signTypedData(payload)` | **optional** (added Sep 30 2026) | EIP-712; also requires `capabilities().eip712` |
| `connection` | optional | Absent means "nothing to manage", never "unavailable" |

Helpers: `requireOwnConfirmation(signer)` (true when the signer has no trusted display — the app's confirmation is then the only one), `supportsChain`, and `signMessageWith` / `signTypedDataWith`, which **refuse** with `SignerUnavailable` when a signer lacks the method rather than falling back to another key.

## 2. Registry

`native-app/lib/signing/registry.ts` — `registerSigner`, `getSigner`, `listSigners`, `defaultSigner()` (always the on-device key; the signer follows the account the user chose, never "the most secure paired device"), and the device-key signer cannot be unregistered.

## 3. Implementations today

| Signer | File | State |
|---|---|---|
| On-device key | `lib/signing/deviceKeySigner.ts` → `lib/wallet.ts` | Live in the app. BIP-39 mnemonic in SecureStore (Keystore/Keychain), biometric-gated read |
| MPC (agents) | `lib/signing/mpcSigner.ts`, `remoteMpcBackend.ts` | Server-side via FurlPay → Turnkey; the app holds no MPC credential |
| Hardware | — | None |

## 4. Call sites routed through the seam

| Flow | Before | After (Sep 30 2026) |
|---|---|---|
| Swaps | signer abstraction | unchanged |
| WalletConnect `personal_sign` | `lib/wallet.signMessage` directly | `signMessageWith(defaultSigner(), …)` |
| WalletConnect typed data | `lib/wallet.signTypedData` directly | `signTypedDataWith(defaultSigner(), …)` |
| WalletConnect transactions | `lib/wallet.signTransaction` directly | `defaultSigner().signTransaction` |
| WalletConnect address | `addressForSigning` | `defaultSigner().getAddress()` |
| NFT transfer (`app/nft/[id].tsx`) | `lib/wallet.signTransaction` directly | `defaultSigner().signTransaction` |
| Staking (`app/staking.tsx`) | `lib/wallet.signTransaction` directly | `defaultSigner().signTransaction` |
| **Gasless send** (`lib/send/useSend.ts` → `sendGasless`) | EIP-3009 authorisation signed inside `lib/wallet` | **Unchanged — remaining coupling.** It signs a `transferWithAuthorization` typed-data digest, not a transaction; moving it means expressing the authorisation as `signTypedData` through the seam, which changes the money path's code and deserves its own reviewed change |

Read-only uses of `lib/wallet` (`getKnownAddress`, `getAddress`, `hasWallet`, `deleteWallet`) are not signing and stay direct.

The change is behaviour-preserving: `native-app/lib/__tests__/signerMessageRouting.test.ts` asserts the signatures are **byte-identical** to the direct calls, and that a signer without the capability refuses.

## 5. Adding a hardware signer — what it would take

1. A vendor SDK confirmed to exist on npm (AGENTS rule 11) and a physical device to test against.
2. A class implementing `AccountSigner` with honest `capabilities()` (e.g. Tangem: `trustedDisplay: false`, `prehashedOnly: true` — callers may refuse it for large amounts).
3. `registerSigner(...)` after pairing; a `DeviceConnection` for signers with a persistent link.
4. Account-to-signer binding in the UI so the user picks which account signs.
5. The contract tests in `native-app/lib/__tests__/signing.test.ts` pass for the new signer.
6. `HARDWARE_WALLET_LIVE` (web money flag) turned on only after the above ship.
