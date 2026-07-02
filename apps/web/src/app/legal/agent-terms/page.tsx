import Link from "next/link";
import { DocTitle, Lead, H2, P, UL, LI, Code, Callout } from "@/components/docs/prose";

export const metadata = {
  title: "Agent Terms of Use — Furlpay Legal",
  description: "Terms governing AI agents that transact through Furlpay's x402 facilitator and MCP server.",
};

export default function AgentTermsPage() {
  return (
    <article>
      <DocTitle eyebrow="Legal">Agent Terms of Use</DocTitle>
      <p className="mb-6 text-[13px] text-textMuted">Last updated: July 2, 2026</p>
      <Lead>
        These terms govern autonomous and semi-autonomous software agents that transact through Furlpay —
        via the <Code>x402</Code> facilitator, the MCP server, or agent spend cards. If you deploy an agent
        that uses Furlpay, you accept these terms on its behalf.
      </Lead>

      <H2 id="operator">1. Operator responsibility</H2>
      <P>
        Every agent acts under a human or organizational <b>operator</b>. The operator is fully responsible
        for the agent&apos;s actions, configuration and spend. Authorizing an agent does not transfer
        liability to Furlpay.
      </P>

      <H2 id="mandates">2. Mandates & spend limits</H2>
      <UL>
        <LI>Agents may only transact within the budgets, velocity caps and allowlists configured by the operator.</LI>
        <LI>Every payment must reference a valid, unexpired authorization; single-use nonces prevent replay.</LI>
        <LI>Spend above configured thresholds requires human-in-the-loop approval.</LI>
      </UL>

      <H2 id="verification">3. Payment integrity</H2>
      <P>
        The x402 facilitator verifies each payment against the resource server&apos;s requirements —
        amount, recipient and network are checked server-side, and replays are rejected. Operators must not
        attempt to bypass these controls or forge authorizations.
      </P>

      <H2 id="prohibited">4. Prohibited agent behaviour</H2>
      <UL>
        <LI>Circumventing spend limits, approvals, KYC or sanctions controls.</LI>
        <LI>Using another party&apos;s funds or credentials without authorization.</LI>
        <LI>Automated activity that constitutes market manipulation, fraud or abuse (see the{" "}
          <Link href="/legal/acceptable-use" className="text-neon hover:underline">Acceptable Use Policy</Link>).</LI>
      </UL>

      <H2 id="audit">5. Auditability</H2>
      <P>
        Agent transactions are logged with their mandate reference and settlement receipt. Operators are
        responsible for retaining and reviewing this audit trail.
      </P>

      <Callout title="Revocation">
        Operators can revoke an agent&apos;s authority at any time. Furlpay may suspend an agent or operator
        that breaches these terms or triggers risk controls, without notice where necessary.
      </Callout>

      <div className="mt-12 border-t border-white/5 pt-6 text-[13px] text-textMuted">
        Building an agent? See the{" "}
        <Link href="/docs/payments/agentic-x402" className="text-neon hover:underline">x402 docs</Link> and{" "}
        <a href="https://github.com/FurlPay/furlpay-x402" className="text-neon hover:underline">@furlpay/x402</a>.
      </div>
    </article>
  );
}
