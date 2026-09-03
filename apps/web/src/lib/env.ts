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
      v("FURLPAY_ORIGIN"),
      // Signing-cert SHA-256 -> the native app's android:apk-key-hash WebAuthn
      // origin. Required for passkey sign-in from the Android app.
      v("FURLPAY_ANDROID_CERT_SHA256"),
      // Exact Chrome extension id(s) allowed to assert a furlpay.com passkey
      // (Chrome 122+). Widens the signing surface — see lib/webauthn.ts.
      v("FURLPAY_EXTENSION_ID"),
      v("ALLOW_GUEST_LOGIN"),
      v("NEXT_PUBLIC_ALLOW_GUEST"),
      v("FURLPAY_ADMIN_EMAIL"),
      // Self-custodial wallet rollout stage (0=off). 1=wallet linking only.
      // docs/SELF-CUSTODIAL-WALLET-DESIGN.md.
      v("FURLPAY_SELF_CUSTODY_STAGE"),
      // The deployment's FINANCIAL environment: development | staging |
      // production. Deliberately separate from NODE_ENV, which Next sets to
      // "production" for preview branches too — inferring from it would mark a
      // preview as a place real money may move. See lib/flags.ts.
      v("FURLPAY_ENV"),
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
      v("BROKERAGE_LIVE"),
      v("TOKENIZED_STOCKS_LIVE"),
      v("ONCHAIN_SETTLEMENT_LIVE"),
      v("ONCHAIN_BALANCES_LIVE"),
      v("DEFI_COLLATERAL_LIVE"),
      v("AI_TRADING_LIVE"),
      v("CROSS_CHAIN_STOCKS_LIVE"),
      v("HARDWARE_WALLET_LIVE"),
      // Set only after a person has verified at least one tokenized-equity
      // contract address against its issuer — see lib/onchain/stockTokenRegistry.ts.
      v("FURLPAY_STOCK_TOKEN_REGISTRY_VERIFIED"),
      // Which key-management backend signs on-chain transactions. Absent or
      // "env" keeps ONCHAIN_SETTLEMENT_LIVE unavailable.
      v("FURLPAY_KMS_PROVIDER"),
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
    vars: [v("SUPABASE_URL"), v("SUPABASE_SERVICE_ROLE_KEY")],
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
    group: "Webhook secrets",
    vars: [
      v("STRIPE_WEBHOOK_SECRET"),
      v("PERSONA_WEBHOOK_SECRET"),
      v("SUMSUB_WEBHOOK_SECRET"),
      v("DEPOSIT_WEBHOOK_SECRET"),
      v("DEPOSIT_WEBHOOK_ALLOWED_IPS"),
      v("QUICKNODE_WEBHOOK_SECRET"),
      v("GITHUB_WEBHOOK_SECRET"),
      v("TELEGRAM_WEBHOOK_SECRET"),
      v("RESEND_WEBHOOK_SECRET"),
      v("FURLPAY_ENDPOINT_SECRET"),
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
      v("CDP_API_KEY_ID"),
      v("CDP_API_KEY_SECRET"),
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
      // Live on-chain settlement: the facilitator's hot fee-payer signing key.
      // Required when INTEGRATION_MODE=live — without it settle() fails closed
      // rather than crediting against a mock settlement.
      v("FACILITATOR_EVM_PRIVATE_KEY"),
      // Force EIP-3009 signature verification + real settlement independent of
      // INTEGRATION_MODE (e.g. to exercise the live path in a preview env).
      v("X402_ENFORCE_SIGNATURE"),
      v("BASE_SEPOLIA_RPC_URL"),
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
      v("FURLPAY_BRIEF_TICKERS"),
      // Telegram chat the daily brief posts to. Falls back to
      // TELEGRAM_CHANNEL_ID so the existing channel works with no new
      // config; set this to send the brief somewhere else.
      v("TELEGRAM_MARKET_CHAT_ID"),
      v("TELEGRAM_BOT_TOKEN"),
      v("TELEGRAM_CHANNEL_ID"),
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
