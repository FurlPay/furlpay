import Link from "next/link";
import { DocTitle, Lead, H2, P, UL, LI, Callout } from "@/components/docs/prose";

export const metadata = {
  title: "Subprocessor List — Furlpay Legal",
  description:
    "Complete list of third-party subprocessors used by Furlpay, including their function, data categories processed, and hosting locations.",
};

export default function SubprocessorsPage() {
  return (
    <article>
      <DocTitle eyebrow="Legal">Subprocessor List</DocTitle>
      <p className="mb-6 text-[13px] text-textMuted">Last updated: July 2, 2026</p>
      <Lead>
        Furlpay engages the following third-party subprocessors to deliver our services. This list
        is maintained pursuant to our{" "}
        <Link href="/legal/dpa" className="text-neon hover:underline">
          Data Processing Agreement
        </Link>{" "}
        and is updated at least 30 days before any subprocessor change takes effect.
      </Lead>

      <Callout title="Change notifications">
        To receive email notifications when this list is updated, enable{" "}
        <strong>Privacy notifications</strong> in Settings → Privacy → Communication Preferences.
        You may object to a new subprocessor within 14 days of receiving notice, as described in
        our DPA.
      </Callout>

      <H2 id="infrastructure">Infrastructure &amp; hosting</H2>
      <div className="mb-6 overflow-hidden rounded-xl border border-white/10">
        <table className="w-full text-left text-[13px]">
          <thead className="bg-white/[0.03] text-textSecondary">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Subprocessor</th>
              <th className="px-4 py-2.5 font-semibold">Function</th>
              <th className="px-4 py-2.5 font-semibold">Data processed</th>
              <th className="px-4 py-2.5 font-semibold">Location</th>
            </tr>
          </thead>
          <tbody className="text-textMuted">
            <tr className="border-t border-white/5">
              <td className="px-4 py-2.5 font-medium text-white/90">Vercel, Inc.</td>
              <td className="px-4 py-2.5">Edge hosting, CDN, serverless compute</td>
              <td className="px-4 py-2.5">HTTP request metadata, IP addresses (anonymized at edge)</td>
              <td className="px-4 py-2.5">
                <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] font-semibold">US</span>
              </td>
            </tr>
            <tr className="border-t border-white/5">
              <td className="px-4 py-2.5 font-medium text-white/90">Supabase, Inc.</td>
              <td className="px-4 py-2.5">PostgreSQL database, authentication, real-time subscriptions</td>
              <td className="px-4 py-2.5">Account data, encrypted user records, session tokens</td>
              <td className="px-4 py-2.5">
                <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] font-semibold">US</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <H2 id="identity-compliance">Identity &amp; compliance</H2>
      <div className="mb-6 overflow-hidden rounded-xl border border-white/10">
        <table className="w-full text-left text-[13px]">
          <thead className="bg-white/[0.03] text-textSecondary">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Subprocessor</th>
              <th className="px-4 py-2.5 font-semibold">Function</th>
              <th className="px-4 py-2.5 font-semibold">Data processed</th>
              <th className="px-4 py-2.5 font-semibold">Location</th>
            </tr>
          </thead>
          <tbody className="text-textMuted">
            <tr className="border-t border-white/5">
              <td className="px-4 py-2.5 font-medium text-white/90">Persona Identities, Inc.</td>
              <td className="px-4 py-2.5">KYC identity verification, document authentication, liveness checks</td>
              <td className="px-4 py-2.5">Government ID images, selfie photos, name, DOB, address (Furlpay retains only verification status)</td>
              <td className="px-4 py-2.5">
                <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] font-semibold">US</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <H2 id="payments-banking">Payments &amp; banking</H2>
      <div className="mb-6 overflow-hidden rounded-xl border border-white/10">
        <table className="w-full text-left text-[13px]">
          <thead className="bg-white/[0.03] text-textSecondary">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Subprocessor</th>
              <th className="px-4 py-2.5 font-semibold">Function</th>
              <th className="px-4 py-2.5 font-semibold">Data processed</th>
              <th className="px-4 py-2.5 font-semibold">Location</th>
            </tr>
          </thead>
          <tbody className="text-textMuted">
            <tr className="border-t border-white/5">
              <td className="px-4 py-2.5 font-medium text-white/90">Stripe, Inc.</td>
              <td className="px-4 py-2.5">Payment processing, subscription billing, merchant payouts</td>
              <td className="px-4 py-2.5">Payment card details (tokenized), billing address, transaction metadata</td>
              <td className="px-4 py-2.5">
                <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] font-semibold">US</span>
              </td>
            </tr>
            <tr className="border-t border-white/5">
              <td className="px-4 py-2.5 font-medium text-white/90">Marqeta, Inc.</td>
              <td className="px-4 py-2.5">Card issuing (Furlpay Card), card lifecycle management, transaction authorization</td>
              <td className="px-4 py-2.5">Cardholder name, card details, transaction history, shipping address</td>
              <td className="px-4 py-2.5">
                <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] font-semibold">US</span>
              </td>
            </tr>
            <tr className="border-t border-white/5">
              <td className="px-4 py-2.5 font-medium text-white/90">Wise Payments Ltd</td>
              <td className="px-4 py-2.5">Cross-border banking, multi-currency accounts, fiat payouts</td>
              <td className="px-4 py-2.5">Account holder name, bank account details, transaction amounts</td>
              <td className="px-4 py-2.5">
                <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] font-semibold">UK</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <H2 id="crypto-digital-assets">Crypto &amp; digital assets</H2>
      <div className="mb-6 overflow-hidden rounded-xl border border-white/10">
        <table className="w-full text-left text-[13px]">
          <thead className="bg-white/[0.03] text-textSecondary">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Subprocessor</th>
              <th className="px-4 py-2.5 font-semibold">Function</th>
              <th className="px-4 py-2.5 font-semibold">Data processed</th>
              <th className="px-4 py-2.5 font-semibold">Location</th>
            </tr>
          </thead>
          <tbody className="text-textMuted">
            <tr className="border-t border-white/5">
              <td className="px-4 py-2.5 font-medium text-white/90">Turnkey Industries, Inc.</td>
              <td className="px-4 py-2.5">MPC key custody, secure key generation, transaction co-signing</td>
              <td className="px-4 py-2.5">Encrypted key shares, public wallet addresses, signing requests</td>
              <td className="px-4 py-2.5">
                <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] font-semibold">US</span>
              </td>
            </tr>
            <tr className="border-t border-white/5">
              <td className="px-4 py-2.5 font-medium text-white/90">Circle Internet Financial, LLC</td>
              <td className="px-4 py-2.5">Stablecoin issuance (USDC/EURC), programmable wallets</td>
              <td className="px-4 py-2.5">Wallet addresses, stablecoin transaction data, compliance metadata</td>
              <td className="px-4 py-2.5">
                <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] font-semibold">US</span>
              </td>
            </tr>
            <tr className="border-t border-white/5">
              <td className="px-4 py-2.5 font-medium text-white/90">Bridge.xyz (Stripe)</td>
              <td className="px-4 py-2.5">Crypto on-ramp / off-ramp, fiat-to-stablecoin conversion</td>
              <td className="px-4 py-2.5">User identity (for compliance), bank account details, conversion amounts</td>
              <td className="px-4 py-2.5">
                <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] font-semibold">US</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <H2 id="brokerage">Brokerage &amp; investments</H2>
      <div className="mb-6 overflow-hidden rounded-xl border border-white/10">
        <table className="w-full text-left text-[13px]">
          <thead className="bg-white/[0.03] text-textSecondary">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Subprocessor</th>
              <th className="px-4 py-2.5 font-semibold">Function</th>
              <th className="px-4 py-2.5 font-semibold">Data processed</th>
              <th className="px-4 py-2.5 font-semibold">Location</th>
            </tr>
          </thead>
          <tbody className="text-textMuted">
            <tr className="border-t border-white/5">
              <td className="px-4 py-2.5 font-medium text-white/90">Alpaca Securities LLC</td>
              <td className="px-4 py-2.5">US equities brokerage, trade execution, account custody (FINRA/SIPC member)</td>
              <td className="px-4 py-2.5">Full name, SSN/TIN, DOB, address, employment info, trading activity</td>
              <td className="px-4 py-2.5">
                <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] font-semibold">US</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <H2 id="analytics">Analytics &amp; observability</H2>
      <div className="mb-6 overflow-hidden rounded-xl border border-white/10">
        <table className="w-full text-left text-[13px]">
          <thead className="bg-white/[0.03] text-textSecondary">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Subprocessor</th>
              <th className="px-4 py-2.5 font-semibold">Function</th>
              <th className="px-4 py-2.5 font-semibold">Data processed</th>
              <th className="px-4 py-2.5 font-semibold">Location</th>
            </tr>
          </thead>
          <tbody className="text-textMuted">
            <tr className="border-t border-white/5">
              <td className="px-4 py-2.5 font-medium text-white/90">PostHog, Inc.</td>
              <td className="px-4 py-2.5">Product analytics, feature flags, session replay (opt-in)</td>
              <td className="px-4 py-2.5">Anonymized usage events, device type, feature interactions (IP anonymization enabled)</td>
              <td className="px-4 py-2.5">
                <span className="rounded-md border border-neon/25 bg-neonSoft px-2 py-0.5 text-[11px] font-semibold text-neon">EU</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <H2 id="safeguards">Data transfer safeguards</H2>
      <P>
        For subprocessors located in the United States, data transfers from the EEA are protected
        by:
      </P>
      <UL>
        <LI>
          <strong>EU-U.S. Data Privacy Framework (DPF)</strong> certification, where the
          subprocessor is a DPF participant (Stripe, Vercel, PostHog).
        </LI>
        <LI>
          <strong>Standard Contractual Clauses (SCCs)</strong> approved by the European Commission
          (Decision 2021/914), supplemented by transfer impact assessments, for all other
          subprocessors.
        </LI>
      </UL>
      <P>
        Wise Payments Ltd is established in the United Kingdom and data transfers from the EEA to
        the UK are covered by the European Commission&rsquo;s adequacy decision for the UK
        (Decision 2021/1772).
      </P>

      <H2 id="changes">Change log</H2>
      <div className="mb-6 overflow-hidden rounded-xl border border-white/10">
        <table className="w-full text-left text-[13px]">
          <thead className="bg-white/[0.03] text-textSecondary">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Date</th>
              <th className="px-4 py-2.5 font-semibold">Change</th>
            </tr>
          </thead>
          <tbody className="text-textMuted">
            <tr className="border-t border-white/5">
              <td className="px-4 py-2.5 font-mono">2026-07-02</td>
              <td className="px-4 py-2.5">Initial publication of subprocessor list.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="mt-12 border-t border-white/5 pt-6 text-[13px] text-textMuted">
        See also{" "}
        <Link href="/legal/dpa" className="text-neon hover:underline">Data Processing Agreement</Link>,{" "}
        <Link href="/legal/privacy" className="text-neon hover:underline">Privacy Policy</Link>, and{" "}
        <Link href="/legal/travel-rule" className="text-neon hover:underline">Travel Rule Disclosure</Link>.
      </div>
    </article>
  );
}
