import Link from "next/link";
import { DocTitle, Lead, H2, P, UL, LI, Code, Callout, DocPager } from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/help/getting-started");

export default function GettingStartedHelp() {
  return (
    <article>
      <DocTitle eyebrow="Help Center">Getting started with FurlPay</DocTitle>
      <Lead>
        Create an account, secure it with a passkey, then review which FurlPay services are
        currently available before connecting a wallet or building a payment flow.
      </Lead>

      <H2 id="create-account">1. Create or access your account</H2>
      <P>
        Start at <Link href="/signup" className="text-neon">furlpay.com/signup</Link>. Use one of
        the sign-in methods shown on the page for your account and region. Do not share a one-time
        code, session cookie or recovery phrase with anyone.
      </P>

      <H2 id="passkey">2. Secure account access</H2>
      <P>
        Where available, add a passkey under <b>Settings → Security</b>. A passkey uses your
        device&apos;s authentication prompt to prove account access. Read{" "}
        <Link href="/docs/help/passkeys-biometrics" className="text-neon">Passkeys &amp; Biometrics</Link>{" "}
        for enrollment and recovery guidance.
      </P>

      <H2 id="services">3. Review available services</H2>
      <P>
        The <Link href="/docs" className="text-neon">service availability overview</Link> describes
        what FurlPay currently offers and what is still in development. FurlPay does not currently
        provide production card issuing, local bank accounts, fiat payouts, live stock order
        execution or travel booking.
      </P>

      <H2 id="payments">4. Before starting a payment</H2>
      <UL>
        <LI>Read the current status from <Code>/api/rails</Code> for the selected payment rail.</LI>
        <LI>Confirm the asset, network, recipient, amount and fees before signing anything.</LI>
        <LI>Do not treat a quote, payment ID or signing request as proof that funds moved.</LI>
        <LI>Wait for a confirmed settlement status and transaction reference.</LI>
      </UL>

      <Callout type="warning" title="Do not send funds to an unverified address">
        Use a receive address only when the signed-in FurlPay product explicitly shows it for your
        account, asset and network. If no address is shown, do not send funds to FurlPay.
      </Callout>

      <H2 id="verification">Identity checks</H2>
      <P>
        Verification requirements and availability vary by account, provider and region. Follow
        only the instructions shown in your signed-in account. FurlPay will not ask you to email a
        recovery phrase or private key.
      </P>

      <DocPager pathname="/docs/help/getting-started" />
    </article>
  );
}
