# Furlpay Go SDK

Official Furlpay server-side SDK for Go — stablecoin payments, wallets, cards, fractional investing, and webhook verification.

[![Go Reference](https://pkg.go.dev/badge/github.com/furlpay/furlpay-go.svg)](https://pkg.go.dev/github.com/furlpay/furlpay-go)

Zero dependencies — standard library only.

## Install

```sh
go get github.com/furlpay/furlpay-go
```

## Quick start

```go
package main

import (
	"fmt"
	"os"

	furlpay "github.com/furlpay/furlpay-go"
)

func main() {
	client := furlpay.New(os.Getenv("FURLPAY_API_KEY"))

	wallet, err := client.WalletsRetrieve()
	if err != nil {
		panic(err)
	}
	fmt.Println(wallet)

	// Gas-sponsored stablecoin transfer
	_, err = client.WalletsTransfer(furlpay.TransferParams{
		Destination: "0xRecipient...",
		Amount:      25.00,
		Token:       "USDC",
		Chain:       "solana",
		Signature:   "...",
	})
	if err != nil {
		panic(err)
	}
}
```

## Verify webhooks

Always verify the `furlpay-signature` header before trusting a webhook payload. Signatures are HMAC-SHA256 with a 5-minute replay tolerance.

```go
func handleWebhook(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)

	event, err := furlpay.ConstructEvent(
		body,
		r.Header.Get("furlpay-signature"),
		os.Getenv("FURLPAY_ENDPOINT_SECRET"),
	)
	if err != nil {
		http.Error(w, "invalid signature", http.StatusBadRequest)
		return
	}

	switch event.Type {
	case "payment.settled":
		// fulfil the order
	}
	w.WriteHeader(http.StatusOK)
}
```

## Other SDKs

| Language | Package |
| --- | --- |
| Node.js / TypeScript | [`@furlpay/furlpay-node`](https://www.npmjs.com/package/@furlpay/furlpay-node) |
| Python | `furlpay` (PyPI) |
| Rust | `furlpay` (crates.io) |

## API reference

The full OpenAPI 3.1 specification lives at [furlpay/furlpay-openapi](https://github.com/furlpay/furlpay-openapi).

## Security

Please report vulnerabilities to hello@furlpay.com — do not open public issues. See `SECURITY.md`.

## License

MIT
