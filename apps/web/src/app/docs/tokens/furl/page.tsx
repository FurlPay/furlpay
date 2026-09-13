import {
  DocTitle,
  Lead,
  H2,
  P,
  UL,
  LI,
  Code,
  CodeBlock,
  Callout,
  EndpointTable,
  DocPager,
} from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";
import {
  FURL_MINT,
  FURL_TOKEN_PROGRAM,
  FURL_DECIMALS,
  FURL_TOTAL_SUPPLY,
  FURL_METADATA_URI,
} from "@/lib/token/furl";

export const metadata = docMeta("/docs/tokens/furl");

export default function FurlTokenDocsPage() {
  return (
    <article>
      <DocTitle eyebrow="Tokens">FURL Token</DocTitle>
      <Lead>
        FURL is FurlPay&apos;s ecosystem payment token on Solana: a <b>Token-2022</b> mint with{" "}
        {FURL_DECIMALS} decimals and a fixed {FURL_TOTAL_SUPPLY.toLocaleString("en-US")} supply. This
        page is what you need to integrate it correctly — and the disclosures you must not drop when
        you do.
      </Lead>

      <Callout title="FURL has no peg, no reserves, and no redemption">
        FURL is positioned as the ecosystem&apos;s payment currency and is <b>intended</b> to operate
        as its stablecoin. The token implements none of that today: nothing backs it, nothing redeems
        it, and no mechanism defends a price. Do not ship copy that calls FURL a $1 stablecoin,
        fully backed, or risk-free. USDC remains the reserve-backed settlement asset.
      </Callout>

      <H2 id="identity">Identity</H2>
      <EndpointTable
        rows={[
          { method: "MINT", path: FURL_MINT, desc: "The one and only FURL mint (mainnet-beta)" },
          { method: "PROGRAM", path: FURL_TOKEN_PROGRAM, desc: "Token-2022 — NOT the legacy SPL Token program" },
          { method: "DECIMALS", path: String(FURL_DECIMALS), desc: "Fixed at creation; amounts are base units ×10⁻⁶" },
          { method: "SUPPLY", path: FURL_TOTAL_SUPPLY.toLocaleString("en-US"), desc: "1e15 base units; mint authority not yet revoked" },
        ]}
      />
      <P>
        In this repository every FURL constant comes from one module —{" "}
        <Code>apps/web/src/lib/token/furl.ts</Code> — and a test asserts it agrees with the launch
        package (<Code>packages/furl-token/src/config.ts</Code>) and the published metadata mirror.
        Import from there; never paste the mint address into a second place.
      </P>

      <H2 id="token-2022">Token-2022, not legacy SPL</H2>
      <P>
        This is the single most common integration bug with FURL. The associated-token-account
        address is derived <b>from the token program id</b>, so deriving with the legacy program
        yields a different address that no FURL transfer will ever reach — and a balance query
        against the legacy program returns nothing, which renders as a confident zero.
      </P>
      <UL>
        <LI>Pass <Code>TOKEN_2022_PROGRAM_ID</Code> to <Code>getAssociatedTokenAddressSync</Code>.</LI>
        <LI>Pass it again to the ATA-creation and <Code>transferChecked</Code> instruction builders.</LI>
        <LI>
          When reading balances with <Code>getTokenAccountsByOwner</Code>, query <b>both</b> programs
          (or filter by mint) — see <Code>lib/onchain/balances.ts</Code>.
        </LI>
      </UL>

      <H2 id="payments">Paying in FURL</H2>
      <P>
        FURL rides the existing Solana Actions payment path; it is a parameter, not a parallel
        system. The same builder produces SOL, USDC and FURL transactions.
      </P>
      <EndpointTable
        rows={[
          { method: "GET", path: "/api/actions/pay/[orderId]", desc: "Blink metadata; the FURL button appears only when FURL pricing is configured" },
          { method: "POST", path: "/api/actions/pay/[orderId]?asset=FURL", desc: "Base64 Token-2022 transferChecked transaction to sign" },
          { method: "GET", path: "/api/token/furl", desc: "Identity, allocation model, live authorities, concentration, disclosures" },
          { method: "GET", path: "/api/token/furl/balance?owner=…", desc: "FURL balance for one address; 503 when the chain is unreadable" },
        ]}
      />
      <P>
        <b>Pricing fails closed.</b> FURL has no oracle and no market, so the USD→FURL conversion
        uses an explicitly configured price (<Code>FURL_USD_PRICE</Code>). With it unset, the FURL
        button is not rendered and a <Code>?asset=FURL</Code> POST is rejected — the code never
        invents a rate. SOL still converts via its live oracle; USDC is quoted 1:1.
      </P>
      <CodeBlock lang="bash">{`# FURL checkout is off unless a real, defensible price is configured
FURL_USD_PRICE=

# balance of any address (public chain data, rate-limited)
curl "https://furlpay.com/api/token/furl/balance?owner=<solana address>"

# identity + live authority state + disclosures
curl https://furlpay.com/api/token/furl`}</CodeBlock>

      <H2 id="amounts">Amounts and precision</H2>
      <P>
        One FURL is 1,000,000 base units. Never hold a FURL amount in a JavaScript number: at 6
        decimals, base units exceed <Code>Number.MAX_SAFE_INTEGER</Code> above roughly 9,007 FURL, so
        float arithmetic starts losing value inside ordinary amounts.
      </P>
      <UL>
        <LI><Code>furlToBaseUnits(&quot;12.5&quot;)</Code> — string/bigint in, bigint out; more than 6 decimal places is <b>rejected</b>, not truncated.</LI>
        <LI><Code>baseUnitsToFurl(12500000n)</Code> — bigint in, decimal string out. No float in the path.</LI>
        <LI>Compare balances with bigint (<Code>hasSufficientFurl</Code>), never with <Code>Number()</Code>.</LI>
      </UL>

      <H2 id="validation">Validating the mint</H2>
      <P>
        A lookalike token with the same name, symbol and icon costs nothing to create. Base58 is
        case-sensitive, so compare exactly — never lowercased.
      </P>
      <CodeBlock lang="ts">{`import { assertFurlMint, isFurlMint } from "@/lib/token/furl";

// throws before any transaction is built
assertFurlMint(userSuppliedMint);

// reads are scoped by the server, not by the caller:
// /api/token/furl/balance pins the mint in code, so no query
// parameter can point it at a different token.`}</CodeBlock>
      <P>
        On-chain, transfers go out as <Code>transferChecked</Code>, which makes the runtime verify
        both the mint and the decimals. A wrong-mint or wrong-scale transfer fails on-chain instead
        of moving the wrong amount.
      </P>

      <H2 id="state">Current state, honestly</H2>
      <UL>
        <LI><b>Supply concentration:</b> 100% of FURL is in a single token account owned by the deployer key. No multisig stands in front of it yet.</LI>
        <LI><b>Mint authority:</b> still active. The 1B cap is published intent, not yet runtime-enforced. Revoking is irreversible and has not been done.</LI>
        <LI><b>Freeze authority:</b> null — no account can ever be frozen, so holders cannot be censored.</LI>
        <LI><b>Liquidity:</b> none. No pool exists, so FURL has no market price and price aggregators have nothing to index.</LI>
        <LI><b>Audit:</b> none. No third-party audit or attestation exists.</LI>
      </UL>
      <P>
        The live values for the first three are read from the chain by{" "}
        <Code>/api/token/furl</Code> and rendered on{" "}
        <a className="text-neon hover:underline" href="/token">
          /token
        </a>
        , so they stay correct as they change rather than going stale in prose.
      </P>

      <H2 id="metadata">Metadata</H2>
      <P>
        Name, symbol and URI live on the mint itself via the Token-2022 metadata-pointer and
        token-metadata extensions — no Metaplex dependency. The URI points at Arweave (via Irys), so
        FURL&apos;s identity resolves even if furlpay.com does not.
      </P>
      <CodeBlock lang="bash">{`curl ${FURL_METADATA_URI}`}</CodeBlock>

      <DocPager pathname="/docs/tokens/furl" />
    </article>
  );
}
