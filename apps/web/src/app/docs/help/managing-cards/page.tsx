import Link from "next/link";
import { DocTitle, Lead, H2, P, UL, LI, Callout, DocPager } from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/help/managing-cards");

export default function ManagingCardsHelp() {
  return (
    <article>
      <DocTitle eyebrow="Help Center">Activating and Managing Your Virtual Cards</DocTitle>
      <Lead>
        Every control on a FurlPay card applies in real time — a limit you set now applies to the
        very next authorization.
      </Lead>

      <H2 id="controls">The controls</H2>
      <UL>
        <LI><b>Label</b> — name cards by purpose (&quot;Subscriptions&quot;, &quot;Travel&quot;) so statements stay readable.</LI>
        <LI><b>Per-purchase limit</b> — the ceiling for any single authorization.</LI>
        <LI><b>Daily limit</b> — total spend per day; the card declines past it and resets at midnight UTC.</LI>
        <LI><b>Channels</b> — enable or disable online, in-person, and ATM use independently. A subscriptions card with only &quot;online&quot; enabled cannot be skimmed at a terminal.</LI>
        <LI><b>Settlement currency</b> — which currency the card settles in (USD, EUR, GBP, INR).</LI>
        <LI><b>Asset priority</b> — which stablecoin balance the card spends first.</LI>
      </UL>

      <H2 id="details">Viewing full card details</H2>
      <P>
        The number and CVV stay hidden until you pass a biometric check — a fingerprint or face
        prompt guards every reveal, on web and in the app.
      </P>

      <H2 id="approvals">Purchase approvals (3-D Secure)</H2>
      <P>
        Larger or unusual purchases trigger a challenge: the purchase pauses until you approve it
        with your passkey in <b>Approvals</b>. The approval signature is bound to that exact
        purchase. Declining is always one tap — refusing money movement is never harder than
        allowing it.
      </P>

      <H2 id="audit">Everything leaves a trail</H2>
      <P>
        Every settings change — a freeze, a limit change, a channel toggle — is written to an
        internal security event feed with the acting account, whichever surface triggered it
        (app, web, or the co-pilot).
      </P>

      <Callout type="info" title="Set limits before you need them">
        The cheapest fraud protection is a per-purchase limit sized to how you actually use the
        card. A card that only ever pays a $12 subscription has no business with a $2,500
        per-purchase ceiling.
      </Callout>

      <P>
        Card declining unexpectedly? See{" "}
        <Link href="/docs/help/declined-transactions" className="text-neon">Troubleshooting Declined Transactions</Link>.
      </P>

      <DocPager pathname="/docs/help/managing-cards" />
    </article>
  );
}
