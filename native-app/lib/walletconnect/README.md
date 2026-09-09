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

## Current state: WIRED

The SDK is installed and `walletkit.ts` implements `WalletConnectTransport`
against it. Pairing, proposals, requests, chain switching and disconnection all
run against the real relay.

`loadWalletKitTransport()` still returns `null` in one case — when
`EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID` is unset. There is no relay to reach
without it, so the screens report "not available in this build" rather than
opening a socket that can only fail. **Set the project id and the feature works.**

| File | Responsibility |
| --- | --- |
| `walletkit.ts` | The only file importing the SDK. The transport class. |
| `codec.ts` | Pure SDK↔domain translation. Imports the SDK `type`-only, so it is testable without native modules. |

The split exists because `walletkit.ts` imports `Core` and `WalletKit` as
**values**, which drags the relay client and its native chain into anything that
imports it — it cannot load under jest-expo at all. `codec.ts` has no runtime
SDK dependency, and `__tests__/codec.test.ts` covers every translation branch.

## Configuration

### 1. Relay project id

Create a project at <https://dashboard.reown.com>. The id is not a secret — it
is a public routing identifier in the relay URL — but it is required.

| Variable | Where | Purpose |
| --- | --- | --- |
| `EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID` | `native-app/.env` | Read into the app at build time; the relay connection itself |
| `FURLPAY_WALLETCONNECT_PROJECT_ID` | Vercel (web) | Gates the `wallet_connect` client flag server-side |

Both are needed and they do different jobs. The client one makes the connection
possible; the server one is what `apps/web/src/lib/clientFlags/registry.ts`
checks before reporting the flag `on` — which is what stops the feature
appearing in a deployment nobody configured.

### 2. Flip the flag

`FURLPAY_FLAG_WALLET_CONNECT=true` once the project id is set.
`FURLPAY_KILL_WALLET_CONNECT=1` is the ten-second stop lever and outranks
everything, including the override.

## Entry points

A pairing URI reaches the engine three ways, and all three are wired:

- **QR** — `app/scan.tsx` checks `looksLikePairingUri` *before* the address
  parser. Placed last, every dApp QR would fall through and be reported as "not
  payable", which is true and useless.
- **Paste** — the same screen's manual-entry sheet, and the "paste connection
  link" button on `/walletconnect`. Desktop dApps offer "copy link" beside the QR.
- **Deep link** — `app/_layout.tsx` handles both `getInitialURL` (cold start,
  FurlPay was not running) and the `url` event (warm). Scoped to `signedIn`:
  pairing grants a dApp access to an ADDRESS, and there is none before sign-in.

All three navigate to `/walletconnect` **before** pairing, because the proposal
arrives asynchronously and the approval sheet has to be mounted to receive it.

## Import order in `index.js` is load-bearing

`@walletconnect/react-native-compat` must be the **first import in the
process**. It installs globals the relay client assumes at module scope —
TextEncoder/TextDecoder, Buffer, URL. Imported later, `WalletKit.init()` fails
with errors naming none of that, and pairing dies inside a minified bundle.

Our own `lib/cryptoPolyfill` runs after it deliberately: every assignment there
is guarded by a `typeof` check, so it fills what the compat layer left rather
than fighting it.

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
