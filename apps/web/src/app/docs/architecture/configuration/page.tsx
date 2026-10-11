import { DocTitle, Lead, H2, H3, P, UL, LI, Code, CodeBlock, Callout, ParameterTable, DocPager } from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/architecture/configuration");

export default function ConfigurationPage() {
  return (
    <article>
      <DocTitle eyebrow="Architecture">Configuration and deployment setup</DocTitle>
      <Lead>
        Most of what FurlPay can do on a given deployment is decided by configuration: which
        credentials are present, which database migrations are applied and which money flags are
        on. This page is the map. The full variable list with comments is{" "}
        <Code>apps/web/.env.example</Code>.
      </Lead>

      <Callout type="warning" title="Unset means unavailable, not simulated">
        In development, a missing credential usually selects an in-memory or demo path so the app
        runs with nothing configured. In production the same missing credential makes the route
        return <Code>503</Code>. Setting <Code>INTEGRATION_MODE=live</Code> does not make an
        unbuilt integration real.
      </Callout>

      <H2 id="layers">The three layers of gating</H2>
      <ParameterTable
        params={[
          { name: "Integration mode", type: "INTEGRATION_MODE", required: true, desc: "Deployment-wide. \"live\" permits real provider calls; anything else is mock. Production without live mode fails closed on money paths." },
          { name: "Financial environment", type: "FURLPAY_ENV", required: true, desc: "development, staging or production. Separate from NODE_ENV, because a preview build also has NODE_ENV=production and must not be treated as a place where real money moves." },
          { name: "Money flags", type: "*_LIVE", required: true, desc: "One switch per capability, default off. A flag reports on only when it is enabled, allowed in this environment, has every required credential, and the kill switch is not engaged." },
        ]}
      />
      <P>
        <Code>FURLPAY_MONEY_KILL_SWITCH</Code> disables every money capability at once and is checked
        before any flag. <Code>FURLPAY_FROZEN_API_PREFIXES</Code> freezes named API prefixes with a
        503 without a deploy.
      </P>

      <H3 id="flags">Money flags</H3>
      <ParameterTable
        params={[
          { name: "ONCHAIN_BALANCES_LIVE", type: "can enable", required: false, desc: "Read balances from chain nodes. Read-only; allowed in development." },
          { name: "HARDWARE_WALLET_LIVE", type: "can enable", required: false, desc: "Signing with an external hardware wallet. No credentials required." },
          { name: "ONCHAIN_SETTLEMENT_LIVE", type: "needs credentials", required: false, desc: "Broadcast settlement transactions. Needs FURLPAY_KMS_PROVIDER and ARBITRUM_RPC_URL." },
          { name: "BROKERAGE_LIVE", type: "needs credentials", required: false, desc: "Route orders to the brokerage. Needs the Alpaca key pair. Off means order submission returns 503." },
          { name: "AI_TRADING_LIVE", type: "needs credentials", required: false, desc: "Agent-submitted trades within a policy. Needs the Alpaca key pair." },
          { name: "TOKENIZED_STOCKS_LIVE", type: "needs registry", required: false, desc: "Needs a human-verified token registry, which ships empty." },
          { name: "ARC_RAIL_LIVE", type: "not implemented", required: false, desc: "No Arc signer is wired and no FurlPay contract is deployed to Arc." },
          { name: "CARD_ISSUING_LIVE", type: "not implemented", required: false, desc: "No card issuer is integrated." },
          { name: "BANKING_LIVE", type: "not implemented", required: false, desc: "No banking or payment-aggregator partner is contracted." },
          { name: "ONRAMP_LIVE / OFFRAMP_LIVE", type: "not implemented", required: false, desc: "No provider capability row is live; no verified-beneficiary path." },
          { name: "CREDIT_LIVE / BILL_PAY_LIVE", type: "not implemented", required: false, desc: "No lender and no biller network." },
          { name: "REWARDS_LIVE / P2P_LIVE", type: "not implemented", required: false, desc: "No rewards ledger; peer-to-peer state is not durable." },
          { name: "RECURRING_INVESTING_LIVE", type: "not implemented", required: false, desc: "Schedules are not durable and no worker executes them." },
          { name: "ACCOUNT_SPEND_LIVE", type: "not implemented", required: false, desc: "No rail delivers value debited from an account balance." },
          { name: "DEFI_COLLATERAL_LIVE / CROSS_CHAIN_STOCKS_LIVE", type: "not implemented", required: false, desc: "No collateral risk engine; no transfer-restriction checks." },
        ]}
      />
      <P>
        A flag marked not implemented can never report on, whatever the environment says. Admins can
        see every flag and the names of any missing credentials at{" "}
        <Code>GET /api/ops/readiness</Code>.
      </P>

      <H2 id="core">Core platform</H2>
      <ParameterTable
        params={[
          { name: "FURLPAY_SESSION_SECRET", type: "secret", required: true, desc: "Session signing key. Production refuses to start signing sessions without it." },
          { name: "FURLPAY_RP_ID / FURLPAY_ORIGIN", type: "config", required: true, desc: "Passkey relying-party ID and origin. Never read from the request Host header." },
          { name: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY", type: "secret", required: true, desc: "Postgres through Supabase. The service-role key is server-only; row-level security is on with no public policies." },
          { name: "UPSTASH_REDIS_REST_URL / _TOKEN", type: "secret", required: true, desc: "Durable key-value store: challenges, rate limits, webhook de-duplication, locks, operational controls. KV_REST_API_URL and _TOKEN are also honoured." },
          { name: "FURLPAY_ADMIN_EMAIL", type: "config", required: true, desc: "The only account allowed to hold the admin role." },
          { name: "CRON_SECRET / FURLPAY_CRON_SECRET", type: "secret", required: true, desc: "Scheduled-job credentials. With neither set, every cron request is refused." },
          { name: "FURLPAY_DATA_PLANE", type: "config", required: false, desc: "Preview isolation. A Vercel deployment that is not production gets no database or key-value credentials unless its scope sets this to \"isolated\", and never a production database. Leave unset in production." },
          { name: "PUBLIC_API_ORIGIN / FURLPAY_TRUSTED_PROXY_HOPS", type: "config", required: false, desc: "Needed only behind a reverse proxy other than Vercel." },
        ]}
      />
      <Callout type="info" title="The key-value store is a hard dependency">
        Rail status, rate limits and x402 controls all read the key-value store. If it is over its
        plan limit or unreachable, those endpoints answer{" "}
        <Code>503 controls_unavailable</Code> rather than guessing. Treat a rail as unavailable until
        the status endpoint answers again.
      </Callout>

      <H2 id="integrations">Integrations by area</H2>
      <ParameterTable
        params={[
          { name: "Sign-in", type: "GOOGLE_CLIENT_ID, TWILIO_*", required: false, desc: "Google sign-in and one-time codes by SMS or email." },
          { name: "Email", type: "RESEND_API_KEY, EMAIL_FROM", required: false, desc: "Transactional email. The sending domain must be verified." },
          { name: "Push", type: "FURLPAY_VAPID_*, FURLPAY_FCM_SERVICE_ACCOUNT", required: false, desc: "Web push and Android push for approval prompts." },
          { name: "Identity checks", type: "PERSONA_*, SUMSUB_*", required: false, desc: "Chosen with COMPLIANCE_IDENTITY_PROVIDER." },
          { name: "Screening", type: "CIRCLE_COMPLIANCE_API_KEY, COMPLYADVANTAGE_*", required: false, desc: "Layers on top of the built-in sanctions list." },
          { name: "Circle wallets", type: "CIRCLE_W3S_API_KEY, CIRCLE_W3S_APP_ID", required: false, desc: "Both required, or the wallet routes return 503." },
          { name: "Signing", type: "FURLPAY_KMS_PROVIDER, TURNKEY_*", required: false, desc: "Only \"turnkey\" is implemented. \"env\" is development-only and refused in production. Other values are refused by name." },
          { name: "Chain nodes", type: "*_RPC_URL", required: false, desc: "Per network, each with an optional _FALLBACK. Public endpoints are the default and are rate limited." },
          { name: "Swaps", type: "LIFI_API_KEY, LIFI_FEE", required: false, desc: "LI.FI routing. Quotes work without a key at low rate limits." },
          { name: "x402", type: "FACILITATOR_EVM_ADDRESS, X402_*", required: false, desc: "Facilitator settlement. A raw private key is refused in production; signing goes through the KMS provider." },
          { name: "Ramps", type: "FURLGATEWAY_*, FURLBRIDGE_*", required: false, desc: "Coinbase and Transak. See the ramp provider page." },
          { name: "Cards", type: "RAIN_*, FURLPAY_CARDAUTH_ENDPOINT_SECRET", required: false, desc: "Issuer adapter and authorisation webhook. Setting these does not enable card issuing." },
          { name: "Travel", type: "DUFFEL_API_KEY, TRIPADVISOR_API_KEY, GOOGLE_PLACES_API_KEY", required: false, desc: "Inventory and content. A test-mode booking key is refused in production." },
          { name: "Markets", type: "ALPACA_*", required: false, desc: "Brokerage and market data." },
          { name: "Payments (Stripe)", type: "STRIPE_*", required: false, desc: "Optional Stripe payment intents and webhook." },
          { name: "Payroll", type: "FURLPAY_ROUTER_ADDRESS_*, FURLPAY_TAX_ENCRYPTION_KEY", required: false, desc: "Router address per network and the key that seals tax records." },
          { name: "Merchant collection", type: "SUI_GRAPHQL_URL, FURLPAY_TESTNET_COLLECTION", required: false, desc: "Sui reads, and testnet collection outside production only." },
          { name: "On-chain data", type: "ALLIUM_*, ONCHAIN_*, USDC_INDEX_*", required: false, desc: "Ingestion and index settings for the on-chain dashboards." },
          { name: "Telegram", type: "TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET", required: false, desc: "Mini App sign-in and bot webhook." },
          { name: "Community bots", type: "DISCORD_*", required: false, desc: "Market brief, price cards and member welcome jobs." },
        ]}
      />

      <H2 id="limits">Server-side limits</H2>
      <UL>
        <LI><Code>FURLPAY_MAX_SWAP_USD</Code>, <Code>FURLPAY_MAX_CCTP_USD</Code>, <Code>FURLPAY_MAX_TRANSFER_USD</Code> — per-transaction caps. Each defaults to 500 USD when unset.</LI>
        <LI><Code>FURLPAY_3DS_CHALLENGE_USD</Code> — amount at which an out-of-band approval is required.</LI>
        <LI><Code>FURLPAY_AGENT_HITL_THRESHOLD_USD</Code> — agent-key spends at or above this always need a person. Default 3,000 USD.</LI>
        <LI><Code>SETTLEMENT_*</Code> — settlement circuit-breaker thresholds.</LI>
        <LI><Code>FURLPAY_MIN_CLIENT_VERSIONS</Code> — minimum app versions allowed on money routes.</LI>
      </UL>

      <H2 id="migrations">Database migrations</H2>
      <P>
        Migrations are numbered SQL files in <Code>supabase/migrations</Code> and are applied in
        order. A feature whose migration is missing reports its storage as unavailable; it does not
        fall back to memory in production.
      </P>
      <ParameterTable
        params={[
          { name: "0001 – 0030", type: "platform", required: true, desc: "Accounts, durability, ledger, payments, notifications, hotels, webhook events, analytics, usernames, control-plane approvals." },
          { name: "0031 – 0036", type: "platform", required: true, desc: "Function-execute revocation, on-chain ingestion, asset snapshots and index, CCTP records, USDC index." },
          { name: "0037", type: "settlement", required: false, desc: "Settlement workspace draft records." },
          { name: "0038", type: "settlement", required: false, desc: "Business onboarding state and the private document bucket." },
          { name: "0039", type: "compliance", required: false, desc: "Compliance cases." },
          { name: "0040", type: "payments", required: false, desc: "Merchant payment links, destinations, intents, receipts, events and the webhook outbox." },
          { name: "0041", type: "payments", required: false, desc: "Merchant webhook endpoints and the delivery claim function." },
          { name: "0042", type: "payroll, payments", required: false, desc: "Payroll rosters and runs, merchant pricing tiers, operator notes, reconciliation alerts." },
          { name: "0043", type: "payments", required: false, desc: "Sui collection: widens the network checks and accepts Sui addresses." },
          { name: "0044", type: "payroll", required: false, desc: "Contractor invitations, account linking, wallet-proven payout addresses." },
          { name: "0045", type: "payments", required: false, desc: "Merchant refunds." },
          { name: "0046", type: "payments", required: false, desc: "Liveness alerts for collection." },
          { name: "0047", type: "payments", required: false, desc: "Arc testnet collection, booked to separate testnet ledger accounts." },
          { name: "0048", type: "payroll", required: false, desc: "Excluding flagged recipients; journaling the payroll fee." },
          { name: "0049", type: "site", required: false, desc: "Partnership inquiries." },
          { name: "0050", type: "telegram", required: false, desc: "Telegram account links." },
        ]}
      />

      <H2 id="cron">Scheduled jobs</H2>
      <P>
        Every job authenticates with <Code>Authorization: Bearer &lt;CRON_SECRET&gt;</Code> or{" "}
        <Code>x-furlpay-cron-key: &lt;FURLPAY_CRON_SECRET&gt;</Code>.
      </P>
      <ParameterTable
        params={[
          { name: "/api/cron/reconcile", type: "daily, scheduled", required: true, desc: "Ledger reconciliation." },
          { name: "/api/cron/health", type: "daily, scheduled", required: true, desc: "Provider and scheduler health, including a live read against the key-value store; raises alerts." },
          { name: "/api/cron/market-brief", type: "daily, scheduled", required: false, desc: "Posts the market brief to Discord and Telegram." },
          { name: "/api/cron/price-cards", type: "daily, scheduled", required: false, desc: "Posts price cards to Discord." },
          { name: "/api/cron/discord-welcome", type: "daily, scheduled", required: false, desc: "Greets new community members." },
          { name: "/api/cron/settlement-safety", type: "daily, scheduled", required: true, desc: "Settlement circuit-breaker checks." },
          { name: "/api/cron/onchain-reconcile", type: "daily, scheduled", required: false, desc: "Reconciles on-chain ingestion." },
          { name: "/api/cron/merchant-payments", type: "every 2 minutes, scheduled", required: false, desc: "Rescans open checkouts and delivers merchant webhooks." },
          { name: "/api/cron/merchant-reconcile", type: "every 10 minutes, scheduled", required: false, desc: "Merchant and payroll reconciliation; raises alerts only." },
          { name: "/api/cron/payroll-schedules", type: "daily, scheduled", required: false, desc: "Prepares the draft batch for each recurring payroll schedule that is due (migration 0051). Never pays: the employer reviews, submits and signs each draft." },
          { name: "/api/cron/onchain-node", type: "not scheduled", required: false, desc: "On-chain node ingestion." },
          { name: "/api/cron/usdc-index", type: "not scheduled", required: false, desc: "USDC index maintenance." },
          { name: "/api/cron/ramp-maintenance", type: "not scheduled", required: false, desc: "Expires stale ramp orders and retries partner callbacks. Needs to run every few minutes." },
          { name: "/api/cron/price-alerts", type: "not scheduled", required: false, desc: "Evaluates user price alerts." },
        ]}
      />
      <P>
        &quot;Scheduled&quot; means the job is listed in <Code>apps/web/vercel.json</Code>, which has
        nine entries. The others exist as endpoints and need an external scheduler. Schedules more
        frequent than daily depend on the hosting plan; the AWS deployment schedules the same jobs
        with EventBridge.
      </P>

      <H2 id="local">Running locally</H2>
      <CodeBlock lang="bash">{`npm install
cp apps/web/.env.example apps/web/.env.local   # every value may stay blank
npm run dev                                    # starts the web app`}</CodeBlock>
      <P>
        With nothing configured the app uses in-memory stores and development-only demo paths.
        Before a production build, the claims check (<Code>npm run check:claims</Code>) runs
        automatically and fails the build if public copy describes an unavailable capability as
        available.
      </P>

      <DocPager pathname="/docs/architecture/configuration" />
    </article>
  );
}
