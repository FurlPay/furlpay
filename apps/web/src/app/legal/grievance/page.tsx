import Link from "next/link";
import { DocTitle, Lead, H2, H3, P, UL, LI, Code, Callout } from "@/components/docs/prose";

export const metadata = {
  title: "Grievance Redressal Policy — Furlpay Legal",
  description:
    "Furlpay's Grievance Redressal Policy for India — Grievance Officer details, complaint process, resolution timelines, escalation to Nodal Officer, and regulatory contact information.",
};

export default function GrievancePage() {
  return (
    <article>
      <DocTitle eyebrow="Legal">Grievance Redressal Policy</DocTitle>
      <p className="mb-6 text-[13px] text-textMuted">Last updated: July 2, 2026</p>
      <Lead>
        This Grievance Redressal Policy is published in compliance with the Information Technology
        (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021, the Consumer Protection
        Act, 2019, and the Reserve Bank of India&rsquo;s Integrated Ombudsman Scheme, 2021. It
        applies to all users of Furlpay services in India.
      </Lead>

      <H2 id="grievance-officer">1. Grievance Officer</H2>
      <P>
        In accordance with Rule 3(2)(a) of the IT (Intermediary Guidelines) Rules, 2021, Furlpay
        has appointed the following Grievance Officer to address user complaints and concerns:
      </P>
      <div className="mb-6 overflow-hidden rounded-xl border border-white/10 bg-white/[0.02] p-5">
        <div className="space-y-2 text-[14px]">
          <div className="flex gap-3">
            <span className="w-28 flex-shrink-0 font-semibold text-textSecondary">Name</span>
            <span className="text-white/90">Mr. Arjun Mehta</span>
          </div>
          <div className="flex gap-3">
            <span className="w-28 flex-shrink-0 font-semibold text-textSecondary">Designation</span>
            <span className="text-white/90">Grievance Officer &amp; Head of Compliance (India)</span>
          </div>
          <div className="flex gap-3">
            <span className="w-28 flex-shrink-0 font-semibold text-textSecondary">Email</span>
            <a href="mailto:grievance@furlpay.com" className="text-neon hover:underline">
              grievance@furlpay.com
            </a>
          </div>
          <div className="flex gap-3">
            <span className="w-28 flex-shrink-0 font-semibold text-textSecondary">Phone</span>
            <span className="text-white/90">+91 80-4567-8900 (Mon–Fri, 10:00–18:00 IST)</span>
          </div>
          <div className="flex gap-3">
            <span className="w-28 flex-shrink-0 font-semibold text-textSecondary">Address</span>
            <span className="text-white/90">
              Furlpay India Operations, WeWork Embassy Golf Links, Bangalore, Karnataka 560071, India
            </span>
          </div>
        </div>
      </div>
      <P>
        The Grievance Officer is responsible for acknowledging complaints, coordinating internal
        investigation, ensuring timely resolution, and communicating outcomes to the complainant.
      </P>

      <H2 id="how-to-file">2. How to file a complaint</H2>
      <P>
        You may file a grievance through any of the following channels:
      </P>

      <H3 id="in-app">Option A: In-app complaint</H3>
      <UL>
        <LI>Open the Furlpay app and navigate to <strong>Settings → Help &amp; Support → File a Complaint</strong>.</LI>
        <LI>Select the category that best describes your issue (e.g., Transaction, Account, Card, KYC, Data Privacy).</LI>
        <LI>Provide a detailed description of the grievance, including relevant transaction IDs, dates, and screenshots.</LI>
        <LI>Submit the complaint. You will receive a unique <strong>Grievance Reference Number (GRN)</strong> via email and in-app notification.</LI>
      </UL>

      <H3 id="email">Option B: Email</H3>
      <P>
        Send a detailed complaint to{" "}
        <a href="mailto:grievance@furlpay.com" className="text-neon hover:underline">
          grievance@furlpay.com
        </a>{" "}
        with the following information:
      </P>
      <UL>
        <LI>Your registered Furlpay email address and full name.</LI>
        <LI>A clear description of the issue, including relevant dates and amounts.</LI>
        <LI>Transaction IDs or order references, if applicable.</LI>
        <LI>Any supporting documents or screenshots.</LI>
        <LI>Your preferred resolution.</LI>
      </UL>

      <H3 id="postal">Option C: Postal mail</H3>
      <P>
        Send a written complaint to the Grievance Officer at the postal address listed above,
        marked &ldquo;Attention: Grievance Officer.&rdquo; Include a return address and contact
        number for follow-up.
      </P>

      <H2 id="resolution-timeline">3. Resolution timeline</H2>
      <Callout title="30-day resolution commitment">
        Furlpay shall acknowledge every grievance within 24 hours and endeavor to resolve it within
        30 calendar days from the date of receipt, in accordance with applicable Indian regulations.
      </Callout>
      <div className="mb-6 overflow-hidden rounded-xl border border-white/10">
        <table className="w-full text-left text-[13px]">
          <thead className="bg-white/[0.03] text-textSecondary">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Stage</th>
              <th className="px-4 py-2.5 font-semibold">Timeline</th>
              <th className="px-4 py-2.5 font-semibold">Action</th>
            </tr>
          </thead>
          <tbody className="text-textMuted">
            <tr className="border-t border-white/5">
              <td className="px-4 py-2.5 font-medium text-white/90">Acknowledgment</td>
              <td className="px-4 py-2.5 font-mono text-neon">≤ 24 hours</td>
              <td className="px-4 py-2.5">Automated email/in-app confirmation with GRN issued.</td>
            </tr>
            <tr className="border-t border-white/5">
              <td className="px-4 py-2.5 font-medium text-white/90">Initial review</td>
              <td className="px-4 py-2.5 font-mono text-neon">≤ 3 business days</td>
              <td className="px-4 py-2.5">Complaint categorized, assigned to appropriate team, preliminary assessment completed.</td>
            </tr>
            <tr className="border-t border-white/5">
              <td className="px-4 py-2.5 font-medium text-white/90">Investigation</td>
              <td className="px-4 py-2.5 font-mono text-neon">≤ 15 business days</td>
              <td className="px-4 py-2.5">Detailed investigation, coordination with partners if needed, interim updates every 7 days.</td>
            </tr>
            <tr className="border-t border-white/5">
              <td className="px-4 py-2.5 font-medium text-white/90">Resolution</td>
              <td className="px-4 py-2.5 font-mono text-neon">≤ 30 calendar days</td>
              <td className="px-4 py-2.5">Final decision communicated with detailed explanation and any remedial action taken.</td>
            </tr>
          </tbody>
        </table>
      </div>
      <P>
        If additional time is required due to the complexity of the grievance or dependency on a
        third-party partner (e.g., Marqeta, Persona, banking partners), you will be informed in
        writing with a revised timeline, which shall not exceed 45 calendar days from the date of
        receipt.
      </P>

      <H2 id="escalation">4. Escalation process</H2>
      <P>
        If you are not satisfied with the resolution provided by the Grievance Officer, you may
        escalate your complaint through the following levels:
      </P>

      <H3 id="level-2">Level 2: Nodal Officer</H3>
      <P>
        If the Grievance Officer&rsquo;s resolution is unsatisfactory, you may escalate to the
        Nodal Officer within 7 calendar days of receiving the resolution:
      </P>
      <div className="mb-6 overflow-hidden rounded-xl border border-white/10 bg-white/[0.02] p-5">
        <div className="space-y-2 text-[14px]">
          <div className="flex gap-3">
            <span className="w-28 flex-shrink-0 font-semibold text-textSecondary">Name</span>
            <span className="text-white/90">Ms. Priya Sharma</span>
          </div>
          <div className="flex gap-3">
            <span className="w-28 flex-shrink-0 font-semibold text-textSecondary">Designation</span>
            <span className="text-white/90">Nodal Officer &amp; Director of Operations (India)</span>
          </div>
          <div className="flex gap-3">
            <span className="w-28 flex-shrink-0 font-semibold text-textSecondary">Email</span>
            <a href="mailto:nodal-officer@furlpay.com" className="text-neon hover:underline">
              nodal-officer@furlpay.com
            </a>
          </div>
        </div>
      </div>
      <P>
        The Nodal Officer shall review the complaint independently and provide a final decision
        within 15 calendar days of receiving the escalation.
      </P>

      <H3 id="level-3">Level 3: External regulatory bodies</H3>
      <P>
        If you remain dissatisfied after exhausting the internal grievance process, you may
        approach the following external bodies:
      </P>
      <UL>
        <LI>
          <strong>RBI Integrated Ombudsman:</strong> For complaints related to banking and payment
          services, file a complaint with the Reserve Bank of India&rsquo;s Integrated Ombudsman
          at{" "}
          <a
            href="https://cms.rbi.org.in"
            className="text-neon hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            cms.rbi.org.in
          </a>{" "}
          or call the toll-free number 14448.
        </LI>
        <LI>
          <strong>National Consumer Helpline:</strong> For consumer-protection grievances, contact
          the National Consumer Helpline at 1800-11-4000 or file a complaint at{" "}
          <a
            href="https://consumerhelpline.gov.in"
            className="text-neon hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            consumerhelpline.gov.in
          </a>
          .
        </LI>
        <LI>
          <strong>FIU-IND:</strong> For complaints related to suspicious transactions or AML
          concerns, contact the Financial Intelligence Unit – India.
        </LI>
        <LI>
          <strong>CERT-In:</strong> For cybersecurity or data-breach-related grievances, contact
          the Indian Computer Emergency Response Team at{" "}
          <a href="mailto:incident@cert-in.org.in" className="text-neon hover:underline">
            incident@cert-in.org.in
          </a>
          .
        </LI>
      </UL>

      <H2 id="categories">5. Complaint categories</H2>
      <P>
        The following categories are available when filing a grievance. Selecting the correct
        category helps us route your complaint to the right team:
      </P>
      <UL>
        <LI><strong>Transaction disputes:</strong> Failed, delayed, or incorrect transactions (crypto, fiat, or card).</LI>
        <LI><strong>Account access:</strong> Login issues, account suspension, or lockouts.</LI>
        <LI><strong>KYC / verification:</strong> Delays or errors in identity verification.</LI>
        <LI><strong>Card issues:</strong> Furlpay Card delivery, activation, unauthorized charges.</LI>
        <LI><strong>Data privacy:</strong> Data access, deletion, or rectification requests.</LI>
        <LI><strong>Billing:</strong> Subscription charges, fee disputes, refund requests.</LI>
        <LI><strong>Service quality:</strong> App performance, feature requests, general feedback.</LI>
        <LI><strong>Other:</strong> Any issue not covered by the above categories.</LI>
      </UL>

      <H2 id="record-keeping">6. Record keeping</H2>
      <P>
        All grievances, responses, and resolution records are maintained for a minimum of 5 years
        in compliance with the IT (Intermediary Guidelines) Rules, 2021, and the Prevention of
        Money Laundering Act, 2002. These records may be produced to regulatory authorities upon
        lawful request.
      </P>

      <H2 id="policy-review">7. Policy review</H2>
      <P>
        This Grievance Redressal Policy is reviewed annually and updated as necessary to reflect
        changes in applicable law, regulatory guidance, or Furlpay&rsquo;s operational processes.
        Material changes are communicated to users via email and in-app notification at least 15
        days before taking effect.
      </P>

      <div className="mt-12 border-t border-white/5 pt-6 text-[13px] text-textMuted">
        See also{" "}
        <Link href="/legal/refund" className="text-neon hover:underline">Refund &amp; Cancellation Policy</Link>,{" "}
        <Link href="/legal/privacy" className="text-neon hover:underline">Privacy Policy</Link>, and{" "}
        <Link href="/legal/terms" className="text-neon hover:underline">Terms of Service</Link>.
      </div>
    </article>
  );
}
