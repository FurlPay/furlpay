# Furlpay Rust SDK

Official Furlpay server-side SDK for Rust — stablecoin payments, wallets, and webhook signature verification.

**Zero dependencies.** HMAC-SHA256 is implemented in pure Rust, so webhook verification needs no OpenSSL. The HTTP transport is intentionally left to the integrator — bring `reqwest`, `ureq`, or anything else.

## Install

```sh
cargo add furlpay
```

## Verify webhooks

Signatures use the same `t=<unix>,v1=<hmac-sha256-hex>` scheme as the Node, Python, and Go SDKs, with a 5-minute replay tolerance.

```rust
use furlpay::{construct_event, WebhookError};

fn handle(body: &str, signature_header: Option<&str>, secret: &str) -> Result<(), WebhookError> {
    let event = construct_event(body, signature_header, secret)?;
    // signature is valid — safe to act on `event`
    Ok(())
}
```

Sign payloads (useful for testing your own endpoint):

```rust
let header = furlpay::sign_payload(r#"{"type":"payment.settled"}"#, "whsec_...", None);
```

## Other SDKs

| Language | Package |
| --- | --- |
| Node.js / TypeScript | [`@furlpay/furlpay-node`](https://www.npmjs.com/package/@furlpay/furlpay-node) |
| Python | `furlpay` (PyPI) |
| Go | [`github.com/furlpay/furlpay-go`](https://github.com/furlpay/furlpay-go) |

## API reference

The full OpenAPI 3.1 specification lives at [furlpay/furlpay-openapi](https://github.com/furlpay/furlpay-openapi).

## Security

Report vulnerabilities to hello@furlpay.com — do not open public issues.

## License

MIT
