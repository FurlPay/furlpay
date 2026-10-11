import Link from "next/link";
import { DocTitle, Lead, H2, P, Callout, DocPager } from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/help/freeze-unfreeze");

export default function FreezeHelp() {
  return (
    <article>
      <DocTitle eyebrow="Help Center">Card freezing availability</DocTitle>
      <Lead>
        FurlPay does not currently issue production cards, so card freeze and unfreeze controls are
        not available.
      </Lead>

      <Callout type="warning" title="FurlPay cannot freeze a third-party card">
        If you are concerned about a card issued by another provider, use that issuer&apos;s app or
        contact its support team immediately. FurlPay cannot block authorizations on a card it did
        not issue.
      </Callout>

      <H2 id="account">Secure your FurlPay account</H2>
      <P>
        If you think your FurlPay account or device is compromised, use the account security
        controls in FurlPay and contact{" "}
        <Link href="/support" className="text-neon hover:underline">FurlPay Support</Link>. Never send a
        recovery phrase, private key, full card number or API secret in a support request.
      </P>

      <H2 id="status">Product status</H2>
      <P>
        See the <a href="/docs" className="text-neon hover:underline">service availability overview</a>{" "}
        for current card and account capabilities.
      </P>

      <DocPager pathname="/docs/help/freeze-unfreeze" />
    </article>
  );
}
