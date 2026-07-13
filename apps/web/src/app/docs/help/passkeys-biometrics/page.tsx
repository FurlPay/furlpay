import Link from "next/link";
import { DocTitle, Lead, H2, P, UL, LI, Callout, DocPager } from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/help/passkeys-biometrics");

export default function PasskeysHelp() {
  return (
    <article>
      <DocTitle eyebrow="Help Center">Securing Your Account with Passkeys &amp; Biometrics</DocTitle>
      <Lead>
        A passkey is a cryptographic key that lives in your device&apos;s secure hardware and is
        unlocked by your fingerprint or face. There is nothing to remember, nothing to type, and
        nothing a phishing site can steal.
      </Lead>

      <H2 id="how-it-works">How it actually works</H2>
      <P>
        When you enroll, your phone or laptop generates a key pair inside its secure element
        (Android Keystore / Apple Secure Enclave). FurlPay stores only the public half. Signing in
        means your device signs a one-time challenge after your biometric check passes — the
        private key never leaves the hardware, and the signature only works for{" "}
        <b>furlpay.com</b>, so a look-alike phishing domain gets nothing.
      </P>

      <H2 id="enroll">Enrolling</H2>
      <UL>
        <LI><b>Web:</b> Settings → Security → Add passkey, then follow your browser&apos;s prompt.</LI>
        <LI><b>Android app:</b> the login screen offers fingerprint sign-in; enrolling also signs you in, since creating the key proves it&apos;s you.</LI>
      </UL>

      <H2 id="where-used">Where biometrics gate actions</H2>
      <UL>
        <LI>Signing in (one touch, replaces the email code).</LI>
        <LI>Unlocking the mobile app after it has been backgrounded.</LI>
        <LI>Confirming money movement — sends, swaps, and staking ask again per action.</LI>
        <LI>Approving 3-D Secure card challenges — the approval signature is bound to that specific purchase and cannot be replayed for another.</LI>
        <LI>Revealing full card details.</LI>
      </UL>

      <H2 id="lost-device">If you lose a device</H2>
      <P>
        Your account is not locked to the passkey: sign in on a new device with your email code,
        then remove the old device&apos;s passkey in <b>Settings → Security</b> and enroll the new
        one. If you suspect the lost device is compromised, lock the account from Settings first
        and open a ticket.
      </P>

      <Callout type="info" title="Passkeys and your wallet keys are different things">
        The passkey authenticates you to FurlPay. It is not your wallet&apos;s recovery phrase, and
        FurlPay never has either one. Never type a recovery phrase anywhere in FurlPay — nothing in
        the product asks for it.
      </Callout>

      <P>
        Deeper technical detail lives in{" "}
        <Link href="/docs/security/mpc-webauthn" className="text-neon">MPC &amp; WebAuthn</Link>.
      </P>

      <DocPager pathname="/docs/help/passkeys-biometrics" />
    </article>
  );
}
