import Link from "next/link";
import { DocTitle, Lead, H2, P, UL, LI, Callout, DocPager } from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/help/travel-refunds");

export default function TravelRefundsHelp() {
  return (
    <article>
      <DocTitle eyebrow="Help Center">Travel Cancellations &amp; Refunds</DocTitle>
      <Lead>
        What you can get back is decided at booking time by the rate you chose — this page is
        about exercising that, and what to do when a trip goes sideways.
      </Lead>

      <H2 id="windows">Refund windows</H2>
      <UL>
        <LI><b>Refundable rates</b> — cancel from <b>Trips</b> up to the property&apos;s cutoff (shown on the rate card and your confirmation). The refund is automatic on cancellation.</LI>
        <LI><b>Non-refundable rates</b> — the discount you took at booking was the trade. Cancelling returns nothing, though some properties offer date changes: ask via a ticket and we&apos;ll take it to the property.</LI>
        <LI><b>Flights</b> — airline fare rules apply; the fare&apos;s conditions are shown before purchase.</LI>
      </UL>

      <H2 id="how-refunds-arrive">How refunds are credited</H2>
      <P>
        Refunds credit your FurlPay balance in stablecoins. The refund is denominated in the USD
        amount of the original booking — if you paid in SOL or BTC, the refund is that USD value
        at refund time, not the original token quantity. A volatile token may buy back more or
        fewer units than you spent; the USD value is what is preserved. Cashback earned on a
        refunded stay is reversed with it.
      </P>

      <H2 id="timing">Timing</H2>
      <UL>
        <LI>Cancellation confirmation: immediate, in Trips and by email.</LI>
        <LI>Balance credit: typically within minutes once the property or airline confirms; partner-side confirmation can take up to a few business days for some properties.</LI>
      </UL>

      <H2 id="problems">When something goes wrong</H2>
      <P>
        Overbooked property, cancelled flight, stay not as described: open a ticket in the{" "}
        <b>travel</b> category from the <Link href="/support" className="text-neon">Support Center</Link>{" "}
        with the trip id from your confirmation. Travel disputes go to the booking partner with
        FurlPay as your counterparty — you are not left negotiating with a hotel in another
        timezone yourself.
      </P>

      <Callout type="info" title="There are no chargebacks in crypto - and that is handled">
        Card networks give you chargebacks; stablecoin rails do not. FurlPay&apos;s dispute
        process through the booking partner is the equivalent path, which is why booking through
        Trips (rather than paying a property address directly) is what makes a refund enforceable.
      </Callout>

      <DocPager pathname="/docs/help/travel-refunds" />
    </article>
  );
}
