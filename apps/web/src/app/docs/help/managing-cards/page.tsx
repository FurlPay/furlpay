import { DocTitle, Lead, H2, P, Callout, DocPager } from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/help/managing-cards");

export default function ManagingCardsHelp() {
  return (
    <article>
      <DocTitle eyebrow="Help Center">Virtual card availability</DocTitle>
      <Lead>
        FurlPay does not currently offer a production card program. The card routes and older
        examples in this documentation do not mean a FurlPay card can be ordered or used today.
      </Lead>

      <Callout type="warning" title="No FurlPay cards are available">
        Card issuing is planned, not a live service. You cannot create, activate, reveal or manage a
        FurlPay-issued virtual card in production.
      </Callout>

      <H2 id="third-party">If you have a card from another provider</H2>
      <P>
        FurlPay cannot view or change a third-party card&apos;s limits, freeze state, merchant
        controls or transaction history. Contact the card issuer directly for support.
      </P>

      <H2 id="availability">Check product availability</H2>
      <P>
        The <a href="/docs" className="text-neon hover:underline">service availability overview</a>{" "}
        lists current production capabilities. We will update this guide if card issuing becomes
        available.
      </P>

      <DocPager pathname="/docs/help/managing-cards" />
    </article>
  );
}
