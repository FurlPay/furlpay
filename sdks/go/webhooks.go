package furlpay

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

const toleranceSeconds = 300

// Event is a Furlpay webhook event envelope.
type Event struct {
	ID      string          `json:"id"`
	Type    string          `json:"type"`
	Created int64           `json:"created"`
	Data    json.RawMessage `json:"data"`
}

// SignPayload produces a furlpay-signature header value (HMAC-SHA256).
func SignPayload(body, secret string, timestamp int64) string {
	if timestamp == 0 {
		timestamp = time.Now().Unix()
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(fmt.Sprintf("%d.%s", timestamp, body)))
	return fmt.Sprintf("t=%d,v1=%s", timestamp, hex.EncodeToString(mac.Sum(nil)))
}

// ConstructEvent verifies the signature header and returns the parsed event.
//
//	event, err := furlpay.ConstructEvent(body, r.Header.Get("furlpay-signature"), secret)
func ConstructEvent(body []byte, signatureHeader, secret string) (*Event, error) {
	if signatureHeader == "" {
		return nil, errors.New("missing furlpay-signature header")
	}

	var ts int64
	var v1 string
	for _, part := range strings.Split(signatureHeader, ",") {
		kv := strings.SplitN(strings.TrimSpace(part), "=", 2)
		if len(kv) != 2 {
			continue
		}
		switch kv[0] {
		case "t":
			ts, _ = strconv.ParseInt(kv[1], 10, 64)
		case "v1":
			v1 = kv[1]
		}
	}
	if ts == 0 || v1 == "" {
		return nil, errors.New("malformed furlpay-signature header")
	}

	if diff := time.Now().Unix() - ts; diff > toleranceSeconds || diff < -toleranceSeconds {
		return nil, errors.New("signature timestamp outside tolerance (possible replay)")
	}

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(fmt.Sprintf("%d.%s", ts, string(body))))
	expected := hex.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(expected), []byte(v1)) {
		return nil, errors.New("signature verification failed")
	}

	var event Event
	if err := json.Unmarshal(body, &event); err != nil {
		return nil, fmt.Errorf("invalid event body: %w", err)
	}
	return &event, nil
}
