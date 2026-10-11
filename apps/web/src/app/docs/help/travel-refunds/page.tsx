import { DocTitle, Lead, H2, P, Callout, DocPager } from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/help/travel-refunds");

export default function TravelRefundsHelp() {
  return (
    <article>
      <DocTitle eyebrow="Help Center">Travel cancellations and refunds</DocTitle>
      <Lead>
        FurlPay does not currently operate a production travel booking service, so it cannot
        cancel or refund a FurlPay travel reservation.
      </Lead>

      <Callout type="warning" title="Contact the booking provider">
        If you booked through another provider, its fare or hotel rate rules determine cancellation
        and refund eligibility. Use the merchant&apos;s support details on your confirmation.
        FurlPay cannot promise a refund or change the booking.
      </Callout>

      <H2 id="payment">A FurlPay payment is separate from a travel reservation</H2>
      <P>
        If you made a separate FurlPay payment to a merchant, check the payment status and contact
        that merchant about its cancellation terms. A stablecoin transfer may be irreversible once
        settled; do not assume that cancelling a service automatically returns funds.
      </P>

      <H2 id="status">Current availability</H2>
      <P>
        Travel search and booking status are listed in the{" "}
        <a href="/docs" className="text-neon hover:underline">service availability overview</a>.
        The Travel MCP examples are development documentation, not a production booking or refund
        guarantee.
      </P>

      <DocPager pathname="/docs/help/travel-refunds" />
    </article>
  );
}
