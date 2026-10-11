import { DocTitle, Lead, H2, P, Code, Callout, DocPager } from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/help/gasless-transfers");

export default function GaslessHelp() {
  return (
    <article>
      <DocTitle eyebrow="Help Center">Gasless transfer availability</DocTitle>
      <Lead>
        FurlPay has implemented an EIP-3009 gas-sponsored USDC transfer flow, but the production
        relayer is not configured. Gasless sending is not currently available as a live service.
      </Lead>

      <Callout type="warning" title="Do not promise a zero-gas transfer">
        A payment authorization or fee quote does not mean FurlPay will submit it. Check{" "}
        <Code>/api/rails</Code> before offering a sponsored transfer. If the rail is unconfigured
        or its status cannot be read, stop the flow.
      </Callout>

      <H2 id="protocol">How the development flow works</H2>
      <P>
        EIP-3009 lets a USDC holder sign an authorization that binds the sender, recipient, amount
        and expiry. A configured relayer can submit it and pay network gas. The signature alone is
        not a transfer, and the relayer cannot change its signed fields.
      </P>

      <H2 id="fees">Network fees</H2>
      <P>
        When a user submits a transaction directly from their wallet, the wallet needs the
        network&apos;s gas token and the transaction may incur network fees. A FurlPay sponsor may
        pay those fees only when a production rail is enabled and its current conditions are
        shown to the user.
      </P>

      <H2 id="developers">Developer status</H2>
      <P>
        The implementation and route contract are documented for integration planning. Do not
        enable customer-facing gasless transfers based only on code presence. See{" "}
        <a href="/docs/payments/agentic-x402" className="text-neon hover:underline">agent payment protocols</a>{" "}
        and the <a href="/docs" className="text-neon hover:underline">service availability overview</a>.
      </P>

      <DocPager pathname="/docs/help/gasless-transfers" />
    </article>
  );
}
