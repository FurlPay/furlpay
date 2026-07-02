import Link from "next/link";
import { DocTitle, Lead, H2, P, UL, LI, Code } from "@/components/docs/prose";

export const metadata = {
  title: "Cookie Policy — Furlpay Legal",
  description: "How Furlpay uses cookies and local storage, and how to control them.",
};

export default function CookiePolicyPage() {
  return (
    <article>
      <DocTitle eyebrow="Legal">Cookie Policy</DocTitle>
      <p className="mb-6 text-[13px] text-textMuted">Last updated: July 2, 2026</p>
      <Lead>
        Furlpay uses a minimal set of cookies and browser storage — primarily to keep you securely signed
        in. We do not sell your data and we do not run third-party advertising trackers.
      </Lead>

      <H2 id="types">1. What we use</H2>
      <UL>
        <LI>
          <b>Strictly necessary</b> — a signed, HttpOnly session cookie (<Code>furlpay_session</Code>) that
          keeps you authenticated. The app does not function without it.
        </LI>
        <LI>
          <b>Preferences</b> — local storage for UI state (e.g. theme, dismissed prompts). Never leaves your
          device.
        </LI>
        <LI>
          <b>Analytics (privacy-preserving)</b> — aggregate, cookieless usage metrics where enabled. No
          cross-site advertising identifiers.
        </LI>
      </UL>

      <H2 id="third-party">2. Third-party contexts</H2>
      <P>
        Embedded partner flows (e.g. <Code>Persona</Code> KYC, <Code>Stripe</Code> checkout,{" "}
        <Code>Google</Code> sign-in) may set their own cookies within their own frames, governed by their
        respective policies. Our Content-Security-Policy restricts which third parties can load.
      </P>

      <H2 id="control">3. Controlling cookies</H2>
      <P>
        You can clear or block cookies in your browser settings. Blocking the strictly-necessary session
        cookie will sign you out and prevent access to the app. Where required by law (EU/UK ePrivacy),
        non-essential cookies are only set with your consent.
      </P>

      <div className="mt-12 border-t border-white/5 pt-6 text-[13px] text-textMuted">
        See our{" "}
        <Link href="/legal/privacy" className="text-neon hover:underline">Privacy Policy</Link> for how we
        handle personal data.
      </div>
    </article>
  );
}
