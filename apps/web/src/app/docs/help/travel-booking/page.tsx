import Link from "next/link";
import { DocTitle, Lead, H2, P, UL, LI, Callout, DocPager } from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/help/travel-booking");

export default function TravelBookingHelp() {
  return (
    <article>
      <DocTitle eyebrow="Help Center">Booking Travel with Stablecoins</DocTitle>
      <Lead>
        FurlPay Travels books hotels and flights paid in USDC, SOL, or BTC — with cashback on
        stays — from the web funnel or the mobile app.
      </Lead>

      <H2 id="web">Booking on the web</H2>
      <UL>
        <LI>Start at <Link href="/travel" className="text-neon">furlpay.com/travel</Link> — search a city, filter, pick a stay or flight.</LI>
        <LI>Checkout shows the total in your chosen pay token at the current rate before you confirm.</LI>
        <LI>Confirm with your fingerprint like any other payment; the itinerary lands in <b>Trips</b> and your email.</LI>
      </UL>

      <H2 id="mobile">Booking from the Android app</H2>
      <P>
        The app shows deals and your trips natively; tapping through to search and checkout opens
        the full funnel in a secure in-app browser, already signed in. The handoff uses a 60-second
        single-use code rather than your session token — your spend authority never appears in a
        URL where history or logs could capture it.
      </P>

      <H2 id="pricing">How pricing works</H2>
      <UL>
        <LI>Rates are quoted in USD and converted to your pay token at confirmation time — the exact token amount is on the confirm screen.</LI>
        <LI>Stays earn cashback, credited to your rewards balance after checkout.</LI>
        <LI>Some rates are non-refundable in exchange for a lower price — the rate card says which, before you pay. It matters later: see <Link href="/docs/help/travel-refunds" className="text-neon">Refunds &amp; Cancellations</Link>.</LI>
      </UL>

      <Callout type="info" title="Book with the balance, not a card">
        Travel checkout spends your FurlPay balance directly — no card in the middle means no
        card declines mid-checkout and no foreign-transaction fees on top.
      </Callout>

      <DocPager pathname="/docs/help/travel-booking" />
    </article>
  );
}
