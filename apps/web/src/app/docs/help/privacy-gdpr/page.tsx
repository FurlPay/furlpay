import Link from "next/link";
import { DocTitle, Lead, H2, P, UL, LI, Callout, DocPager } from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/help/privacy-gdpr");

export default function PrivacyHelp() {
  return (
    <article>
      <DocTitle eyebrow="Help Center">Privacy, Data Protection &amp; GDPR</DocTitle>
      <Lead>
        Plain-language answers to what FurlPay stores, what it deliberately does not, and how to
        exercise your data rights.
      </Lead>

      <H2 id="what-we-store">What we store</H2>
      <UL>
        <LI><b>Account data:</b> email, verification tier, region, security settings.</LI>
        <LI><b>Financial records:</b> your transactions and balances — retained as required by financial regulation, which overrides deletion for these records.</LI>
        <LI><b>Support tickets:</b> what you write to support, kept per-account with a bounded history.</LI>
      </UL>

      <H2 id="what-we-dont">What we deliberately do not store</H2>
      <UL>
        <LI><b>Passwords</b> — none exist. Sign-in is one-time codes and passkeys.</LI>
        <LI><b>Your private keys or recovery phrases</b> — FurlPay is non-custodial for on-chain assets; keys stay on your device.</LI>
        <LI>
          <b>Secrets pasted into support tickets</b> — card numbers, recovery phrases, and API
          keys are stripped automatically before a ticket is stored or emailed, keeping only safe
          fragments like a card&apos;s last four digits.
        </LI>
      </UL>

      <H2 id="secrets-in-responses">Secrets never come back out</H2>
      <P>
        API responses never include authenticator secrets, session tokens, private keys, or full
        card numbers — responses are stripped server-side as a hard rule, not a UI choice.
      </P>

      <H2 id="rights">Your GDPR rights</H2>
      <UL>
        <LI><b>Access / export:</b> request a copy of your data via a Support Center ticket in the KYC category.</LI>
        <LI><b>Rectification:</b> profile fields are self-service; verified-identity fields change via a KYC re-submission.</LI>
        <LI>
          <b>Deletion:</b> request account deletion by ticket. Everything deletable is deleted;
          transaction records required by anti-money-laundering law are retained for the statutory
          period and then destroyed. The response to your request states exactly which records
          remain and under which legal basis.
        </LI>
      </UL>
      <P>
        KYC-category tickets are mirrored into an internal compliance feed on creation, so a data
        request is visible to the compliance team immediately, not whenever a mailbox gets read.
      </P>

      <Callout type="info" title="Formal policies">
        The binding documents are the{" "}
        <Link href="/legal/privacy" className="text-neon">Privacy Policy</Link> and{" "}
        <Link href="/legal/terms" className="text-neon">Terms of Use</Link>. This article is a
        summary and the policies win where they differ.
      </Callout>

      <DocPager pathname="/docs/help/privacy-gdpr" />
    </article>
  );
}
