// Package furlpay is the official Furlpay server-side SDK for Go.
package furlpay

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// Client is a Furlpay API client.
type Client struct {
	APIKey     string
	BaseURL    string
	HTTPClient *http.Client
}

// New creates a Client with sane defaults.
//
//	client := furlpay.New("sk_sandbox_...")
func New(apiKey string) *Client {
	return &Client{
		APIKey:     apiKey,
		BaseURL:    "https://api.furlpay.app",
		HTTPClient: &http.Client{Timeout: 30 * time.Second},
	}
}

// APIError describes a non-2xx response.
type APIError struct {
	StatusCode int
	Message    string
}

func (e *APIError) Error() string { return fmt.Sprintf("furlpay: %d %s", e.StatusCode, e.Message) }

func (c *Client) do(method, path string, body any, out any) error {
	var reader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, c.BaseURL+path, reader)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.APIKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var e struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(data, &e)
		return &APIError{StatusCode: resp.StatusCode, Message: e.Error}
	}
	if out != nil && len(data) > 0 {
		return json.Unmarshal(data, out)
	}
	return nil
}

// OrderParams places a fractional stock/ETF order.
type OrderParams struct {
	Symbol   string  `json:"symbol"`
	Side     string  `json:"side"`
	Notional float64 `json:"notional"`
	Type     string  `json:"type,omitempty"`
}

// TransferParams executes a gas-sponsored stablecoin transfer.
type TransferParams struct {
	Destination string  `json:"destination"`
	Amount      float64 `json:"amount"`
	Token       string  `json:"token"`
	Chain       string  `json:"chain"`
	Signature   string  `json:"signature"`
}

// WalletsRetrieve returns Safe balances and modules.
func (c *Client) WalletsRetrieve() (map[string]any, error) {
	var out map[string]any
	return out, c.do("GET", "/api/wallets", nil, &out)
}

// WalletsTransfer submits a gas-sponsored transfer.
func (c *Client) WalletsTransfer(p TransferParams) (map[string]any, error) {
	var out map[string]any
	return out, c.do("POST", "/api/wallets/transfer", p, &out)
}

// InvestingCreateOrder places a fractional order.
func (c *Client) InvestingCreateOrder(p OrderParams) (map[string]any, error) {
	var out map[string]any
	return out, c.do("POST", "/api/investing/order", p, &out)
}

// SwapsQuote returns a cross-chain swap quote.
func (c *Client) SwapsQuote(p map[string]any) (map[string]any, error) {
	var out map[string]any
	return out, c.do("POST", "/api/swaps", p, &out)
}
