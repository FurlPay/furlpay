import Link from "next/link";
import { DocTitle, Lead, H2, P, UL, LI, Callout, DocPager } from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/help/passkeys-biometrics");

export default function PasskeysHelp() {
  return (
    <article>
      <DocTitle eyebrow="Help Center">Securing Your Account with Passkeys &amp; Biometrics</DocTitle>
      <Lead>
        A passkey is a WebAuthn credential created by your authenticator and unlocked using the
        method configured on your device. It lets you sign in without typing a password.
      </Lead>

      <H2 id="how-it-works">How it actually works</H2>
      <P>
        When you enroll, your authenticator creates a public-key credential and FurlPay stores the
        public credential data used to verify sign-in. The authenticator signs a one-time challenge.
        WebAuthn binds the credential to the relying-party domain, which helps prevent a look-alike
        site from using it. The exact authenticator and unlock method depend on your device.
      </P>

      <H2 id="enroll">Enrolling</H2>
      <UL>
        <LI><b>Web:</b> Settings → Security → Add passkey, then follow your browser&apos;s prompt.</LI>
        <LI><b>Mobile app:</b> a production Android or iOS app is not currently distributed. Use the web sign-in flow.</LI>
      </UL>

      <H2 id="where-used">Where biometrics gate actions</H2>
      <UL>
        <LI>Signing in (one touch, replaces the email code).</LI>
        <LI>Additional account actions may request step-up authentication where the route requires it.</LI>
        <LI>A passkey does not enable a payment rail or replace wallet review and transaction confirmation.</LI>
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
        you should never share a recovery phrase with anyone. The web signing path for some wallet
        actions uses a remote signing service; see{" "}
        <Link href="/docs/security/mpc-webauthn" className="text-neon">Signing &amp; WebAuthn</Link>{" "}
        for the custody boundary. Never type a recovery phrase into a FurlPay form.
      </Callout>

      <P>
        Deeper technical detail lives in{" "}
        <Link href="/docs/security/mpc-webauthn" className="text-neon">Signing &amp; WebAuthn</Link>.
      </P>

      <DocPager pathname="/docs/help/passkeys-biometrics" />
    </article>
  );
}
