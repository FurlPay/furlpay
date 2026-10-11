# BVNK webhooks

Endpoint: `POST /api/webhooks/bvnk` (route manifest: `WEBHOOK_VERIFIED`).

## Verification

BVNK's current scheme (docs: get-started/create-webhook-listener):

```
x-signature = base64( HMAC-SHA256( key = webhook secret as UTF-8 bytes,
                                   message = raw request body as UTF-8 bytes ) )
```

The secret is used exactly as BVNK displays it; it is not base64-decoded. The
route verifies over the raw bytes before parsing, compares in constant time,
and rejects any signature that is not 44 base64 characters decoding to 32
bytes. BVNK's published vector is a unit test. There is no signature timestamp;
replays are handled by de-duplication and an event-age limit (below).

## Events handled

| Event | Contract | Recorded as |
|---|---|---|
| `payment:v2:payin:status-change` | status `COMPLETED`; `data.id`, `direction`, `method`, `originator`, `beneficiary { walletId, customerId }`, `fees` | `bvnk_records` kind `payin` |
| `payment:v2:payout:status-change` | statuses `PENDING`…`RETURNED`, `EXPIRED` | kind `payout` |
| `payment:v3:transfer:status-change` | Transfers v3 statuses; `reference`; `conversion { digest, allInRate, expiresAt }`; IN and OUT both delivered for same-account transfers | kind `transfer`, per direction |
| `ledger:v2:wallet:status-change` | `ACTIVE`, `INACTIVE`, `TERMINATED` | kind `wallet` |
| `platform:accounts:customer:status-change` | `status`, `requiredActions` | Delivery recorded only (no state yet) |
| any other event | envelope only | Delivery recorded only |

BVNK asks integrators not to deserialise fields they do not use, so each schema
requires only the fields FurlPay reads.

## Processing and responses

1. No secret configured → 503 (fail closed).
2. Body over 256 KB → 413. Bad or missing signature → 401.
3. Not JSON, missing envelope fields, off-contract, older than 7 days or dated
   more than 5 minutes ahead, or an amount that is not exactly representable
   → 422. BVNK does not retry 4xx.
4. Durable claim on `(bvnk, eventId)` in `webhook_events` (0022) with a
   payload hash. A redelivery → 200 `duplicate`; the same id with a different
   body → 409 and a financial alert; store unavailable → 503 (BVNK retries 5xx
   for about 24 hours).
5. Record via `bvnk_record_upsert`: newer report → `recorded`; older or equal
   → `stale` (200, state unchanged). A failure releases the claim and returns
   503, so BVNK's retry is processed.

Nothing in this path credits a balance, posts to the ledger, or starts a
payout, transfer, payroll batch or signature.
