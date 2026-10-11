import { DocTitle, Lead, H2, P, UL, LI, Code, Callout, EndpointTable, ParameterTable, DocPager } from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/integrations/circle");

export default function CirclePage() {
  return (
    <article>
      <DocTitle eyebrow="Integrations">Circle: wallets, compliance and USDC</DocTitle>
      <Lead>
        FurlPay integrates four separate Circle products. Each has its own credentials and its own
        on/off state, so one can be configured without the others. This page lists what each
        integration does, who holds the keys, and what a deployment must set.
      </Lead>

      <Callout type="warning" title="Integration is not partnership or endorsement">
        These integrations are built against Circle&apos;s published APIs and contracts. They do not
        imply that Circle has reviewed, approved or partnered with FurlPay. Each integration is
        inactive until its own credentials are present on the deployment.
      </Callout>

      <H2 id="summary">At a glance</H2>
      <ParameterTable
        params={[
          { name: "User-controlled wallets", type: "CIRCLE_W3S_*", required: false, desc: "MPC wallets the user controls with a PIN or biometric in Circle's SDK. Returns 503 until both the API key and app ID are set." },
          { name: "Compliance Engine", type: "CIRCLE_COMPLIANCE_API_KEY", required: false, desc: "Address screening layered on top of the built-in sanctions check. Unset means it is skipped." },
          { name: "CCTP V2", type: "no key", required: false, desc: "Burn-and-mint transfers of native USDC between networks. FurlPay builds the transaction data; the user's wallet signs both legs." },
          { name: "Paymaster", type: "CIRCLE_PAYMASTER_ADDRESS_*", required: false, desc: "Pay network gas in USDC from an ordinary account. Not enabled: no delegate contract is allowlisted." },
        ]}
      />

      <H2 id="wallets">User-controlled wallets</H2>
      <P>
        The server creates a Circle user for the signed-in account, then hands the user&apos;s own
        device a 60-minute user token and encryption key. Circle&apos;s SDK uses those to show its
        PIN or biometric screen and complete each challenge.
      </P>
      <UL>
        <LI><b>Who holds what.</b> The Circle API key never leaves the server. The key shares belong to Circle and the user. FurlPay never holds a share and cannot move funds from these wallets.</LI>
        <LI><b>Identity mapping.</b> The Circle user ID is derived from a hash of the FurlPay user ID, so Circle is not given FurlPay&apos;s internal identifiers.</LI>
        <LI><b>Networks.</b> Ethereum, Arbitrum, Base, Polygon, Solana, Avalanche and OP Mainnet, plus their testnets. A sandbox key (<Code>TEST_API_KEY:</Code> prefix) can only create testnet wallets; the API reports the environment and offers only matching networks.</LI>
        <LI><b>Creation is a challenge.</b> No wallet exists until the user completes the setup challenge on their device. Poll the challenge endpoint for the real status; it is read from Circle each time.</LI>
      </UL>
      <EndpointTable
        rows={[
          { method: "GET", path: "/api/wallets/circle", desc: "The user's Circle wallets with balances, available networks and environment" },
          { method: "POST", path: "/api/wallets/circle", desc: "Start PIN setup and wallet creation: { blockchains[], accountType? }" },
          { method: "GET", path: "/api/wallets/circle/challenge?id=", desc: "Status of a challenge: PENDING, IN_PROGRESS, COMPLETE, FAILED or EXPIRED" },
          { method: "POST", path: "/api/wallets/circle/transfer", desc: "Create a transfer challenge from one of the user's wallets" },
        ]}
      />
      <P>
        <b>Transfers.</b> FurlPay moves nothing. It creates a transfer challenge and Circle executes
        the transfer only after the user approves it in the SDK. Before creating the challenge the
        server enforces its own policy:
      </P>
      <UL>
        <LI>the wallet must be one Circle lists under this user&apos;s token;</LI>
        <LI>USDC only, so the amount is in US dollars and the verification-tier limit applies correctly;</LI>
        <LI>the amount must not exceed the balance Circle reports;</LI>
        <LI>both parties are screened, and a <Code>review</Code> result refuses with <Code>409</Code>;</LI>
        <LI>the client&apos;s idempotency key is passed to Circle, so a retry returns the same challenge.</LI>
      </UL>

      <H2 id="compliance">Compliance Engine</H2>
      <P>
        When configured, every address screen also asks Circle&apos;s screening API. The stricter of
        the two verdicts wins. Circle&apos;s screening covers Ethereum, Polygon, Arbitrum,
        Avalanche, OP Mainnet and Solana. It does not cover Base, so Base addresses receive the
        built-in sanctions check only, and the result records which layers ran.
      </P>
      <P>
        Once configured, the integration fails closed: a network error, a non-2xx response or a
        response without a result is a block. Results are cached for 60 seconds. See{" "}
        <a href="/docs/compliance/screening" className="text-neon hover:underline">Screening and cases</a>.
      </P>

      <H2 id="cctp">CCTP V2</H2>
      <P>
        Cross-chain USDC uses Circle&apos;s burn-and-mint protocol with no wrapped tokens. FurlPay
        returns unsigned transaction data and polls the attestation service; the user&apos;s wallet
        signs and submits the burn and the mint. Details and limits are in{" "}
        <a href="/docs/payments/cctp" className="text-neon hover:underline">CCTP Cross-Chain</a>.
      </P>

      <H2 id="issuer">USDC contracts and the issuer blocklist</H2>
      <P>
        Payment, payroll and on-chain reads use Circle-issued native USDC addresses, checked against
        Circle&apos;s published contract list. When a merchant payment is verified, the payer and the
        destination are also checked against the USDC contract&apos;s on-chain blocklist. A payment
        involving a blocked address is held for review rather than credited.
      </P>

      <H2 id="paymaster">Paymaster (not enabled)</H2>
      <P>
        The code describes a scheme where an ordinary account delegates to a smart-account
        implementation (EIP-7702) and pays gas in USDC through Circle Paymaster. It is not usable
        today: the allowlist of delegate contracts ships empty, because an unverified delegate
        address could drain an account. <Code>GET /api/transfers/sponsored</Code> reports which
        pieces are missing. Always call it before asking a user to sign a delegation.
      </P>

      <H2 id="setup">Setup</H2>
      <UL>
        <LI><Code>CIRCLE_W3S_API_KEY</Code> and <Code>CIRCLE_W3S_APP_ID</Code> — both required for wallets. <Code>CIRCLE_W3S_API_URL</Code> optionally overrides the base URL.</LI>
        <LI><Code>CIRCLE_COMPLIANCE_API_KEY</Code> — enables address screening. <Code>CIRCLE_COMPLIANCE_API_URL</Code> optionally overrides the base URL.</LI>
        <LI><Code>CCTP_IRIS_API_URL</Code> and <Code>CCTP_TESTNET</Code> — attestation service settings. <Code>FURLPAY_MAX_CCTP_USD</Code> sets the per-transaction cap (default 500 USD).</LI>
        <LI><Code>CIRCLE_PAYMASTER_ADDRESS_ARBITRUM</Code>, <Code>_BASE</Code>, <Code>_ETHEREUM</Code> and the matching <Code>ERC4337_BUNDLER_URL_*</Code> — required for the paymaster scheme, together with a reviewed delegate allowlist entry.</LI>
        <LI>The web client loads Circle&apos;s <Code>@circle-fin/w3s-pw-web-sdk</Code> to complete challenges.</LI>
      </UL>

      <DocPager pathname="/docs/integrations/circle" />
    </article>
  );
}
