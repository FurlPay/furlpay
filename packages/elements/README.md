# @furlpay/elements

Embeddable Furlpay UI widgets for React — drop-in stablecoin checkout and secure card credential display.

[![npm](https://img.shields.io/npm/v/%40furlpay%2Felements)](https://www.npmjs.com/package/@furlpay/elements)

## Install

```sh
npm install @furlpay/elements
```

Peer dependencies: `react >= 18`, `react-dom >= 18`.

## `<FurlpayCheckoutButton />`

A drop-in checkout button that handles wallet connection and stablecoin transaction signing. You render it and listen for `onSuccess` — no chain logic in your app.

```tsx
import { FurlpayCheckoutButton } from "@furlpay/elements";

<FurlpayCheckoutButton
  amount={25}
  token="USDC"                       // "USDC" | "USDT" | "EURC" | "PYUSD"
  publishableKey={process.env.NEXT_PUBLIC_FURLPAY_PK!}
  onSuccess={({ transactionHash, amount }) => markPaid(transactionHash)}
  onError={(err) => toast.error(err.message)}
  label="Pay $25"                    // optional custom label
/>
```

| Prop | Type | Notes |
| --- | --- | --- |
| `amount` | `number` | required |
| `publishableKey` | `string` | required — `pk_...`, safe for the browser |
| `token` | `"USDC" \| "USDT" \| "EURC" \| "PYUSD"` | default `"USDC"` |
| `currency` | `string` | default `"USD"` |
| `onSuccess` | `({ transactionHash, amount }) => void` | fires after a signed, settled payment |
| `onError` | `(err: Error) => void` | |
| `baseUrl` | `string` | default `https://api.furlpay.app` |
| `label` | `string` | custom button text |

## `<FurlpaySecureCardInput />`

Securely display virtual card credentials (PAN/CVV) without them ever entering your application state.

## Server-side pairing

Elements handles the client; verify and fulfil on the server with [`@furlpay/furlpay-node`](https://www.npmjs.com/package/@furlpay/furlpay-node) webhooks. A complete Next.js App Router flow (button → route handler → verified webhook) is in [furlpay-examples/nextjs-checkout](https://github.com/furlpay/furlpay-examples/tree/main/nextjs-checkout).

## Security

Publishable keys (`pk_...`) are browser-safe; never ship secret keys (`sk_...`) to the client. Report vulnerabilities to hello@furlpay.com.

## License

MIT
