import Link from "next/link";
import { DocTitle, Lead, H2, P, UL, LI, Callout, DocPager } from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/help/kyc-verification");

export default function KycHelp() {
  return (
    <article>
      <DocTitle eyebrow="Help Center">Identity verification</DocTitle>
      <Lead>
        Verification requirements depend on the service, provider, account and region. FurlPay
        does not publish a universal tier-to-limit schedule.
      </Lead>

      <Callout type="warning" title="Follow only the instructions in your account">
        If identity verification is available for your account, the signed-in product will show
        the supported provider and required steps. Do not email identity documents or use a
        verification link sent outside FurlPay&apos;s official product.
      </Callout>

      <H2 id="documents">Prepare documents only when requested</H2>
      <P>
        The provider and jurisdiction determine which documents are accepted. Follow the exact
        instructions in the verification flow; this guide does not establish eligibility,
        verification limits or approval timeframes.
      </P>

      <H2 id="status">Check a pending review</H2>
      <UL>
        <LI>Use the verification status shown in your signed-in account.</LI>
        <LI>If the flow shows an inquiry or case reference, include that reference in a support request.</LI>
        <LI>Do not submit the same document through another provider unless the account flow asks you to.</LI>
      </UL>

      <H2 id="help">Get help safely</H2>
      <P>
        For help with a verification request, contact{" "}
        <Link href="/support" className="text-neon">FurlPay Support</Link> from the official site.
        Never send a recovery phrase, private key, one-time code or API secret.
      </P>

      <DocPager pathname="/docs/help/kyc-verification" />
    </article>
  );
}
