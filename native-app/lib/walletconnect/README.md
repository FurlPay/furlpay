# WalletConnect

FurlPay is the **wallet** side of WalletConnect v2: dApps propose sessions, the
user approves, dApps send requests, the user signs. There is no "connect to a
wallet" flow anywhere in this directory.

## What is here, and what is not

Everything in this directory is FurlPay's own code and runs without any
WalletConnect package installed:

| File | Responsibility |
| --- | --- |
| `uri.ts` | Parse and validate `wc:` pairing URIs from QR, deep link or clipboard |
| `types.ts` | Domain model (proposals, sessions, requests) — no vendor types |
| `policy.ts` | **The security boundary.** Which chains/methods may be granted, and CAIP-25 namespace negotiation |
| `requests.ts` | Decode untrusted JSON-RPC params into something renderable |
| `store.ts` | Local mirror of live sessions, for instant render and revocation |
| `engine.ts` | Lifecycle: pair → negotiate → approve → route → respond → disconnect |
| `runtime.ts` | The process singleton, and the wiring from a decoded request to a real signature |
| `transport.ts` | The seam to the SDK, plus `MemoryTransport` for tests |

**Not here:** the relay client, the socket, the X25519/ChaCha20 session crypto.
Those come from the WalletConnect SDK, behind `WalletConnectTransport`.

## Why the SDK is behind a seam

The same reasoning as `lib/observability`'s `Transport`, and it has already paid
for itself once:

1. **The SDK has been renamed twice** — `@walletconnect/web3wallet` →
   `@reown/walletkit`, with a changed API each time. None of the code above
   names a vendor type, so a third rename is one adapter file.

2. **It cannot be validated here.** `@reown/walletkit` pulls in
   `@walletconnect/react-native-compat`, which needs
   `react-native-get-random-values` and
   `@react-native-async-storage/async-storage` — native modules. This repo is
   developed on Windows with no attached device. Domain logic importing the SDK
   directly could not be unit tested at all, so the parts of this feature most
   likely to contain a security bug would be the parts with no coverage.

With the seam, `MemoryTransport` drives the entire pair → propose → approve →
request → sign → disconnect sequence in Jest. See `__tests__/engine.test.ts`.

## Current state

`loadWalletKitTransport()` resolves `./walletkit` dynamically and returns `null`
when the module or the SDK is absent. **That file does not exist yet**, so a
build today reports `walletConnectUnavailableReason() === "no_sdk"` and the
WalletConnect screens say the feature is not available in this build. That is
true, and it is the honest state — no screen pretends to connect.

## Turning it on

### 1. Install the SDK

```
cd native-app
npx expo install @reown/walletkit @walletconnect/core @walletconnect/react-native-compat \
  @react-native-async-storage/async-storage react-native-get-random-values
```

`@walletconnect/react-native-compat` **must be imported first, before any other
import**, in `index.js`. It installs the global polyfills the relay client
assumes; importing it late means the crypto shims are missing when the client
initialises and pairing fails with an error that does not name the cause.

Per AGENTS.md rule 11, confirm each package on npm before installing and commit
`package-lock.json` with the change.

### 2. Get a relay project id

Create a project at <https://dashboard.reown.com>. The project id is not a
secret — it is a public routing identifier that appears in the relay URL — but
it is required, and pairing fails without it.

### 3. Environment

| Variable | Where | Purpose |
| --- | --- | --- |
| `EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID` | `native-app/.env` | Relay project id, read at build time into the app |
| `FURLPAY_WALLETCONNECT_PROJECT_ID` | Vercel (web) | Same value; gates the `wallet_connect` client flag server-side so the app does not reveal a screen that cannot connect |

Both are needed. The client one makes the connection possible; the server one is
what `apps/web/src/lib/clientFlags/registry.ts` checks before reporting the flag
`on`, which is what stops the feature appearing in a deployment that has not
been configured.

### 4. Write `walletkit.ts`

Create `lib/walletconnect/walletkit.ts` exporting
`createWalletKitTransport(): WalletConnectTransport`. It must:

- `Core` + `WalletKit.init` with the project id and FurlPay's metadata
- Map `session_proposal` → `TransportEvents.onProposal`, translating the SDK's
  `requiredNamespaces` / `optionalNamespaces` into flat `requiredChains`,
  `optionalChains`, `requiredMethods`, `optionalMethods`
- Map `session_request` → `onRequest`, `session_delete` → `onSessionDeleted`
- Carry `verifyContext` into `DappMetadata.verified` — **this is the
  anti-phishing signal**. `metadata.url` is what the dApp claims about itself; a
  clone puts the real dApp's URL there. `verified.origin` is what the relay
  observed. When they disagree the UI must say so.
- Return sessions from `getActiveSessions()` out of `init()`, so session restore
  needs no network round trip

Nothing else in this directory changes.

### 5. Flip the flag

`FURLPAY_FLAG_WALLET_CONNECT=true` in the deployment, once the project id is
set. `FURLPAY_KILL_WALLET_CONNECT=1` is the ten-second stop lever and outranks
everything, including the override.

## The security properties worth not breaking

These are enforced by code and pinned by tests. If a change makes one of them
false, the test that fails is telling you something.

- **Approve the intersection, never the request.** `negotiateNamespaces` grants
  the intersection of what the dApp asked for and what this wallet supports. The
  tempting alternative — echoing the proposal back so every dApp works first try
  — grants a malicious proposal exactly what it asked for.
- **A required chain we cannot serve rejects the session.** Approving while
  silently dropping it produces a dApp that believes it has a network and finds
  out mid-transaction.
- **`eth_sign` is refused, required or optional.** It signs an arbitrary digest
  with no domain separation, so a dApp can hand over the hash of a transfer and
  have the user "sign a message".
- **Four gates on every request, in order:** authorize against the grant, decode,
  scan, ask a human. No auto-approve, no trusted-dApp list, no remembered
  decision — each of those converts a permission granted once into a permission
  covering transactions never seen.
- **A decode failure is a rejection.** Showing raw hex and asking the user to
  decide is a confirmation screen that cannot describe what it confirms.
- **One pending request at a time.** Two signature sheets racing on one screen is
  how a user approves the second while looking at the first.
- **The `symKey` never reaches SQLite, a log, or an analytics property.** It
  decrypts everything on the pairing topic. `describePairingUri()` is the
  loggable form and it redacts the key entirely — a prefix is still key material.
