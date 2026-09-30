# Card issuer integration

**Status: CODE-READY SEAM, NOT LIVE.** No issuer is contracted. `CARD_ISSUING_LIVE` carries an `unimplemented` reason in `apps/web/src/lib/flags.ts`, so no environment variable can turn card issuing on until that reason is deleted — which must only happen alongside a signed issuer programme.

## 1. What exists

| Piece | Where | What it does |
|---|---|---|
| The port | `apps/web/src/lib/providers/types.ts` → `CardIssuerProviderAdapter` | `issueCard`, `getCard`, `setCardStatus`, `getCardSecrets`, `parseAuthorizationRequest`, `encodeAuthorizationDecision` |
| The gate | `apps/web/src/lib/cardIssuer.ts` → `cardIssuerOr503`, `getCardIssuer` | Every route under `api/cards/**` and `api/travel/cards/create` calls it. Production without a live issuer → 503 naming the flag's reason |
| Simulator | `apps/web/src/lib/cards/simulatedAdapter.ts` | Same port; unreachable in production and unreachable once the flag is on; output is obviously fake (`4242…`, `sim_` ids) |
| Rain adapter | `apps/web/src/lib/cards/rainAdapter.ts` (+ `rainNetwork.ts`, `rainRestrictions.ts`) | Built from Rain's public Rust SDK because the API reference is behind a partner login; refuses where the SDK is silent rather than guessing |
| Lifecycle service | `apps/web/src/lib/services/cardLifecycle.ts` + `api/cards/lifecycle/[id]/*` | Order → ship → activate → PIN → reveal grant → report lost → reissue; owner-scoped |
| JIT authorisation | `api/webhooks/card-auth` | Verified parse → off-chain policy (`lib/services/policyEngine.ts`) → decision |
| Reveal | `api/cards/lifecycle/[id]/reveal` | Mints a single-use 60 s grant; **FurlPay never holds PAN/CVC** — the port returns ciphertext only |
| Mobile | `native-app/app/(tabs)/cards.tsx`, `modules/apple-wallet-provisioning`, `modules/google-pay-provisioning` | As of this pass the mobile sheet constructs no card digits (PGA-013) |

## 2. Brief-requested operations vs the port

| Requested | Port today | Gap / proposed signature |
|---|---|---|
| createCardholder / getCardholder | — (`IssueCardRequest.holderRef` assumes one exists) | `createCardholder(req: { userRef; legalName; dob; address; kycRef }): Promise<{ holderRef }>`, `getCardholder(holderRef)`. Rain calls these `/users` |
| createVirtualCard | `issueCard({ formFactor: "virtual" })` | — |
| orderPhysicalCard | `issueCard({ formFactor: "physical" })` | Needs a shipping address on the request; today shipping lives in `cardLifecycle` only |
| getCards / getCard | `getCard` | `listCards(holderRef)` |
| freeze / unfreeze / terminate | `setCardStatus` | — |
| replaceCard | lifecycle `reissue` (local) | `replaceCard(ref, reason): Promise<IssuedCard>` — must be issuer-side, the old PAN must die at the issuer |
| getSensitiveCardData | `getCardSecrets` (ciphertext) | **Missing endpoint:** the grant-for-secrets exchange (`consumeRevealGrant` exists in the service, nothing mounts it) |
| createProvisioningPayload | route `lifecycle/[id]/provisioning` + native modules | `createProvisioningPayload(ref, { platform, certificates, nonce, nonceSignature })` — Apple/Google push provisioning is issuer-signed |
| getTransactions / getAuthorizations | — | `listTransactions(ref, cursor)`, `listAuthorizations(ref, cursor)` for reconciliation against webhook-recorded auths |
| getSpendingControls | controls set at issue only | `getSpendingControls(ref)`, `updateSpendingControls(ref, controls)` |

These were **not** added to the interface in this pass: every adapter would have to implement them, and the only real adapter (Rain) cannot be completed against a private API reference without guessing request shapes — which is exactly what `rainAdapter.ts` refuses to do.

## 3. Invariants any issuer adapter must keep

1. **PAN/CVC never in plaintext in our process.** `getCardSecrets` returns issuer ciphertext; the client decrypts with a key the server never holds. Widening the return to `string` changes PCI scope for the whole platform.
2. **Authorisations are verified before parsing.** `parseAuthorizationRequest` throws `WebhookVerificationError` on a bad signature (AGENTS rule 3); verification is constant-time over the raw body with a timestamp window.
3. **Throw, never fabricate.** `issueCard` throws rather than returning a card that was not created.
4. **Idempotency.** Issue and reissue routes carry an `Idempotency-Key` (`lib/idempotency.ts`); the adapter must pass it through where the issuer supports it.
5. **Audit.** Reveal grants record a security event (`recordSecurityEvent`, `card_details_revealed`).
6. **Logs and analytics.** `lib/redact.ts` strips Luhn-valid PANs from free text; mobile telemetry passes through `native-app/lib/observability/scrub.ts`. Neither is a licence to log card data.

## 4. To go live — external, in order

1. Signed issuer programme (issuer processor, BIN sponsor, network) — **BLOCKED_EXTERNAL**.
2. Production credentials → `FURLPAY_CARD_ISSUER`, `FURLPAY_CARD_ISSUER_API_KEY` (registered in `lib/env.ts`, documented in `.env.example`).
3. Complete the adapter against the issuer's real API reference; add the §2 port methods.
4. Mount the reveal-grant → vault exchange.
5. Apple Pay / Google Pay push-provisioning entitlements (issuer + Apple/Google approval).
6. Delete the `unimplemented` reason on `CARD_ISSUING_LIVE` in the same change that wires the adapter, with a test that the simulator becomes unreachable.
7. Update `lib/productionStatus.ts` → `cards` only after an observed production issuance.
