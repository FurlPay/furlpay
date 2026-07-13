import Link from "next/link";
import { DocTitle, Lead, H2, P, UL, LI, Code, Callout, DocPager } from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/help/getting-started");

export default function GettingStartedHelp() {
  return (
    <article>
      <DocTitle eyebrow="Help Center">Getting Started with FurlPay</DocTitle>
      <Lead>
        Three steps from zero to your first stablecoin payment: create the account, secure it with
        a passkey, and add money. Ten minutes end to end.
      </Lead>

      <H2 id="create-account">1. Create your account</H2>
      <P>
        Go to <Link href="/signup" className="text-neon">furlpay.com/signup</Link> and pick a
        sign-in method:
      </P>
      <UL>
        <LI><b>Email code</b> — we send a one-time code; no password exists to be stolen.</LI>
        <LI><b>Google or Apple</b> — one tap, using the account already on your device.</LI>
        <LI><b>Phone</b> — a one-time SMS code to an E.164 number.</LI>
      </UL>
      <P>
        FurlPay has no passwords anywhere. Every method above is a one-time proof, and the session
        it creates expires on its own.
      </P>

      <H2 id="passkey">2. Add a passkey (do this first)</H2>
      <P>
        In <b>Settings → Security</b>, enroll a passkey. Your device generates a hardware-backed
        key: fingerprint or face unlocks it, and it never leaves the device. After enrollment you
        can sign in with one touch, and money movement gets a biometric confirmation step. The
        details live in{" "}
        <Link href="/docs/help/passkeys-biometrics" className="text-neon">Passkeys &amp; Biometrics</Link>.
      </P>

      <H2 id="add-money">3. Add money</H2>
      <P>From the dashboard, tap <b>Add money</b>. Three rails:</P>
      <UL>
        <LI>
          <b>Crypto deposit</b> — a QR code and address for USDC/USDT on your chosen network.
          Send from any wallet or exchange; the balance updates when the transfer confirms
          on-chain, usually within minutes.
        </LI>
        <LI>
          <b>Bank transfer</b> — virtual account details (IBAN, ACH routing, or local
          equivalents) that credit your stablecoin balance.
        </LI>
        <LI>
          <b>Card</b> — buy USDC directly with a debit card through the onramp.
        </LI>
      </UL>
      <Callout type="info" title="Pick the network your sender supports">
        USDC on Arbitrum and USDC on Base are different deposit addresses. Match the network your
        exchange or wallet sends on — the deposit screen labels each one.
      </Callout>

      <H2 id="first-send">4. Make your first payment</H2>
      <P>
        Tap <b>Send</b>, paste the recipient address (a <Code>0x…</Code> EVM address or a Solana
        address), enter the amount, and confirm with your fingerprint. See{" "}
        <Link href="/docs/help/transaction-statuses" className="text-neon">Transaction Statuses</Link>{" "}
        for what happens after you hit confirm, and{" "}
        <Link href="/docs/help/gasless-transfers" className="text-neon">Gasless Transfers</Link> for
        why there is no gas fee to worry about.
      </P>

      <H2 id="verification">Verification limits</H2>
      <P>
        A fresh account starts at verification tier 0, which is enough to explore and hold small
        balances. Higher limits require identity verification — see the{" "}
        <Link href="/docs/help/kyc-verification" className="text-neon">KYC Verification guide</Link>.
      </P>

      <DocPager pathname="/docs/help/getting-started" />
    </article>
  );
}
