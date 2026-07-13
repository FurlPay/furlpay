import Link from "next/link";
import { DocTitle, Lead, H2, P, UL, LI, Callout, ParameterTable, DocPager } from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/help/kyc-verification");

export default function KycHelp() {
  return (
    <article>
      <DocTitle eyebrow="Help Center">Identity Verification (KYC) Guide</DocTitle>
      <Lead>
        Verification is progressive: you verify exactly as much as the limits you need, and no
        more. Each tier unlocks higher balances and more rails.
      </Lead>

      <H2 id="tiers">The tiers</H2>
      <ParameterTable
        params={[
          { name: "Tier 0", type: "no documents", required: false, desc: "Explore the app, hold small balances, receive deposits." },
          { name: "Tier 1", type: "government ID", required: false, desc: "Standard sending limits and card creation." },
          { name: "Tier 2", type: "ID + proof of address", required: false, desc: "Full limits, bank virtual accounts, off-ramping to fiat." },
          { name: "Tier 3", type: "enhanced review", required: false, desc: "Business and high-volume accounts; assigned by the compliance team, not self-service." },
        ]}
      />

      <H2 id="documents">Accepted documents</H2>
      <UL>
        <LI><b>Identity:</b> passport, national ID card, or driver&apos;s license — photographed, all corners visible, not expired.</LI>
        <LI><b>Proof of address:</b> utility bill, bank statement, or government letter from the last 3 months showing your name and address.</LI>
      </UL>

      <H2 id="status">Checking your status</H2>
      <P>
        Your current tier and status (<b>unverified</b>, <b>pending</b>, or <b>verified</b>) show
        in <b>Profile → Verification</b>. You can also ask the in-app co-pilot — &quot;what&apos;s
        my KYC status?&quot; returns your tier and any outstanding documents.
      </P>

      <H2 id="troubleshooting">Fixing a failed or stuck verification</H2>
      <UL>
        <LI><b>Blurry or cropped photo</b> — the most common rejection. Retake in daylight, on a dark background, with all four corners in frame.</LI>
        <LI><b>Name mismatch</b> — the name on the document must match your profile exactly. Fix the profile first, then resubmit.</LI>
        <LI><b>Stuck in pending over 24 hours</b> — open a ticket in the KYC category from the <Link href="/support" className="text-neon">Support Center</Link>. KYC tickets route to the compliance queue directly.</LI>
        <LI><b>Country restrictions</b> — some regions cannot access all rails. If verification is refused for your region, the refusal screen says so explicitly; support cannot override it.</LI>
      </UL>

      <Callout type="warning" title="FurlPay never asks for documents by email">
        Uploads happen only inside the app or web dashboard. Anyone emailing you for a passport
        photo or a video call to &quot;verify your account&quot; is not FurlPay — report it from
        the Support Center.
      </Callout>

      <DocPager pathname="/docs/help/kyc-verification" />
    </article>
  );
}
