import Link from "next/link";
import { DocTitle, Lead, H2, P, UL, LI, Callout, DocPager } from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/help/freeze-unfreeze");

export default function FreezeHelp() {
  return (
    <article>
      <DocTitle eyebrow="Help Center">Freezing &amp; Unfreezing Cards</DocTitle>
      <Lead>
        Freezing is instant and free, and unfreezing is just as instant — so freeze first and
        investigate second. A frozen card blocks every new authorization while you figure out
        what happened.
      </Lead>

      <H2 id="freeze">Three ways to freeze</H2>
      <UL>
        <LI><b>App or web:</b> Cards → select the card → Freeze. One tap.</LI>
        <LI><b>Co-pilot:</b> type &quot;freeze my card&quot; — it identifies the card and asks you to confirm before acting.</LI>
        <LI><b>Anywhere you&apos;re signed in</b> — the state syncs immediately across app, web, and extension.</LI>
      </UL>

      <H2 id="while-frozen">What happens while frozen</H2>
      <UL>
        <LI>Every new authorization declines, including subscriptions and card-on-file retries.</LI>
        <LI>Settled transactions are unaffected; refunds to the card still arrive.</LI>
        <LI>The card&apos;s details do not change — unfreezing restores it exactly, no re-entering numbers anywhere.</LI>
      </UL>

      <H2 id="unfreeze">Unfreezing</H2>
      <P>
        Same paths in reverse. Unfreezing takes effect immediately — a merchant retrying a
        declined subscription payment will succeed on the next attempt. Both actions are recorded
        in the account&apos;s security audit trail with which surface triggered them.
      </P>

      <H2 id="fraud">If you suspect fraud, not just a lost card</H2>
      <UL>
        <LI>Freeze the card.</LI>
        <LI>Check recent transactions for authorizations you don&apos;t recognize.</LI>
        <LI>Open a ticket in the cards category from the <Link href="/support" className="text-neon">Support Center</Link> — include the merchant name and timestamp, never the full card number (it gets stripped automatically anyway).</LI>
        <LI>Consider locking the whole account in Settings → Security if your device may be compromised.</LI>
      </UL>

      <Callout type="info" title="Freeze is not delete">
        Freezing preserves the card for when the confusion resolves. There is no penalty for
        freezing on suspicion and unfreezing an hour later.
      </Callout>

      <DocPager pathname="/docs/help/freeze-unfreeze" />
    </article>
  );
}
