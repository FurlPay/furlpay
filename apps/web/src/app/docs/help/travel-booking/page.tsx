import Link from "next/link";
import { DocTitle, Lead, H2, P, Callout, DocPager } from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/help/travel-booking");

export default function TravelBookingHelp() {
  return (
    <article>
      <DocTitle eyebrow="Help Center">Travel search and booking availability</DocTitle>
      <Lead>
        FurlPay hotel discovery is available, but production travel inventory, booking and payment
        are not currently available.
      </Lead>

      <Callout type="warning" title="Do not pay for a booking through a demo flow">
        A property shown in a map or a test search result is not a confirmed reservation. Do not
        submit payment or promise a booking, card authorization or refund based on a test or demo
        result.
      </Callout>

      <H2 id="discovery">Hotel discovery</H2>
      <P>
        You can explore the hotel discovery map at{" "}
        <Link href="/hotels/map" className="text-neon hover:underline">furlpay.com/hotels/map</Link>.
        Discovery results do not confirm live room inventory, a final rate or a reservation.
      </P>

      <H2 id="booking">Booking status</H2>
      <P>
        FurlPay does not currently provide production hotel or flight booking. The Travel MCP page
        describes a development integration and sample flows; its test credentials and demo
        inventory are not bookable.
      </P>

      <H2 id="external">Bookings made elsewhere</H2>
      <P>
        For a reservation made through another website, contact the merchant or booking provider
        shown on your confirmation. FurlPay cannot cancel that reservation or issue its refund.
      </P>

      <P>
        Check the <a href="/docs" className="text-neon hover:underline">service availability overview</a>{" "}
        for current product status.
      </P>

      <DocPager pathname="/docs/help/travel-booking" />
    </article>
  );
}
