import Link from "next/link";
import { DocTitle, Lead, H2, P, Callout, ParameterTable, DocPager } from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/help/declined-transactions");

export default function DeclinesHelp() {
  return (
    <article>
      <DocTitle eyebrow="Help Center">Troubleshooting Declined Transactions</DocTitle>
      <Lead>
        A decline always has exactly one cause, and every cause has a fix you can apply yourself.
        Work down this table — it is ordered by how often each one actually happens.
      </Lead>

      <H2 id="causes">Causes and fixes</H2>
      <ParameterTable
        params={[
          { name: "Card frozen", type: "most common", required: false, desc: "You (or the co-pilot, at your request) froze it. Cards -> Unfreeze, retry." },
          { name: "3-D Secure approval pending", type: "large purchases", required: false, desc: "The purchase is waiting for you in Approvals. Approve with your passkey within the challenge window or it declines automatically." },
          { name: "Per-purchase limit", type: "single payment too big", required: false, desc: "Raise the per-purchase limit in card settings, retry, then set it back." },
          { name: "Daily limit reached", type: "cumulative", required: false, desc: "Wait for the midnight UTC reset, or raise the daily limit for today." },
          { name: "Channel disabled", type: "wrong context", required: false, desc: "An online-only card used in person (or vice versa). Enable the channel in card settings." },
          { name: "Insufficient balance", type: "check funding", required: false, desc: "The card spends your stablecoin balance. Top up, or change the card's asset priority if funds sit in a different token." },
        ]}
      />

      <H2 id="finding-cause">Finding the cause fast</H2>
      <P>
        The declined transaction appears in your history with the reason in its subtitle. Faster
        still: ask the co-pilot &quot;why did my card decline?&quot; — it reads the card&apos;s
        state (frozen, limits, spent-today) directly. Pending 3-D Secure challenges live in{" "}
        <b>Approvals</b>, and enabling notifications means the approval prompt reaches you while
        you are still at the checkout.
      </P>

      <H2 id="merchant-side">When it is the merchant, not you</H2>
      <P>
        If the card is unfrozen, within limits, on the right channel, and funded — and the decline
        persists — the refusal is coming from the merchant&apos;s side. Retry once; if it repeats,
        open a ticket in the cards category with the merchant name and timestamp and we can see
        the authorization attempt from our end.
      </P>

      <Callout type="info" title="Declines cost nothing">
        A declined authorization never moves money and never charges a fee. The amount some
        merchants show as &quot;held&quot; is their pre-authorization releasing, not a charge.
      </Callout>

      <P>
        Related: <Link href="/docs/help/freeze-unfreeze" className="text-neon">Freezing &amp; Unfreezing</Link>,{" "}
        <Link href="/docs/help/managing-cards" className="text-neon">Managing Virtual Cards</Link>.
      </P>

      <DocPager pathname="/docs/help/declined-transactions" />
    </article>
  );
}
