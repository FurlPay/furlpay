import Link from "next/link";
import { DocTitle, Lead, H2, H3, P, UL, LI, Code, Callout } from "@/components/docs/prose";

export const metadata = {
  title: "Data Processing Agreement — Furlpay Legal",
  description:
    "Furlpay's Data Processing Agreement (DPA) under GDPR Article 28 — controller/processor roles, data categories, security measures, sub-processors, breach notification, and audit rights.",
};

export default function DpaPage() {
  return (
    <article>
      <DocTitle eyebrow="Legal">Data Processing Agreement</DocTitle>
      <p className="mb-6 text-[13px] text-textMuted">Last updated: July 2, 2026</p>
      <Lead>
        This Data Processing Agreement (&ldquo;DPA&rdquo;) forms part of the{" "}
        <Link href="/legal/terms" className="text-neon hover:underline">
          Terms of Service
        </Link>{" "}
        between Furlpay (&ldquo;Processor&rdquo;) and the individual or entity using Furlpay
        services (&ldquo;Controller&rdquo;), pursuant to Article 28 of Regulation (EU) 2016/679
        (the &ldquo;GDPR&rdquo;).
      </Lead>

      <H2 id="definitions">1. Definitions</H2>
      <P>
        Unless otherwise defined herein, capitalised terms have the meanings given to them in the
        GDPR. <strong>&ldquo;Personal Data&rdquo;</strong> means any information relating to an
        identified or identifiable natural person that is processed by the Processor on behalf of
        the Controller. <strong>&ldquo;Processing&rdquo;</strong> means any operation performed on
        Personal Data, including collection, storage, retrieval, use, transmission, and erasure.
      </P>

      <H2 id="roles">2. Controller &amp; Processor roles</H2>
      <P>
        The Controller determines the purposes and means of Processing Personal Data. Furlpay acts
        as the Processor, processing Personal Data solely on the Controller&rsquo;s documented
        instructions and for the purposes described in this DPA and the Terms of Service.
      </P>
      <P>
        Where Furlpay processes Personal Data as required by applicable law (e.g., KYC/AML
        obligations), Furlpay acts as an independent Controller for that limited processing. In
        such cases, Furlpay&rsquo;s{" "}
        <Link href="/legal/privacy" className="text-neon hover:underline">
          Privacy Policy
        </Link>{" "}
        governs the processing.
      </P>

      <H2 id="data-categories">3. Categories of data processed</H2>
      <P>
        The following categories of Personal Data may be processed under this DPA:
      </P>
      <UL>
        <LI>
          <strong>Identity data:</strong> Full name, date of birth, nationality, government-issued
          ID numbers (processed and stored by Persona; Furlpay retains only verification status
          and tokenized references).
        </LI>
        <LI>
          <strong>Contact data:</strong> Email address, phone number, residential address.
        </LI>
        <LI>
          <strong>Financial data:</strong> Bank account details, card details (tokenized via
          Marqeta/Stripe), transaction history, wallet addresses.
        </LI>
        <LI>
          <strong>Technical data:</strong> IP address, device identifiers, browser fingerprint,
          WebAuthn public keys.
        </LI>
        <LI>
          <strong>Usage data:</strong> Feature usage analytics, session metadata, error logs
          (collected via PostHog with IP anonymization enabled).
        </LI>
        <LI>
          <strong>Compliance data:</strong> Sanctions-screening results, risk scores, Travel Rule
          originator/beneficiary data.
        </LI>
      </UL>
      <P>
        <strong>Data subjects</strong> include: registered Furlpay users, beneficial owners, and
        authorized representatives of business accounts.
      </P>

      <H2 id="processing-instructions">4. Processing instructions</H2>
      <P>
        The Processor shall process Personal Data only in accordance with the Controller&rsquo;s
        documented instructions, unless required to do so by Union or Member State law to which the
        Processor is subject. The Processor shall immediately inform the Controller if, in its
        opinion, an instruction infringes the GDPR or other data-protection provisions.
      </P>
      <P>
        Documented instructions include: providing the Furlpay services described in the Terms of
        Service, maintaining account security, fulfilling regulatory obligations, and responding to
        Controller-initiated data-subject requests.
      </P>

      <H2 id="security-measures">5. Security measures</H2>
      <P>
        Furlpay implements and maintains the following technical and organizational measures to
        protect Personal Data, in accordance with Article 32 of the GDPR:
      </P>
      <UL>
        <LI>
          <strong>Encryption at rest:</strong> All databases use AES-256 encryption. Wallet key
          shares are encrypted using hardware-backed enclaves (Turnkey).
        </LI>
        <LI>
          <strong>Encryption in transit:</strong> All network communication uses TLS 1.3. HSTS is
          enforced across all domains with a minimum max-age of 1 year.
        </LI>
        <LI>
          <strong>Access controls:</strong> Role-based access control (RBAC) with mandatory
          multi-factor authentication for all employees accessing production systems. Access logs
          are retained for 12 months.
        </LI>
        <LI>
          <strong>Network security:</strong> Production infrastructure is hosted on isolated VPCs
          with WAF, DDoS protection, and continuous intrusion-detection monitoring.
        </LI>
        <LI>
          <strong>Key management:</strong> MPC key shares ensure that no single party (including
          Furlpay) can access user wallet funds unilaterally. Turnkey HSMs are SOC 2 Type II
          certified.
        </LI>
        <LI>
          <strong>Pseudonymization:</strong> KYC document data is tokenized at the point of
          collection by Persona. Furlpay stores only verification outcomes and token references.
        </LI>
        <LI>
          <strong>Vulnerability management:</strong> Continuous dependency scanning, quarterly
          penetration testing by independent auditors, and a public{" "}
          <Link href="/legal/responsible-disclosure" className="text-neon hover:underline">
            bug bounty program
          </Link>
          .
        </LI>
        <LI>
          <strong>Employee training:</strong> All personnel with access to Personal Data complete
          annual data-protection and security-awareness training.
        </LI>
      </UL>

      <H2 id="sub-processors">6. Sub-processors</H2>
      <P>
        The Controller provides general authorization for the Processor to engage sub-processors.
        The current list of sub-processors is maintained at{" "}
        <Link href="/legal/subprocessors" className="text-neon hover:underline">
          furlpay.com/legal/subprocessors
        </Link>
        .
      </P>
      <P>
        The Processor shall: (a) notify the Controller at least 30 calendar days before adding or
        replacing a sub-processor by updating the sub-processor list and sending an email
        notification to the Controller&rsquo;s registered address; (b) impose data-protection
        obligations no less protective than those in this DPA on each sub-processor via a written
        contract; and (c) remain fully liable for the acts and omissions of its sub-processors.
      </P>
      <P>
        If the Controller objects to a new sub-processor on reasonable data-protection grounds, the
        Controller must notify Furlpay within 14 calendar days of receiving notice. The parties
        shall discuss the objection in good faith. If no resolution is reached, the Controller may
        terminate the affected services without penalty.
      </P>

      <H2 id="data-breach">7. Data breach notification</H2>
      <Callout title="72-hour notification commitment">
        In the event of a Personal Data breach, Furlpay shall notify the Controller without undue
        delay — and in any case within 72 hours of becoming aware of the breach — in accordance
        with Article 33 of the GDPR.
      </Callout>
      <P>The breach notification shall include:</P>
      <UL>
        <LI>A description of the nature of the breach, including categories and approximate number of data subjects and records affected.</LI>
        <LI>The name and contact details of the Data Protection Officer or other contact point.</LI>
        <LI>A description of the likely consequences of the breach.</LI>
        <LI>A description of the measures taken or proposed to address the breach, including measures to mitigate possible adverse effects.</LI>
      </UL>
      <P>
        Furlpay shall cooperate with the Controller and take reasonable commercial steps to assist
        in the investigation, mitigation, and remediation of each breach. Furlpay shall not
        communicate directly with data-protection authorities on behalf of the Controller unless
        explicitly authorized in writing.
      </P>

      <H2 id="data-subject-rights">8. Data subject rights</H2>
      <P>
        Furlpay shall assist the Controller in fulfilling data-subject requests under Articles 15
        through 22 of the GDPR, including requests for access, rectification, erasure, data
        portability, restriction of processing, and objection. Furlpay shall forward any
        data-subject request it receives directly to the Controller within 2 business days, unless
        legally prohibited.
      </P>
      <P>
        Users can exercise data-subject rights directly through the Furlpay app via{" "}
        <strong>Settings → Privacy → Data Rights</strong>, or by emailing{" "}
        <a href="mailto:privacy@furlpay.com" className="text-neon hover:underline">
          privacy@furlpay.com
        </a>
        .
      </P>

      <H2 id="international-transfers">9. International data transfers</H2>
      <P>
        When Personal Data is transferred outside the European Economic Area (EEA), Furlpay ensures
        appropriate safeguards are in place. Transfers to the United States rely on the EU-U.S. Data
        Privacy Framework (DPF) certifications of our sub-processors where available. For
        sub-processors not certified under the DPF, Furlpay executes Standard Contractual Clauses
        (SCCs) approved by the European Commission (Decision 2021/914), supplemented by transfer
        impact assessments.
      </P>

      <H2 id="audit-rights">10. Audit rights</H2>
      <P>
        The Controller (or an independent third-party auditor appointed by the Controller) may
        audit Furlpay&rsquo;s compliance with this DPA, subject to the following conditions:
      </P>
      <UL>
        <LI>Audit requests must be submitted at least 30 calendar days in advance in writing.</LI>
        <LI>Audits shall be conducted during normal business hours and shall not unreasonably disrupt Furlpay&rsquo;s operations.</LI>
        <LI>The Controller bears the costs of the audit, unless the audit reveals a material non-compliance by Furlpay.</LI>
        <LI>Furlpay shall make available all information reasonably necessary to demonstrate compliance, including SOC 2 Type II reports, penetration-test summaries, and relevant policy documentation.</LI>
        <LI>Audits are limited to once per 12-month period, unless a data breach has occurred or a supervisory authority orders an audit.</LI>
      </UL>

      <H2 id="retention-deletion">11. Data retention &amp; deletion</H2>
      <P>
        Upon termination of the services or upon the Controller&rsquo;s written request, Furlpay
        shall delete or return all Personal Data within 30 calendar days, unless retention is
        required by applicable law (e.g., AML record-keeping requirements, which mandate retention
        for 5 years after account closure). Furlpay shall certify deletion in writing upon the
        Controller&rsquo;s request.
      </P>

      <H2 id="liability">12. Liability</H2>
      <P>
        Each party&rsquo;s liability under this DPA is subject to the limitations set out in the
        Terms of Service, except that neither party limits its liability for breaches of data
        protection law that result in material harm to data subjects.
      </P>

      <H2 id="governing-law">13. Governing law</H2>
      <P>
        This DPA is governed by the laws of the jurisdiction specified in the Terms of Service.
        Where the Controller is established in the EEA, disputes arising under this DPA shall be
        subject to the exclusive jurisdiction of the courts of Ireland.
      </P>

      <div className="mt-12 border-t border-white/5 pt-6 text-[13px] text-textMuted">
        See also{" "}
        <Link href="/legal/privacy" className="text-neon hover:underline">Privacy Policy</Link>,{" "}
        <Link href="/legal/subprocessors" className="text-neon hover:underline">Subprocessor List</Link>, and{" "}
        <Link href="/legal/terms" className="text-neon hover:underline">Terms of Service</Link>.
      </div>
    </article>
  );
}
