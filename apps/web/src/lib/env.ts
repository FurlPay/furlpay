// ---------------------------------------------------------------------------
// Environment-variable registry — the single inventory of every env var the
// web app reads. `.env.example` documents values for humans; this registry is
// the machine-readable side: what exists, what production needs, and whether
// a deployment actually has it set. It never exposes values, only presence.
//
// Keep in sync when adding a variable: register it here AND document it in
// .env.example. The /api/security/env route (admin-only) reports the result.
// ---------------------------------------------------------------------------

export interface EnvVar {
  name: string;
  /** Set = the app refuses to run correctly in live production without it. */
  requiredWhenLive?: boolean;
}

export interface EnvGroup {
  group: string;
  vars: EnvVar[];
}

const v = (name: string, requiredWhenLive?: boolean): EnvVar =>
  requiredWhenLive ? { name, requiredWhenLive } : { name };

export const ENV_REGISTRY: EnvGroup[] = [
  {
    group: "Core",
    vars: [
      v("INTEGRATION_MODE"),
      v("FURLPAY_SESSION_SECRET", true),
      v("FURLPAY_RP_ID"),
      // Behind CloudFront → ALB: number of appended X-Forwarded-For hops (2).
      // Unset = Vercel, which sets the IP headers itself.
      v("FURLPAY_TRUSTED_PROXY_HOPS"),
      // "true" behind CloudFront (Terraform sets it): origin verification is
      // mandatory and admin page checks call the local port. Unset elsewhere.
      v("ORIGIN_VERIFY_REQUIRED"),
      // "off" disables client analytics ingestion (503); unset = on.
      v("FURLPAY_ANALYTICS_INGEST"),
      // Behind CloudFront: the public origin (https://host). Unset = Vercel.
      v("PUBLIC_API_ORIGIN"),
      v("FURLPAY_ORIGIN"),
      // Signing-cert SHA-256 -> the native app's android:apk-key-hash WebAuthn
      // origin. Required for passkey sign-in from the Android app.
      v("FURLPAY_ANDROID_CERT_SHA256"),
      // Exact Chrome extension id(s) allowed to assert a furlpay.com passkey
      // (Chrome 122+). Widens the signing surface — see lib/webauthn.ts.
      v("FURLPAY_EXTENSION_ID"),
      v("ALLOW_GUEST_LOGIN"),
      v("NEXT_PUBLIC_ALLOW_GUEST"),
      // Local development only: unauthenticated pages auto sign in to the demo
      // account (app/api/auth/dev-session). Ignored by every production build.
      v("FURLPAY_DEV_AUTO_LOGIN"),
      v("FURLPAY_ADMIN_EMAIL"),
      // Outbound security-alert sink (lib/ops/alertSink.ts). Both are required
      // for delivery: with no webhook the sink is a documented no-op, and with no
      // secret it REFUSES to send rather than sending unsigned.
      v("FURLPAY_ALERT_WEBHOOK"),
      v("FURLPAY_ALERT_WEBHOOK_SECRET"),
      // Contextual anomaly thresholds (lib/ops/accessContextAnomaly.ts).
      // FURLPAY_OFFHOURS_UTC accepts "H-H" or "off"; a distributed team will want
      // to widen or disable it rather than have it cry wolf.
      v("FURLPAY_GEO_ANOMALY_MINUTES"),
      v("FURLPAY_OFFHOURS_UTC"),
      // Self-custodial wallet rollout stage (0=off). 1=wallet linking only.
      // docs/SELF-CUSTODIAL-WALLET-DESIGN.md.
      v("FURLPAY_SELF_CUSTODY_STAGE"),
      // The deployment's FINANCIAL environment: development | staging |
      // production. Deliberately separate from NODE_ENV, which Next sets to
      // "production" for preview branches too — inferring from it would mark a
      // preview as a place real money may move. See lib/flags.ts.
      v("FURLPAY_ENV"),
      v("BLOCKAID_API_KEY"),
    ],
  },
  {
    // ── Money-feature flags ────────────────────────────────────────────
    // Per-capability switches, all default OFF, each gated on its own
    // credentials and permitted environments. None is `requiredWhenLive`: a
    // production deployment with every one of them off is correctly
    // configured — it simply cannot perform those operations, and says so.
    // See lib/flags.ts for what each one gates and what it requires.
    group: "Money feature flags",
    vars: [
      // Emergency stop. Disables every money capability at once, checked
      // before any per-flag setting so nothing can defeat it.
      v("FURLPAY_MONEY_KILL_SWITCH"),
      // Comma-separated /api prefixes to answer 503 (lib/featureGate.ts).
      // Unset = nothing frozen; only allow-listed prefixes are honoured.
      v("FURLPAY_FROZEN_API_PREFIXES"),
      v("BROKERAGE_LIVE"),
      v("TOKENIZED_STOCKS_LIVE"),
      v("ONCHAIN_SETTLEMENT_LIVE"),
      // Settlement circuit breaker (lib/settlementSafety.ts). Unset = shadow
      // auto-halts, default thresholds, velocity cap off.
      v("SETTLEMENT_SAFETY_AUTOHALT"),
      v("SETTLEMENT_RECOVERY_MIN_APPROVERS"),
      v("SETTLEMENT_RECOVERY_APPROVER_EMAILS"),
      v("SETTLEMENT_MAX_HEAD_AGE_S"),
      v("SETTLEMENT_MAX_PROVIDER_LAG_BLOCKS"),
      v("SETTLEMENT_MAX_PER_HOUR"),
      v("ONCHAIN_BALANCES_LIVE"),
      v("DEFI_COLLATERAL_LIVE"),
      v("AI_TRADING_LIVE"),
      v("CROSS_CHAIN_STOCKS_LIVE"),
      v("HARDWARE_WALLET_LIVE"),
      // Cannot be enabled: no card issuer is integrated (flags.ts
      // `unimplemented`). Registered so the names exist for the day one is.
      v("CARD_ISSUING_LIVE"),
      v("FURLPAY_CARD_ISSUER"),
      v("FURLPAY_CARD_ISSUER_API_KEY"),
      // Fiat rails. All three flags carry `unimplemented` reasons: no banking,
      // on-ramp or off-ramp partner is contracted, and no adapter implements
      // the ports in lib/providers/types.ts. Registered so the names exist for
      // the day one does; setting them today changes nothing.
      v("BANKING_LIVE"),
      v("FURLPAY_BANKING_PARTNER"),
      v("FURLPAY_BANKING_PARTNER_API_KEY"),
      v("ONRAMP_LIVE"),
      v("FURLPAY_ONRAMP_PROVIDER"),
      v("FURLPAY_ONRAMP_PROVIDER_API_KEY"),
      v("OFFRAMP_LIVE"),
      v("FURLPAY_OFFRAMP_PROVIDER"),
      v("FURLPAY_OFFRAMP_PROVIDER_API_KEY"),
      // FurlBridge = Transak (no contract; capability rows "in_discussion").
      // FURLBRIDGE_* is read first, TRANSAK_* is the fallback (rampEnv.ts).
      // The access token also verifies webhooks (HS256 JWT body).
      v("FURLBRIDGE_API_KEY"),
      v("FURLBRIDGE_SECRET_KEY"),
      v("FURLBRIDGE_ACCESS_TOKEN"),
      v("FURLBRIDGE_API_URL"),
      v("TRANSAK_API_KEY"),
      v("TRANSAK_SECRET_KEY"),
      v("TRANSAK_ACCESS_TOKEN"),
      v("TRANSAK_API_URL"),
      // FurlPayout = Echo Money (no contract; API scheme unverified; never
      // registered by lib/providers/register.ts).
      v("FURLPAYOUT_API_KEY"),
      v("FURLPAYOUT_API_SECRET"),
      v("FURLPAYOUT_API_URL"),
      v("ECHO_API_KEY"),
      v("ECHO_API_SECRET"),
      v("ECHO_API_URL"),
      // AES-256-GCM key (base64, 32 bytes) for stored bank account numbers
      // (lib/ramp/beneficiary.ts). Unset => nothing is stored.
      v("FURLPAY_BENEFICIARY_ENCRYPTION_KEY"),
      // AES-256-GCM key (base64, 32 bytes) sealing partner webhook signing
      // secrets (lib/ramp/partnerConfig.ts). Unset => partners cannot set a callback.
      v("FURLPAY_PARTNER_WEBHOOK_KEY"),
      // Cannot be enabled: no lender and no biller network is contracted
      // (flags.ts `unimplemented`). Registered so the names exist.
      v("CREDIT_LIVE"),
      v("FURLPAY_CREDIT_PROVIDER"),
      v("FURLPAY_CREDIT_PROVIDER_API_KEY"),
      v("BILL_PAY_LIVE"),
      v("FURLPAY_BILLPAY_PROVIDER"),
      v("FURLPAY_BILLPAY_PROVIDER_API_KEY"),
      v("REWARDS_LIVE"),
      v("FURLPAY_REWARDS_LEDGER"),
      v("RECURRING_INVESTING_LIVE"),
      v("P2P_LIVE"),
      v("FURLPAY_P2P_STORE"),
      v("ACCOUNT_SPEND_LIVE"),
      // WalletConnect relay project id. Public (it appears in the relay URL),
      // registered because clientFlags/registry.ts gates the wallet_connect
      // flag on it — no relay, no screen.
      v("FURLPAY_WALLETCONNECT_PROJECT_ID"),
      // Transaction-simulation vendor for /api/security/scan. Absent, the
      // route returns its local decode and says the deep check did not run.
      v("FURLPAY_TX_SIMULATION_PROVIDER"),
      v("FURLPAY_TX_SIMULATION_API_KEY"),
      // Set only after a person has verified at least one tokenized-equity
      // contract address against its issuer — see lib/onchain/stockTokenRegistry.ts.
      v("FURLPAY_STOCK_TOKEN_REGISTRY_VERIFIED"),
      // Which key-management backend signs on-chain transactions. Absent or
      // "env" keeps ONCHAIN_SETTLEMENT_LIVE unavailable. "turnkey" is the one
      // implemented hardware-backed provider (lib/kms.ts).
      v("FURLPAY_KMS_PROVIDER"),
      // Which Turnkey wallet serves each logical key. Addresses are public, so
      // these are configuration rather than secrets; a key with no address
      // configured is refused as `unknown_key` rather than silently signing
      // with a different wallet.
      v("TURNKEY_ORGANIZATION_ID"),
      v("TURNKEY_GAS_SPONSOR_ADDRESS"),
      v("TURNKEY_SETTLEMENT_ADDRESS"),
      v("TURNKEY_ATTESTATION_ADDRESS"),
    ],
  },
  {
    group: "Durable KV (Upstash Redis)",
    vars: [
      v("UPSTASH_REDIS_REST_URL", true),
      v("UPSTASH_REDIS_REST_TOKEN", true),
      v("KV_REST_API_URL"),
      v("KV_REST_API_TOKEN"),
    ],
  },
  {
    group: "Database (Supabase)",
    vars: [v("SUPABASE_URL"), v("SUPABASE_SERVICE_ROLE_KEY"), v("RESEARCH_PDF_BUCKET")],
  },
  {
    group: "Auth providers",
    vars: [
      v("GOOGLE_CLIENT_ID"),
      v("NEXT_PUBLIC_GOOGLE_CLIENT_ID"),
      v("APPLE_CLIENT_ID"),
      v("NEXT_PUBLIC_APPLE_CLIENT_ID"),
      v("NEXT_PUBLIC_APPLE_REDIRECT_URI"),
      v("TWILIO_ACCOUNT_SID"),
      v("TWILIO_AUTH_TOKEN"),
      v("TWILIO_VERIFY_SERVICE_SID"),
    ],
  },
  {
    group: "Cards / 3DS2 / push",
    vars: [
      // Rain (Signify Holdings) card issuing. NOT requiredWhenLive: no issuer
      // contract exists, and CARD_ISSUING_LIVE carries an `unimplemented`
      // reason that is checked BEFORE `enabled`, so setting these cannot turn
      // card issuing on. They are registered now so the adapter has somewhere
      // to read from the day sandbox credentials arrive.
      v("RAIN_API_KEY"),
      v("RAIN_WEBHOOK_SECRET"),
      v("RAIN_API_URL"),
      v("FURLPAY_CARDAUTH_ENDPOINT_SECRET", true),
      v("FURLPAY_3DS_CHALLENGE_USD"),
      v("FURLPAY_VAPID_PUBLIC_KEY"),
      v("FURLPAY_VAPID_PRIVATE_KEY"),
      v("FURLPAY_VAPID_SUBJECT"),
      // Firebase service-account JSON (raw or base64) — FCM push to the
      // native Android app. Web-push works without it.
      v("FURLPAY_FCM_SERVICE_ACCOUNT"),
    ],
  },
  {
    // TWO DIRECTIONS, NEVER ONE SECRET.
    //
    // INBOUND — one secret per sending provider, because each provider signs
    // with its OWN scheme and rotates on its own schedule. Sharing one secret
    // across several inbound endpoints means a single leak forges all of them,
    // and it hides the fact that a handler is not really verifying that
    // provider at all. That is exactly how api/webhooks/{marqeta,wise,bridge}
    // came to verify FurlPay's own envelope while claiming to be those three;
    // all three were deleted rather than repaired, since no contract exists
    // with any of them.
    //
    // OUTBOUND — FURLPAY_ENDPOINT_SECRET is the key FurlPay signs the events it
    // SENDS with, and it is what merchants pass to
    // `Furlpay.webhooks.constructEvent` in the Node / Python / Go SDKs. It must
    // never appear on an inbound handler: an inbound endpoint verifying against
    // it would accept anything signed by a merchant integration key.
    group: "Webhook secrets",
    vars: [
      // Inbound, per provider.
      v("STRIPE_WEBHOOK_SECRET"),
      v("PERSONA_WEBHOOK_SECRET"),
      v("SUMSUB_WEBHOOK_SECRET"),
      v("DEPOSIT_WEBHOOK_SECRET"),
      v("DEPOSIT_WEBHOOK_ALLOWED_IPS"),
      v("QUICKNODE_WEBHOOK_SECRET"),
      v("GITHUB_WEBHOOK_SECRET"),
      v("TELEGRAM_WEBHOOK_SECRET"),
      v("RESEND_WEBHOOK_SECRET"),
      v("FURLPAY_CARDAUTH_ENDPOINT_SECRET"),
      // Outbound only — see the note above.
      v("FURLPAY_ENDPOINT_SECRET"),
    ],
  },
  {
    // ── Platform attestation ───────────────────────────────────────────
    //
    // Apple App Attest and Google Play Integrity. Both providers report
    // `not_configured` — never `passed` — until these are set AND the
    // signature/decode verification is implemented. See lib/integrity/.
    //
    // A verdict is a SIGNAL, not a gate: Apple's guidance is to onboard App
    // Attest gradually and handle unsupported devices, so a missing verdict
    // weights the risk engine rather than blocking a customer.
    group: "Platform attestation",
    vars: [
      v("APPLE_TEAM_ID"),
      v("APPLE_APP_ATTEST_BUNDLE_ID"),
      // "development" | "production" — App Attest has separate environments
      // and a token minted in one does not verify in the other.
      v("APPLE_APP_ATTEST_ENVIRONMENT"),
      v("ANDROID_PACKAGE_NAME"),
      v("PLAY_INTEGRITY_SERVICE_ACCOUNT"),
      // Play App Signing certificate SHA-256 digests (comma-separated, as Play
      // Integrity reports them). Without them enforce mode refuses every mobile token.
      v("FURLPAY_PLAY_CERT_DIGESTS"),
      // off | report | enforce (lib/attestation). Default off.
      v("FURLPAY_ATTESTATION_MODE"),
    ],
  },
  {
    // Server-driven mobile config (GET /api/app/config, lib/appConfig.ts).
    group: "Mobile app control",
    vars: [
      v("FURLPAY_MIN_ANDROID_VERSION"),
      v("FURLPAY_MIN_IOS_VERSION"),
      v("FURLPAY_APP_FORCE_UPDATE"),
      v("FURLPAY_APP_DISABLED_FEATURES"),
      v("FURLPAY_APP_MESSAGE"),
    ],
  },
  {
    group: "Compliance providers",
    vars: [
      v("SUMSUB_APP_TOKEN"),
      v("SUMSUB_SECRET_KEY"),
      v("COMPLYADVANTAGE_API_KEY"),
      // Which provider to use: 'persona' | 'sumsub' (identity), 'complyadvantage' | 'furlpay' (screening)
      v("COMPLIANCE_IDENTITY_PROVIDER"),
      v("COMPLIANCE_SCREENING_PROVIDER"),
    ],
  },
  {
    group: "Circle Compliance",
    vars: [
      v("CIRCLE_COMPLIANCE_API_KEY"),
      v("CIRCLE_COMPLIANCE_API_URL"),
    ],
  },
  {
    group: "Payments / banking rails",
    vars: [
      v("STRIPE_SECRET_KEY"),
      v("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"),
      // Apple Pay merchant identifier ("merchant.com.furlpay.app"). Paired
      // with STRIPE_SECRET_KEY by /api/topup/apple-pay: without both, a live
      // deployment refuses the capture instead of simulating one.
      v("APPLE_PAY_MERCHANT_ID"),
      v("PERSONA_API_KEY"),
      v("NEXT_PUBLIC_PERSONA_TEMPLATE_ID"),
      v("NEXT_PUBLIC_PERSONA_ENV"),
      v("ALPACA_API_KEY_ID"),
      v("ALPACA_API_SECRET_KEY"),
      v("DUFFEL_API_KEY"),
      v("DUFFEL_API_BASE"),
      // Tripadvisor Terra. Discovery/content only -- no prices, no availability,
      // no booking. Absent => discovery degrades, booking is unaffected.
      v("TRIPADVISOR_API_KEY"),
      v("GOOGLE_PLACES_API_KEY"),
      v("RESEND_API_KEY"),
      v("EMAIL_FROM"),
      // Internal inbox told about each new /partners inquiry. Unset => the inquiry
      // is still stored and its notification_state reads "not_configured".
      v("PARTNERSHIPS_NOTIFY_EMAIL"),
      v("CDP_API_KEY_ID"),
      v("CDP_API_KEY_SECRET"),
      // Internal names for the same CDP key (lib/providers/rampEnv.ts); the
      // CDP_* names above stay as the fallback.
      v("FURLGATEWAY_API_KEY_ID"),
      v("FURLGATEWAY_API_KEY_SECRET"),
    ],
  },
  {
    group: "EIP-7702 / Circle Paymaster (pay gas in USDC from an EOA)",
    vars: [
      // Per-network Circle Paymaster contract. Absent → /api/transfers/sponsored
      // reports the scheme unavailable and points clients at the sponsored
      // EIP-3009 rail instead. Never assumed present.
      v("CIRCLE_PAYMASTER_ADDRESS_ARBITRUM"),
      v("CIRCLE_PAYMASTER_ADDRESS_BASE"),
      v("CIRCLE_PAYMASTER_ADDRESS_ETHEREUM"),
      // ERC-4337 bundler that accepts the sponsored UserOperation.
      v("ERC4337_BUNDLER_URL_ARBITRUM"),
      v("ERC4337_BUNDLER_URL_BASE"),
      v("ERC4337_BUNDLER_URL_ETHEREUM"),
    ],
  },
  {
    group: "Chains / RPC",
    vars: [
      v("ARBITRUM_RPC_URL"),
      // Optional secondary RPC per network: with both set, the x402 settler /
      // verifier fail over via viem fallback() when the primary errors or
      // rate-limits (same pattern for every <NETWORK>_RPC_URL_FALLBACK).
      v("ARBITRUM_RPC_URL_FALLBACK"),
      v("ARBITRUM_SEPOLIA_RPC_URL"),
      v("ARBITRUM_SEPOLIA_RPC_URL_FALLBACK"),
      v("BASE_RPC_URL"),
      v("BASE_RPC_URL_FALLBACK"),
      v("ETHEREUM_RPC_URL"),
      v("ETHEREUM_RPC_URL_FALLBACK"),
      v("POLYGON_RPC_URL"),
      v("POLYGON_RPC_URL_FALLBACK"),
      v("ROBINHOOD_RPC_URL"),
      // The payer's wallet signs EIP-712 data bound to this address; a live
      // deployment without it fails closed in services/payments.ts.
      v("FURLPAY_ROUTER_ADDRESS", true),
      v("TREASURY_ADDRESS_BSC"),
    ],
  },
  {
    group: "Solana / cNFT",
    vars: [
      v("MERCHANT_SOLANA_WALLET"),
      v("PLATFORM_FEE_BPS"),
      v("PLATFORM_FEE_SOLANA_WALLET"),
      v("SOLANA_USDC_MINT"),
      v("SOLANA_SOL_USD_PRICE"),
      // FURL/USD for the FURL payment path. No oracle exists for FURL, so this
      // is the ONLY source of a FURL price and it fails closed: unset means FURL
      // checkout is not offered at all, rather than a rate being assumed.
      v("FURL_USD_PRICE"),
      v("SOLANA_PAYER_SECRET"),
      v("HELIUS_API_KEY"),
      v("CNFT_MERKLE_TREE"),
      v("CNFT_NETWORK"),
    ],
  },
  {
    group: "x402 / agentic",
    vars: [
      v("X402_NETWORK"),
      v("X402_PAY_TO"),
      v("X402_USDC_ADDRESS"),
      v("X402_XSGD_ADDRESS"),
      v("X402_XSGD_USD_RATE"),
      v("X402_QUOTE_SECRET"),
      // The fee-payer's ADDRESS. Required whenever a KMS signs, because the
      // KMS returns a signature and not an account — without this we do not
      // know which address the settler is acting as.
      v("FACILITATOR_EVM_ADDRESS"),
      // Live on-chain settlement: the facilitator's hot fee-payer signing key.
      // DEVELOPMENT AND STAGING ONLY — x402Settler refuses it outright when
      // financialEnvironment() === "production", which is why FACILITATOR_EVM_-
      // ADDRESS + FURLPAY_KMS_PROVIDER exist above.
      v("FACILITATOR_EVM_PRIVATE_KEY"),
      // Force EIP-3009 signature verification + real settlement independent of
      // INTEGRATION_MODE (e.g. to exercise the live path in a preview env).
      v("X402_ENFORCE_SIGNATURE"),
      v("BASE_SEPOLIA_RPC_URL"),
      v("BASE_SEPOLIA_RPC_URL_FALLBACK"),
      v("FURLPAY_API_KEY"),
      v("FURLPAY_KEY"),
      v("FURLPAY_SECRET_KEY"),
      v("FURLPAY_CREDENTIAL_SECRET"),
      v("FURLPAY_REQUIRE_AGENT_SIG"),
      v("FURLPAY_HITL_THRESHOLD_USD"),
      v("FURLPAY_HIGH_RISK_JURISDICTIONS"),
      v("FURLPAY_COMPLIANCE_OPERATOR_TOKEN"),
      v("FURLPAY_COMPLIANCE_INBOX"),
      v("ANTHROPIC_API_KEY"),
      v("COPILOT_MODEL"),
    ],
  },
  {
    group: "Swaps / yield",
    vars: [
      v("LIFI_API_KEY"),
      v("LIFI_API_URL"),
      v("LIFI_INTEGRATOR"),
      v("LIFI_FEE"),
      // Hard server-side per-transaction caps on the real execution rails
      // (lib/moneyLimits.ts). Defaults $500; raise as monitoring matures.
      v("FURLPAY_MAX_SWAP_USD"),
      v("FURLPAY_MAX_CCTP_USD"),
      v("FURLPAY_MAX_TRANSFER_USD"),
      v("MORPHO_API_URL"),
      v("MORPHO_USDC_VAULT"),
    ],
  },
  {
    group: "Community / marketing",
    vars: [
      v("DISCORD_PUBLIC_KEY"),
      v("DISCORD_GITHUB_WEBHOOK_URL"),
      // Channel webhook the daily market brief posts to
      // (/api/cron/market-brief). Unset = the job reports not_configured
      // rather than building a brief nobody receives.
      v("DISCORD_MARKET_WEBHOOK_URL"),
      // Bot token for the price cards and the new-member welcome. A BOT token
      // used with the `Bot ` auth scheme, never a user token.
      v("DISCORD_BOT_TOKEN"),
      // The server itself. Required by the welcome sweep, which has to ask
      // Discord who joined; the price cards only sanity-check it.
      v("DISCORD_GUILD_ID"),
      // Where the new-member welcome is posted (/api/cron/discord-welcome).
      // Unset = the feature is off and the job reports that rather than
      // greeting nobody in silence.
      v("WELCOME_CHANNEL_ID"),
      v("WELCOME_START_HERE_CHANNEL_ID"),
      v("WELCOME_CHANNEL_ENABLED"),
      // Onboarding DMs. Off unless explicitly enabled — Discord asks apps not
      // to open DM channels in bulk.
      v("WELCOME_DM_ENABLED"),
      v("WELCOME_MAX_AGE_HOURS"),
      // Leave off. On, the first sweep would greet the whole existing server.
      v("WELCOME_BACKFILL_ON_FIRST_RUN"),
      v("WELCOME_INCLUDE_BOTS"),
      v("WELCOME_SECURITY_NOTE"),
      // Self-serve role picker and the captcha verification panel
      // (/api/discord/roles-setup). Unset = that panel is simply not posted.
      v("ROLE_PICKER_CHANNEL_ID"),
      v("VERIFY_CHANNEL_ID"),
      // Comma-separated watchlist tickers for the daily brief. Unset =
      // the default mega-cap list. Validated in brief.ts, not trusted.
      // Minimum supported client version per platform, as JSON, e.g.
      // {"ios":"1.4.2","android":"1.4.2"}. UNSET blocks nothing — the feature
      // is inert until configured. This is how a build with a known
      // client-side bug gets retired; see lib/clientVersion.ts.
      v("FURLPAY_MIN_CLIENT_VERSIONS"),
      v("FURLPAY_BRIEF_TICKERS"),
      // Telegram chat the daily brief posts to. Falls back to
      // TELEGRAM_CHANNEL_ID so the existing channel works with no new
      // config; set this to send the brief somewhere else.
      v("TELEGRAM_MARKET_CHAT_ID"),
      v("TELEGRAM_BOT_TOKEN"),
      v("TELEGRAM_CHANNEL_ID"),
      // Telegram Mini App (/telegram): launch-data freshness and the public
      // identifiers used to build t.me launch links. Not secrets.
      v("TELEGRAM_AUTH_MAX_AGE_SECONDS"),
      v("NEXT_PUBLIC_TELEGRAM_BOT_USERNAME"),
      v("NEXT_PUBLIC_TELEGRAM_APP_SHORT_NAME"),
      v("IG_ACCESS_TOKEN"),
      v("IG_USER_ID"),
      v("CONTACT_INBOX"),
      v("SUPPORT_INBOX"),
      // Zendesk JWT SSO (/api/support/sso) — dormant until both are set.
      v("ZENDESK_SUBDOMAIN"),
      v("ZENDESK_SHARED_SECRET"),
      v("CAREERS_INBOX"),
      v("AMBASSADORS_INBOX"),
      v("HACKATHON_INBOX"),
      v("SWAG_INBOX"),
      v("NEXT_PUBLIC_HACKATHON_DEADLINE"),
      v("NEXT_PUBLIC_GA4_ID"),
      v("NEXT_PUBLIC_GSC_VERIFICATION"),
      v("NEXT_PUBLIC_BING_VERIFICATION"),
      // IndexNow key (lib/seo/indexnow.ts); public by design via /indexnow.txt.
      v("INDEXNOW_KEY"),
    ],
  },
  // --- Registered by the Sep 30 2026 environment audit ----------------------
  // Every one of these was READ by production code without being registered
  // here (AGENTS.md rule 10), so /api/security/env could not report them and
  // nothing checked their presence. envRegistry.spec.ts now fails on any
  // process.env read in src/ that is missing from this file.
  {
    group: "Secrets and signing credentials",
    vars: [
      // Cron routes accept either name; production must set one.
      v("CRON_SECRET"),
      v("FURLPAY_CRON_SECRET"),
      v("FURLPAY_WEBHOOK_SECRET"),
      v("COMPLYADVANTAGE_WEBHOOK_SECRET"),
      // MPC signing proxy (lib/signing via the server). The private key is a
      // Turnkey API credential, never a wallet key.
      v("TURNKEY_API_URL"),
      v("TURNKEY_API_PUBLIC_KEY"),
      v("TURNKEY_API_PRIVATE_KEY"),
      v("STRIPE_ISSUING_KEY"),
      v("BRIDGE_API_KEY"),
      v("FURLPAY_NFT_INDEXER"),
      v("FURLPAY_NFT_INDEXER_API_KEY"),
      v("FURLPAY_ALERT_SLACK_WEBHOOK"),
      v("FURLPAY_ALERT_WEBHOOK_URL"),
    ],
  },
  {
    group: "Chain RPC endpoints",
    vars: [
      v("SOLANA_RPC_URL"),
      v("SOLANA_DEVNET_RPC_URL"),
      v("HELIUS_RPC_URL"),
      v("ETHEREUM_SEPOLIA_RPC_URL"),
      v("ARC_RPC_URL"),
      v("ARC_TESTNET_RPC_URL"),
      v("TEMPO_RPC_URL"),
      v("TEMPO_TESTNET_RPC_URL"),
      v("CCTP_IRIS_API_URL"),
      v("CCTP_TESTNET"),
      v("REDIS_URL"),
    ],
  },
  {
    group: "Arc rail and x402 tuning",
    vars: [
      v("ARC_RAIL_LIVE"),
      v("ARC_MAINNET_ACTIVATED"),
      v("ARC_CONFIRMATIONS"),
      v("ARC_RECEIPT_TIMEOUT_MS"),
      v("X402_REQUIRE_RESOURCE_BINDING"),
      v("X402_SETTLEMENT_GAS_LIMIT"),
      v("SWAP_QUOTE_TTL_MS"),
      v("RAIN_ENFORCE_SOURCE_IP"),
    ],
  },
  {
    group: "Staking display metadata",
    vars: [
      v("FURLPAY_STAKING_ETH_VAULT_NAME"),
      v("FURLPAY_STAKING_ETH_VAULT_SYMBOL"),
      v("FURLPAY_STAKING_ETH_REBASING_NAME"),
      v("FURLPAY_STAKING_ETH_REBASING_SYMBOL"),
    ],
  },
  {
    group: "Community, market data and email",
    vars: [
      v("ALPACA_DATA_BASE"),
      v("BTC_PRICE_CHANNEL_ID"),
      v("MARKET_BRIEF_CHANNEL_ID"),
      v("MARKET_CARDS_CHANNEL_ID"),
      v("FURLPAY_DISCORD_ADMINS"),
      v("EMAIL_REPLY_TO"),
      v("FURLPAY_VERIFY_DOMAIN"),
    ],
  },
  {
    // /onchain. Explorer API key plus the ids of two SAVED queries whose output
    // columns match the contract in lib/onchain/allium.ts. Unset = those cards
    // say "not connected"; nothing is substituted.
    group: "Allium (blockchain data)",
    // Ingestion (docs/ALLIUM_INTEGRATION.md): the Beam webhook HMAC key (the
    // same value as the Allium org secret named in the sink's hash_key; >= 32
    // chars, unset = webhook refuses everything), "1" when the pipeline runs
    // is_zerolag (events arrive pre-finality), extra addresses to track, and an
    // optional allowlist narrowing the chains Allium reports as supported.
    vars: [
      v("ALLIUM_API_KEY"),
      v("ALLIUM_STABLECOIN_DAILY_QUERY_ID"),
      v("ALLIUM_CORRIDOR_QUERY_ID"),
      v("ALLIUM_STABLECOIN_CHAIN_QUERY_ID"),
      v("ALLIUM_RWA_QUERY_ID"),
      v("ALLIUM_BEAM_WEBHOOK_SECRET"),
      v("ALLIUM_BEAM_ZEROLAG"),
      v("ONCHAIN_WATCH_ADDRESSES"),
      v("ONCHAIN_SYNC_CHAINS"),
      v("ONCHAIN_NODE_CHAINS"),
      v("ONCHAIN_NODE_TOKENS"),
      // Chains whose last 1/5 min of USDC logs the live panel scans per (cached) read.
      v("ONCHAIN_LIVE_WINDOW_CHAINS"),
      // Network index bucket width: 60 | 300 | 900 | 3600 seconds (fewer header reads when wider).
      v("ONCHAIN_ASSET_BUCKET_SECONDS"),
      // Optional independent provider per chain for the USDC network index: the
      // range's last block hash and supply must match it or the range is not committed.
      v("ETHEREUM_RPC_URL_SECONDARY"),
      v("BASE_RPC_URL_SECONDARY"),
      v("ARBITRUM_RPC_URL_SECONDARY"),
      v("POLYGON_RPC_URL_SECONDARY"),
      // Ethereum USDC index (migration 0036): keyless archive RPC pool (comma
      // separated; defaults to the census-verified list; Alchemy is refused)
      // and the raw-event retention window in days (default 30).
      v("USDC_INDEX_RPC_URLS"),
      v("USDC_INDEX_PRIMARY_RPC_URL"),
      v("USDC_INDEX_RETENTION_DAYS"),
    ],
  },
  {
    group: "Build provenance (set by CI / Vercel, never secret)",
    vars: [
      v("FURLPAY_BUILD_SHA"),
      v("FURLPAY_BUILD_BRANCH"),
      v("FURLPAY_BUILD_ID"),
      v("FURLPAY_BUILD_TIME"),
      v("VERCEL_DEPLOYMENT_ID"),
      v("VERCEL_PROJECT_PRODUCTION_URL"),
    ],
  },
  {
    group: "Circle Web3 Services",
    vars: [
      v("CIRCLE_W3S_API_KEY"),
      v("CIRCLE_W3S_API_URL"),
      v("CIRCLE_W3S_APP_ID"),
    ],
  },
];

export interface EnvVarStatus extends EnvVar {
  set: boolean;
}

export interface EnvReport {
  mode: "live" | "mock";
  groups: { group: string; vars: EnvVarStatus[] }[];
  /** requiredWhenLive vars that are unset — empty means prod-ready. */
  missing: string[];
}

/** Presence report — booleans only, values never leave the process. */
export function envReport(): EnvReport {
  const live = process.env.INTEGRATION_MODE === "live";
  const groups = ENV_REGISTRY.map(({ group, vars }) => ({
    group,
    vars: vars.map((entry) => ({ ...entry, set: !!process.env[entry.name] })),
  }));
  // The KV pair is satisfiable by either naming scheme (Upstash or Vercel
  // Marketplace) — only flag it when BOTH schemes are absent.
  const kvSet =
    !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) ||
    !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
  const missing = live
    ? groups
        .flatMap((g) => g.vars)
        .filter((entry) => entry.requiredWhenLive && !entry.set)
        .map((entry) => entry.name)
        .filter((name) => !(kvSet && name.startsWith("UPSTASH_")))
    : [];
  return { mode: live ? "live" : "mock", groups, missing };
}
