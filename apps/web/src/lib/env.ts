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
      v("ALLOW_GUEST_LOGIN"),
      v("NEXT_PUBLIC_ALLOW_GUEST"),
      v("FURLPAY_ADMIN_EMAIL"),
      // Self-custodial wallet rollout stage (0=off). 1=wallet linking only.
      // docs/SELF-CUSTODIAL-WALLET-DESIGN.md.
      v("FURLPAY_SELF_CUSTODY_STAGE"),
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
    group: "Payments / banking rails",
    vars: [
      v("STRIPE_SECRET_KEY"),
      v("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"),
      v("PERSONA_API_KEY"),
      v("NEXT_PUBLIC_PERSONA_TEMPLATE_ID"),
      v("NEXT_PUBLIC_PERSONA_ENV"),
      v("ALPACA_API_KEY_ID"),
      v("ALPACA_API_SECRET_KEY"),
      v("DUFFEL_API_KEY"),
      v("DUFFEL_API_BASE"),
      v("RESEND_API_KEY"),
      v("EMAIL_FROM"),
      v("CDP_API_KEY_ID"),
      v("CDP_API_KEY_SECRET"),
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
      v("FURLPAY_ROUTER_ADDRESS"),
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
