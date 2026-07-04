# @furlpay/ui

Furlpay's shared design system — dark-mode design tokens, primitives, and financial asset logos for React.

[![npm](https://img.shields.io/npm/v/%40furlpay%2Fui)](https://www.npmjs.com/package/@furlpay/ui)

This is the internal design system used across Furlpay surfaces (web app, extension, Elements). Published so integrators building custom UIs can match Furlpay's look, and so [`@furlpay/elements`](https://www.npmjs.com/package/@furlpay/elements) has a consistent foundation.

## Install

```sh
npm install @furlpay/ui
```

Peer dependency: `react >= 18`.

## What's inside

### Design tokens

Dark-mode-first color, spacing, radius, and typography tokens:

```ts
import { tokens } from "@furlpay/ui";
```

### `<Button />`

The core action primitive, styled with the token set:

```tsx
import { Button } from "@furlpay/ui";

<Button onClick={submit}>Continue</Button>
```

### Asset logos

Consistent, self-contained SVG marks for financial assets — no image CDN needed:

```tsx
import { CoinLogo, ChainLogo, StockLogo, CardNetworkLogo, AssetLogo } from "@furlpay/ui";

<CoinLogo symbol="USDC" />
<ChainLogo chain="solana" />
<StockLogo symbol="AAPL" />
<CardNetworkLogo network="visa" />
<AssetLogo …/>   // resolves the right logo for any asset kind
```

## When to use what

- Building a checkout? Use [`@furlpay/elements`](https://www.npmjs.com/package/@furlpay/elements) — it composes these primitives for you.
- Building a custom dashboard or wallet UI on Furlpay APIs? Use `@furlpay/ui` directly for visual consistency.

## License

MIT
