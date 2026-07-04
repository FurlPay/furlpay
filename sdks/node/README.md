# @furlpay/furlpay-node

Official Furlpay server-side SDK for Node.js / TypeScript — stablecoin payments, wallets, banking, cards, investing, swaps, compliance, and webhook verification.

[![npm](https://img.shields.io/npm/v/%40furlpay%2Ffurlpay-node)](https://www.npmjs.com/package/@furlpay/furlpay-node)

Zero runtime dependencies. Uses native `fetch` (Node 18+). Fully typed.

## Install

```sh
npm install @furlpay/furlpay-node
```

## Quick start

```ts
import { Furlpay } from "@furlpay/furlpay-node";

const furlpay = new Furlpay({ apiKey: process.env.FURLPAY_API_KEY! });

// Safe smart-account balances
const wallet = await furlpay.wallets.retrieve();

// Gas-sponsored USDC transfer on Solana
const { transactionHash, gasSponsored } = await furlpay.wallets.transfer({
  destination: "9x…",
  amount: 25,
  token: "USDC",
  chain: "solana",
  signature: "…",
});
```

## API surface

| Namespace | Methods |
| --- | --- |
| `wallets` | `retrieve()`, `transfer(params)` |
| `banking` | provision virtual accounts by currency |
| `cards` | list cards, update settings/limits |
| `investing` | `portfolio()`, `createOrder({ symbol, side, notional })` |
| `swaps` | cross-chain stablecoin swap quotes |
| `compliance` | KYC identity verification, AML wallet screening |

All methods return typed promises and throw `FurlpayError` (with `statusCode` and the raw error payload) on non-2xx responses.

## Verify webhooks

Mirrors Stripe's `webhooks.constructEvent`. Signatures are HMAC-SHA256 over `"<timestamp>.<raw body>"`, sent as `furlpay-signature: t=<unix>,v1=<hex>`, with a 5-minute replay tolerance and constant-time comparison.

```ts
import { Furlpay } from "@furlpay/furlpay-node";

app.post("/webhooks", express.raw({ type: "application/json" }), (req, res) => {
  let event;
  try {
    event = Furlpay.webhooks.constructEvent(
      req.body,                             // RAW body — not parsed JSON
      req.headers["furlpay-signature"],
      process.env.FURLPAY_ENDPOINT_SECRET!
    );
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "payment.settled") {
    // fulfil the order
  }
  res.json({ received: true });
});
```

Test locally with the CLI:

```sh
npx @furlpay/cli listen --forward-to localhost:3000/webhooks
npx @furlpay/cli trigger payment.settled
```

## Configuration

```ts
new Furlpay({
  apiKey: "sk_sandbox_…",             // required
  baseUrl: "https://api.furlpay.app", // optional override
  fetchImpl: customFetch,             // optional (tests, polyfills)
});
```

## Examples & other SDKs

Runnable examples for Next.js, Express, and more: [furlpay-examples](https://github.com/furlpay/furlpay-examples).
Also available: [Python](https://github.com/furlpay/furlpay-python) · [Go](https://github.com/furlpay/furlpay-go) · [Rust](https://github.com/furlpay/furlpay-rust) — same API shape, same webhook scheme.

## Security

Report vulnerabilities to hello@furlpay.com — please don't open public issues.

## License

MIT
