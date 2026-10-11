import { DocTitle, Lead, H2, P, Callout, DocPager } from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/help/declined-transactions");

export default function DeclinesHelp() {
  return (
    <article>
      <DocTitle eyebrow="Help Center">Card transaction support</DocTitle>
      <Lead>
        FurlPay does not currently issue production cards or process card authorizations. A card
        decline from another issuer must be handled by that issuer.
      </Lead>

      <Callout type="warning" title="Contact the card issuer">
        FurlPay cannot see why a third-party card transaction was declined and cannot change its
        limits, approval state or merchant controls. Use the issuer&apos;s official support
        channel. Do not share a full card number or security code in a FurlPay support ticket.
      </Callout>

      <H2 id="furlpay-payment">If a FurlPay payment did not complete</H2>
      <P>
        Check the payment&apos;s current status and the selected rail. A payment intent or prepared
        signing request is not a settled payment. If the status is unavailable, pending beyond the
        period shown by the rail, or inconsistent with the transaction on-chain, contact{" "}
        <a href="/support" className="text-neon hover:underline">FurlPay Support</a> with the
        payment ID and public transaction hash, if one exists.
      </P>

      <H2 id="status">Current product availability</H2>
      <P>
        Card issuing is not a live FurlPay service. Check the{" "}
        <a href="/docs" className="text-neon hover:underline">service availability overview</a>{" "}
        for current payment capabilities.
      </P>

      <DocPager pathname="/docs/help/declined-transactions" />
    </article>
  );
}
