# Competitive architecture notes: RedotPay and Tangem

Collected 2026-09-30 for the production-readiness audit. **Architecture lessons only.** No code was copied. Tangem's application repositories are public but carry a licence headed "Tangem Proprietary and Confidential … THIS IS NOT AN OPEN SOURCE LICENSE"; they were read for structure only.

## Verified public evidence

### RedotPay
| Claim | Source |
|---|---|
| GitHub org `redotpay` (verified) has one public repository, `redotpay-payment-skill`: an MCP server/agent skill for MPP HTTP-402 payments, distributed as prebuilt binaries. | github.com/redotpay/redotpay-payment-skill |
| Its installer enforces a SHA-256 checksum and optionally an Ed25519 signature over `pubkey.pem`. | `install.sh` in that repo |
| First use of the skill is authorised by scanning a QR code in the RedotPay app; later payments on the same device usually need no rescan. | repo README |
| Custodial model: the terms define a "Custodian", custodian accounts and a "Pooled Account", and allow the issuer to freeze tokens in the custodian account. The custodian is not named in the terms. | redotpay.com/terms/general, /terms/HK-cards |
| The RedotPay Card is issued by Red F. Technology Limited (Hong Kong). | redotpay.com/terms/HK-cards |
| Self-declared: ISO/IEC 27001, PCI DSS, SOC 2 Type II; "Multi-party Computation (MPC) infrastructure"; HK Money Lender + TCSP licences, Argentina VASP, Canada MSB, FinCEN MSB. | redotpay.com/about-us |
| Mobile, backend, database, queues, CI/CD, cloud | **No public source-code evidence found.** |

### Tangem
| Observation | Source |
|---|---|
| `tangem-hot-sdk-kotlin`: mnemonic generation with 12/24-word entropy tests; native C crypto via JNI (trezor-crypto facade); AES encryption; PBKDF2 key stretching; auth modes `NoAuth / Password / Biometry / Contextual`; storage that can change the auth mode and remove biometry without regenerating the seed. | repo file layout and type names |
| `tangem-app-ios` Visa module: challenge (nonce, sessionId) → wallet signature → access/refresh tokens; authorization types `card_id / card_wallet / customer_wallet`; a separate card-activation status service. | `TangemVisa/APIService/*` |
| Android app split into `core / data / domain / features`, detekt baseline, Marathon device-farm config; iOS split into SPM feature modules with their own test targets. | repo roots |
| Backend, cloud, DR | **No public evidence.** |

## Inference (not evidence)

- A card programme needs a licensed issuing entity **and** a named custodian with a segregated pooled account. FurlPay has neither (`CARD_ISSUING_LIVE` is `unimplemented`).
- Tangem's separation of *what encrypts the seed* (a random data key) from *what unlocks that key* (biometry, password) is the design FurlPay's device wallet lacks. It is audit P3-2 and is not implemented yet.
- RedotPay's agent flow (a one-time phone authorisation, then a delegated session) has the same shape as FurlPay's scoped MCP connector tokens.
- Signed binary distribution is table stakes for FurlPay's CLI and SDK artifacts.
