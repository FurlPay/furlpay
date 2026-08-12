import Link from "next/link";
import { DocTitle, Lead, H2, P, Callout } from "@/components/docs/prose";

// The Google Play "account deletion URL" (Data Safety form). Play requires a
// publicly reachable page that explains how to delete an account WITHOUT
// reinstalling the app — so this page must render for signed-out visitors and
// must describe both the in-app route and a route that needs no app at all.
//
// It is the public statement of the retention model implemented in
// lib/accountDeletion.ts and enforced by the schema (supabase/migrations 0002).
// If one changes, all of them change.

export const metadata = {
  title: "Delete your FurlPay account",
  description:
    "How to delete your FurlPay account, what is erased, and which records we are required to retain.",
};

export default function AccountDeletionPage() {
  return (
    <article>
      <DocTitle eyebrow="Legal">Delete your FurlPay account</DocTitle>
      <p className="mb-6 text-[13px] text-textMuted">Last updated: July 14, 2026</p>
      <Lead>
        You can delete your FurlPay account and the personal data attached to it at any time. This page
        explains exactly how, exactly what is removed, and — honestly — what is not.
      </Lead>

      <H2 id="how">How to delete your account</H2>
      <P>
        <b>In the app (Android):</b> open <b>Profile → Delete account</b>, read the confirmation screen and
        confirm. You will be asked to re-verify your identity first.
      </P>
      <P>
        <b>On the web, without installing anything:</b> sign in at{" "}
        <Link href="/login" className="text-accent underline">
          furlpay.com/login
        </Link>{" "}
        and go to <b>Profile → Delete account</b>. This is the same flow and needs no mobile app.
      </P>
      <P>
        <b>If you cannot sign in:</b> email{" "}
        <a href="mailto:privacy@furlpay.com" className="text-accent underline">
          privacy@furlpay.com
        </a>{" "}
        from the address registered to the account. We will verify ownership before acting on the request,
        because an unverified deletion request is itself an attack on the account holder.
      </P>

      <Callout title="You will be asked to re-authenticate">
        Deleting an account is irreversible, so a valid session is not enough on its own — we require a
        recent sign-in (a login code or your passkey). This prevents someone who has taken over an unlocked
        device from destroying your account.
      </Callout>

      <H2 id="erased">What is deleted</H2>
      <P>
        Your profile and contact details; your passkeys and any linked Google or Apple sign-in; your
        balances, holdings, cards and bills; your transaction history; trips and bookings; your linked
        wallet address; support conversations; agent and API keys; and every push-notification
        registration. Your sessions are revoked on all devices immediately, and the account can no longer
        be used to sign in.
      </P>

      <H2 id="retained">What is kept, and why</H2>
      <P>
        We will not tell you everything disappears when it does not. Two categories survive deletion:
      </P>
      <P>
        <b>On-chain deposit records.</b> Deposits that actually settled on a public blockchain are kept as
        the permanent record of funds that moved, with your account detached from them. We cannot erase a
        public blockchain, and the record of a real financial movement is not ours alone to destroy.
      </P>
      <P>
        <b>Security and compliance audit trail.</b> We keep the record that actions occurred — for fraud
        prevention, dispute resolution and security auditing. This trail records events, not your identity;
        the personal data that would tie it back to you is removed with your account.
      </P>
      <P>
        Where we are subject to financial record-keeping obligations, those obligations override deletion
        for the specific records they cover. Everything not covered is erased.
      </P>

      <H2 id="wallet">Your self-custodial wallet</H2>
      <Callout title="Your recovery phrase is on your device, not with us">
        FurlPay does not hold your self-custodial wallet&apos;s recovery phrase. It is stored in your
        device&apos;s hardware-backed keystore and released only to your biometric. Deleting your FurlPay
        account does not move, return, or destroy any on-chain funds, and it does not delete the phrase from
        your device — but we cannot recover it for you afterwards either. If that wallet holds a balance,
        back up your recovery phrase before you delete your account.
      </Callout>

      <H2 id="timing">Timing</H2>
      <P>
        Deletion is immediate: the account is unusable and personal data is erased as soon as you confirm.
        Retained records are limited to the categories above.
      </P>

      <P>
        Questions about this process:{" "}
        <a href="mailto:privacy@furlpay.com" className="text-accent underline">
          privacy@furlpay.com
        </a>
        . See also our{" "}
        <Link href="/legal/privacy" className="text-accent underline">
          Privacy Policy
        </Link>
        .
      </P>
    </article>
  );
}
