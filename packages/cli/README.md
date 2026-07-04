# @furlpay/cli

Furlpay command-line interface — `stripe-cli` for stablecoins. Forward sandbox webhooks to localhost, emit signed test events, and tail API logs while you build.

[![npm](https://img.shields.io/npm/v/%40furlpay%2Fcli)](https://www.npmjs.com/package/@furlpay/cli)

## Install

```sh
npm install -g @furlpay/cli
# or run ad hoc:
npx @furlpay/cli <command>
```

## Commands

| Command | What it does |
| --- | --- |
| `furlpay login --key <sk_...>` | Store your API/webhook secret in `~/.furlpay/config.json` |
| `furlpay listen --forward-to <url>` | Stream sandbox webhooks to your local server, signed with your secret |
| `furlpay trigger <event>` | Emit one signed test event (uses the saved `--forward-to` target) |
| `furlpay events` | List all triggerable event types |
| `furlpay logs --tail` | Stream live API request/response cycles |

## Typical workflow

```sh
# 1. Save credentials once
furlpay login --key sk_sandbox_123

# 2. Point sandbox webhooks at your dev server
furlpay listen --forward-to localhost:3000/api/webhooks

# 3. In another terminal, fire specific events at your handler
furlpay trigger payment.settled
furlpay trigger card.transaction.authorized
```

Every event is delivered with a valid `furlpay-signature` header (HMAC-SHA256, `t=<unix>,v1=<hex>`), so your handler exercises the exact same verification path as production — including replay-tolerance checks.

## Verifying on the server

Use any Furlpay SDK ([Node](https://www.npmjs.com/package/@furlpay/furlpay-node), [Python](https://github.com/furlpay/furlpay-python), [Go](https://github.com/furlpay/furlpay-go), [Rust](https://github.com/furlpay/furlpay-rust)) — `constructEvent` validates the signature and returns the parsed event. Full runnable handlers for every stack: [furlpay-examples](https://github.com/furlpay/furlpay-examples).

## Security

Report vulnerabilities to hello@furlpay.com — please don't open public issues.

## License

MIT
