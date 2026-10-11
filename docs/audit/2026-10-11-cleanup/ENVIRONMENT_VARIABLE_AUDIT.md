# Environment variable audit (11 October 2026)

Method: every `process.env.NAME` read, bracket read, `env.NAME` read and name
passed to an env helper was collected from `apps/web`, the root scripts, the
packages, the MCP server and the Node SDK, then compared with
`apps/web/.env.example` (documentation) and `apps/web/src/lib/env.ts` (the
registry). Names set on Vercel were read as names only; no value was read.

| | Before | After |
|---|---:|---:|
| Documented in `.env.example` | 285 | 294 |
| Registered in `lib/env.ts` | 339 | 339 |
| Read by the web app at runtime | 250 | 250 |
| Documented, read by nothing | 9 | 0 |
| Read by the web app, not registered | 1 | 0 |
| Read by the web app, not documented | 58 | 42 |

## Removed — commit `50f13f48`

No source file, script, package or infrastructure definition reads these:

`ALPACA_BASE_URL`, `CHAINALYSIS_API_KEY`, `DYNAMIC_ENVIRONMENT_ID`,
`FURLPAY_WEBHOOK_SECRET`, `MARQETA_APP_TOKEN`, `MARQETA_ADMIN_TOKEN`,
`SAFE_RPC_URL`, `SAFE_TX_SERVICE_URL`, `WISE_PROFILE_ID`.

They were removed from the repository's documentation and registry only.
Nothing was changed on Vercel.

## Looks unused, is not

These have no literal read because the name is built at runtime. KEEP.

`*_RPC_URL_SECONDARY` and `*_RPC_URL_FALLBACK` (failover lookup by suffix),
`FURLPAY_ROUTER_ADDRESS_<CHAIN>`, `CIRCLE_PAYMASTER_ADDRESS_<CHAIN>`,
`ERC4337_BUNDLER_URL_<CHAIN>`, `<ASSET>_PRICE_CHANNEL_ID`,
`TREASURY_ADDRESS_<CHAIN>`.

## Set on Vercel, read by nothing in this repository

`BLOB_READ_WRITE_TOKEN`, `KV_URL`, `KV_REST_API_READ_ONLY_TOKEN`, `REDIS_URL`
(`REDIS_URL` is only checked for presence in an ops report). The storage
integrations create these automatically. They are harmless; removing them from
Vercel needs your approval and was not done.

## Preview scope: the isolation finding

The preview scope holds 13 variables, including `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `KV_REST_API_URL` and `KV_REST_API_TOKEN` with
production values. As of commit `77bfa851` the application withholds those
from any non-production Vercel deployment unless the scope sets
`FURLPAY_DATA_PLANE=isolated`, and always when the Supabase URL names a
production project. The remote configuration itself is unchanged. To give
previews working data: create a separate Supabase project and Redis store,
put their credentials in the preview scope, remove the production ones from
that scope, and set `FURLPAY_DATA_PLANE=isolated` there.

## The 47 variables set in production

"Preview" says whether the variable belongs in the preview scope. "isolated
only" means: only alongside a separate preview data plane.

| Variable | Class | Sensitive | Preview | Documented | Registered | Runtime reads | Purpose |
|---|---|---|---|:-:|:-:|---:|---|
| `DISCORD_GITHUB_WEBHOOK_URL` | optional | secret (bearer URL) | no | yes | yes | 1 | Discord channel webhook the GitHub changelog relay posts to. |
| `DISCORD_GUILD_ID` | optional | no | no | yes | yes | 6 | Discord server the bot operates in (welcome sweep, role setup). |
| `DISCORD_MARKET_WEBHOOK_URL` | optional | secret (bearer URL) | no | yes | yes | 1 | Discord channel webhook for the daily market brief. |
| `EMAIL_FROM` | required for email | no | no | yes | yes | 1 | From address for transactional email; must be on the verified sending domain. |
| `ETHEREUM_RPC_URL` | optional | may embed a provider key | isolated only | yes | yes | 2 | Ethereum node endpoint; public endpoint when unset. |
| `ETH_PRICE_CHANNEL_ID` | optional | no | no | yes | no | by name | Discord channel for the ETH price card. Read by name through the price-card config. |
| `FURLPAY_ANDROID_CERT_SHA256` | required for the Android app | no | no | yes | yes | 1 | Signing certificate digest; lets the Android app's passkey origin be accepted. |
| `FURLPAY_CARDAUTH_ENDPOINT_SECRET` | optional (cards not offered) | secret | no | yes | yes | 1 | HMAC secret for the card-authorisation webhook; the route answers 503 without it. |
| `FURLPAY_CRON_SECRET` | required (one of two) | secret | no | yes | yes | 4 | Credential for an external scheduler. With neither cron secret set, scheduled jobs are refused. |
| `FURLPAY_FCM_SERVICE_ACCOUNT` | required for Android push | secret | no | yes | yes | 1 | Firebase service account for push to the native Android app. |
| `FURLPAY_ORIGIN` | required | no | its own value | yes | yes | 6 | Origin the browser sees; passkey verification and email links. |
| `FURLPAY_RP_ID` | required | no | its own value | yes | yes | 2 | Passkey relying-party ID. Never read from the Host header. |
| `FURLPAY_VAPID_PRIVATE_KEY` | required for web push | secret | no | yes | yes | 1 | Web Push signing key. |
| `FURLPAY_VAPID_PUBLIC_KEY` | required for web push | no | no | yes | yes | 1 | Web Push public key. |
| `FURLPAY_VAPID_SUBJECT` | required for web push | no | no | yes | yes | 1 | Web Push contact subject. |
| `GITHUB_WEBHOOK_SECRET` | optional | secret | no | yes | yes | 1 | Verifies X-Hub-Signature-256 on the GitHub webhook. |
| `GOLD_PRICE_CHANNEL_ID` | optional | no | no | yes | no | by name | Discord channel for the gold price card. Read by name. |
| `HELIUS_API_KEY` | optional | secret | no | yes | yes | 3 | Helius RPC and compressed-NFT minting. |
| `INDEXNOW_KEY` | optional | no (published at /indexnow.txt) | no | yes | yes | 1 | IndexNow search-engine submission key. |
| `INTEGRATION_MODE` | required | no | leave unset | yes | yes | 13 | "live" permits real provider calls. Anything else is mock; production without it fails closed on money paths. |
| `LIFI_API_KEY` | optional | secret | no | yes | yes | 4 | LI.FI routing key; quotes work without it at low rate limits. |
| `LIFI_FEE` | optional | no | no | yes | yes | 3 | Integrator fee fraction on swaps. |
| `LIFI_INTEGRATOR` | optional | no | no | yes | yes | 3 | LI.FI integrator name. |
| `MARKET_CARDS_CHANNEL_ID` | optional | no | no | yes | yes | 1 | Single Discord channel for all price cards. |
| `MERCHANT_SOLANA_WALLET` | optional | no (public address) | no | yes | yes | 2 | Solana treasury address for Solana Actions checkout. |
| `NEXT_PUBLIC_ALLOW_GUEST` | development convenience | no | optional | yes | yes | 2 | Shows the guest button. Guest sign-in is never available on the production deployment; a preview also needs ALLOW_GUEST_LOGIN=1. |
| `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` | optional | no | optional | yes | yes | 1 | Bot username used to build Mini App launch links. |
| `ONCHAIN_LIVE_WINDOW_CHAINS` | optional | no | no | yes | yes | 1 | Chains included in the live on-chain window. |
| `ONCHAIN_NODE_CHAINS` | optional | no | no | yes | yes | 2 | Chains the node indexer follows. |
| `POLYGON_RPC_URL` | optional | may embed a provider key | isolated only | yes | yes | 2 | Polygon node endpoint; public endpoint when unset. |
| `RESEND_API_KEY` | required for email | secret | no | yes | yes | 4 | Transactional email provider. |
| `RESEND_WEBHOOK_SECRET` | required for email | secret | no | yes | yes | 1 | Verifies the bounce and complaint feed. |
| `ROLE_PICKER_CHANNEL_ID` | optional | no | no | yes | yes | 1 | Discord channel for the role picker. |
| `SOLANA_PAYER_SECRET` | optional | secret (hot key) | never | yes | yes | 1 | Solana keypair that pays compressed-NFT mint fees. Keep only fee money on it. |
| `SOLANA_RPC_URL` | optional | may embed a provider key | isolated only | yes | yes | 11 | Solana node endpoint; public endpoint when unset. |
| `SOL_PRICE_CHANNEL_ID` | optional | no | no | yes | no | by name | Discord channel for the SOL price card. Read by name. |
| `SUPPORT_INBOX` | optional | no | no | yes | yes | 3 | Where support messages are forwarded. |
| `TELEGRAM_BOT_TOKEN` | required for Telegram | secret | never the production bot | yes | yes | 7 | Verifies Mini App launches; posts the market brief. |
| `TELEGRAM_CHANNEL_ID` | optional | no | no | yes | yes | 2 | Default chat for bot posts. |
| `TELEGRAM_MARKET_CHAT_ID` | optional | no | no | yes | yes | 1 | Chat for the market brief. |
| `TELEGRAM_WEBHOOK_SECRET` | required for Telegram | secret | never the production value | yes | yes | 2 | Must equal the secret token registered with setWebhook. |
| `TREASURY_ADDRESS_BSC` | optional | no (public address) | no | yes | yes | by name | Extra watch address for deposit detection. Read by name (TREASURY_ADDRESS_<CHAIN>). |
| `VERIFY_CHANNEL_ID` | optional | no | no | yes | yes | 1 | Discord channel for the verification panel. |
| `WELCOME_CHANNEL_ID` | optional | no | no | yes | yes | 1 | Discord channel for new-member welcomes. |
| `WELCOME_START_HERE_CHANNEL_ID` | optional | no | no | yes | yes | 1 | Channel linked from the welcome message. |
| `X402_PAY_TO` | optional | no (public address) | no | yes | yes | 1 | Address a paid x402 resource asks to be paid at; a default exists in code. |
| `X402_QUOTE_SECRET` | required for x402 | secret | never the production value | yes | yes | 2 | Signs x402 quotes. No default: production refuses to issue quotes without it. |

None of the 47 is obsolete. Three (`ETH_`, `GOLD_` and `SOL_PRICE_CHANNEL_ID`)
are documented and read by name but absent from the registry.

## Secrets to review

- `SOLANA_PAYER_SECRET` is a private key in an environment variable. It should hold fee money only.
- `DISCORD_*_WEBHOOK_URL` values are bearer credentials: anyone holding one can post to the channel.
- Production secrets must not be copied into the preview scope: the bot token, webhook secrets, `X402_QUOTE_SECRET`, `FURLPAY_SESSION_SECRET`. A preview that shares the session secret accepts production session cookies.
- No secret value was read, logged or committed during this audit. Whether any secret needs rotating cannot be judged from names alone.

## Still undocumented (42)

Read by the web app and registered in `lib/env.ts`, but with no entry in
`.env.example`. Left for a follow-up because each needs its purpose written
from the code, not guessed:

`AMBASSADORS_INBOX`, `ANDROID_PACKAGE_NAME`, `ANTHROPIC_API_KEY`, `APPLE_APP_ATTEST_BUNDLE_ID`, `APPLE_APP_ATTEST_ENVIRONMENT`, `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `ARBITRUM_SEPOLIA_RPC_URL`, `BLOCKAID_API_KEY`, `CAREERS_INBOX`, `COPILOT_MODEL`, `DISCORD_PUBLIC_KEY`, `DUFFEL_API_BASE`, `FURLPAY_ALERT_WEBHOOK`, `FURLPAY_ALERT_WEBHOOK_SECRET`, `FURLPAY_API_KEY`, `FURLPAY_BUILD_BRANCH`, `FURLPAY_BUILD_ID`, `FURLPAY_BUILD_SHA`, `FURLPAY_BUILD_TIME`, `FURLPAY_COMPLIANCE_INBOX`, `FURLPAY_COMPLIANCE_OPERATOR_TOKEN`, `FURLPAY_CREDENTIAL_SECRET`, `FURLPAY_GEO_ANOMALY_MINUTES`, `FURLPAY_HIGH_RISK_JURISDICTIONS`, `FURLPAY_HITL_THRESHOLD_USD`, `FURLPAY_KEY`, `FURLPAY_OFFHOURS_UTC`, `FURLPAY_REQUIRE_AGENT_SIG`, `FURLPAY_SECRET_KEY`, `HACKATHON_INBOX`, `IG_ACCESS_TOKEN`, `IG_USER_ID`, `KV_REST_API_TOKEN`, `KV_REST_API_URL`, `MORPHO_API_URL`, `MORPHO_USDC_VAULT`, `PLAY_INTEGRITY_SERVICE_ACCOUNT`, `ROBINHOOD_RPC_URL`, `SWAG_INBOX`, `X402_NETWORK`, `X402_USDC_ADDRESS`.

Not required in production but missing there, which disables a feature or a
control: `FURLPAY_ENV`, `FURLPAY_ADMIN_EMAIL`, `FURLPAY_ALERT_SLACK_WEBHOOK` /
`FURLPAY_ALERT_WEBHOOK_URL` (alerts are delivered nowhere),
`FURLPAY_PARTNER_WEBHOOK_KEY`, `FURLPAY_ROUTER_ADDRESS_*`, `CIRCLE_*`.
