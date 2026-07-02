import Link from "next/link";
import { DocTitle, Lead, H2, H3, P, UL, LI, Code, Callout } from "@/components/docs/prose";

export const metadata = {
  title: "Travel Rule Disclosure — Furlpay Legal",
  description:
    "How Furlpay complies with the FATF Travel Rule for virtual asset transfers — data shared, thresholds, VASP-to-VASP protocols, and your rights.",
};

export default function TravelRulePage() {
  return (
    <article>
      <DocTitle eyebrow="Legal">Travel Rule Disclosure</DocTitle>
      <p className="mb-6 text-[13px] text-textMuted">Last updated: July 2, 2026</p>
      <Lead>
        This disclosure explains how Furlpay complies with the Financial Action Task Force (FATF)
        Travel Rule — also known as FATF Recommendation 16 — when you send or receive virtual asset
        transfers through the Furlpay platform.
      </Lead>

      <H2 id="what-is-travel-rule">1. What is the Travel Rule?</H2>
      <P>
        The Travel Rule is an international anti-money-laundering (AML) standard established by the
        FATF that requires Virtual Asset Service Providers (VASPs) to collect, verify, and transmit
        certain originator and beneficiary information when processing virtual asset transfers. The
        rule extends the same obligations that have long applied to traditional wire transfers under
        the Bank Secrecy Act (BSA) and EU Funds Transfer Regulation to the world of cryptocurrency.
      </P>
      <P>
        The Travel Rule is implemented in various jurisdictions through local legislation,
        including:
      </P>
      <UL>
        <LI>
          <strong>United States:</strong> FinCEN&rsquo;s Funds Transfer Rule (31 CFR 103.33) and
          Funds Travel Rule (31 CFR 103.33(g)), applicable to transfers of $3,000 or more.
        </LI>
        <LI>
          <strong>European Union:</strong> Transfer of Funds Regulation (TFR, Regulation (EU)
          2023/1113), applicable to all crypto-asset transfers with no de minimis threshold.
        </LI>
        <LI>
          <strong>Singapore:</strong> Payment Services Act (PSA) Notice PSN02, applicable to
          transfers of SGD 1,500 or more.
        </LI>
        <LI>
          <strong>South Korea:</strong> Specified Financial Information Act, applicable to all
          virtual asset transfers.
        </LI>
        <LI>
          <strong>India:</strong> PMLA rules as applied to virtual digital assets by the FIU-IND.
        </LI>
      </UL>

      <H2 id="when-applies">2. When does the Travel Rule apply?</H2>
      <P>
        Furlpay applies Travel Rule data-sharing obligations in the following circumstances:
      </P>
      <UL>
        <LI>
          <strong>VASP-to-VASP transfers above threshold:</strong> When you send or receive a
          virtual asset transfer of <strong>$1,000 USD (or equivalent)</strong> or more to/from a
          wallet hosted by another identified VASP. This threshold aligns with the FATF-recommended
          minimum; stricter local thresholds (e.g., EU TFR&rsquo;s zero threshold) are applied
          where required.
        </LI>
        <LI>
          <strong>Self-hosted wallet transfers:</strong> For transfers to or from unhosted
          (self-custodial) wallets above the applicable threshold, Furlpay may request additional
          information to verify wallet ownership, in compliance with EU TFR Article 14 and
          analogous local rules.
        </LI>
        <LI>
          <strong>Structuring detection:</strong> Furlpay monitors for transaction structuring —
          the practice of splitting a large transfer into smaller amounts to avoid the Travel Rule
          threshold. Structured transactions may be aggregated and treated as a single transfer
          for compliance purposes.
        </LI>
      </UL>
      <Callout title="Below-threshold transfers">
        Even for transfers below the Travel Rule threshold, Furlpay may collect and retain
        originator information as part of its broader AML/KYC obligations. This data is stored
        securely and shared only when required by law.
      </Callout>

      <H2 id="data-shared">3. What data is shared?</H2>
      <P>
        When the Travel Rule applies, the following information about the originator (sender) and
        beneficiary (recipient) is collected and transmitted to the counterparty VASP:
      </P>

      <H3 id="originator-data">Originator information</H3>
      <UL>
        <LI>Full legal name</LI>
        <LI>Furlpay account identifier (internal user ID or wallet address)</LI>
        <LI>Physical address, or national identity number, or date and place of birth</LI>
        <LI>The location and network of the originating wallet</LI>
      </UL>

      <H3 id="beneficiary-data">Beneficiary information</H3>
      <UL>
        <LI>Full legal name (as provided by the originator or the counterparty VASP)</LI>
        <LI>Account identifier at the beneficiary VASP (wallet address or internal account ID)</LI>
      </UL>

      <P>
        For transfers to/from the European Economic Area, the full originator information is
        transmitted regardless of amount, in compliance with the EU Transfer of Funds Regulation
        (TFR).
      </P>

      <H2 id="vasp-protocols">4. VASP-to-VASP transmission protocols</H2>
      <P>
        Furlpay transmits Travel Rule data to counterparty VASPs using industry-standard,
        encrypted messaging protocols:
      </P>
      <UL>
        <LI>
          <strong>TRISA (Travel Rule Information Sharing Architecture):</strong> An open-source,
          peer-to-peer protocol using mTLS-encrypted gRPC connections between verified VASP nodes.
          Furlpay is a registered member of the TRISA Global Directory Service (GDS).
        </LI>
        <LI>
          <strong>TRP (Travel Rule Protocol):</strong> The OpenVASP-based Travel Rule Protocol for
          VASPs that are not connected to TRISA. TRP uses end-to-end encrypted HTTPS messaging
          with VASP identity verification via the TRP directory.
        </LI>
        <LI>
          <strong>Fallback:</strong> For VASPs not connected to either TRISA or TRP, Furlpay may
          use secure email (PGP-encrypted) or API-based integration as a temporary measure. If no
          secure channel can be established, the transfer may be delayed or declined.
        </LI>
      </UL>
      <P>
        All Travel Rule data transmissions are logged, encrypted at rest, and retained for a
        minimum of 5 years in accordance with AML record-keeping requirements.
      </P>

      <H2 id="user-rights">5. Your rights</H2>
      <P>
        As a Furlpay user, you have the following rights with respect to Travel Rule data:
      </P>
      <UL>
        <LI>
          <strong>Transparency:</strong> You will be informed when Travel Rule data is being
          collected and shared as part of a transfer. A clear notice is displayed in the
          transaction-confirmation screen before you sign the transaction.
        </LI>
        <LI>
          <strong>Access:</strong> You may request a copy of the Travel Rule data Furlpay holds
          about you by contacting{" "}
          <a href="mailto:privacy@furlpay.com" className="text-neon hover:underline">
            privacy@furlpay.com
          </a>{" "}
          or through Settings → Privacy → Data Rights.
        </LI>
        <LI>
          <strong>Rectification:</strong> If your personal information is inaccurate, you may
          request correction. Note that corrections may require re-verification through our KYC
          provider (Persona).
        </LI>
        <LI>
          <strong>Limitation on retention:</strong> Travel Rule records are retained for the
          minimum period required by law (typically 5 years from the date of the transfer).
          Records are securely deleted after the retention period expires.
        </LI>
        <LI>
          <strong>Right to object:</strong> While you cannot opt out of Travel Rule data
          collection (as it is a legal obligation), you may choose not to initiate transfers that
          trigger Travel Rule requirements. In such cases, your data will not be shared with
          counterparty VASPs.
        </LI>
      </UL>

      <H2 id="privacy-safeguards">6. Privacy &amp; security safeguards</H2>
      <P>
        Furlpay takes the following measures to protect Travel Rule data:
      </P>
      <UL>
        <LI>Travel Rule data is stored in a segregated, access-controlled database separate from general user data.</LI>
        <LI>All data is encrypted at rest (AES-256) and in transit (TLS 1.3).</LI>
        <LI>Access to Travel Rule data is restricted to compliance personnel with a documented need-to-know basis.</LI>
        <LI>Audit logs of all Travel Rule data access and transmissions are maintained and reviewed quarterly.</LI>
        <LI>
          Travel Rule data is never used for marketing, analytics, or any purpose beyond
          regulatory compliance.
        </LI>
      </UL>

      <H2 id="questions">7. Questions &amp; contact</H2>
      <P>
        If you have questions about how the Travel Rule affects your transfers or your data, please
        contact our Compliance team:
      </P>
      <UL>
        <LI>
          <strong>Email:</strong>{" "}
          <a href="mailto:compliance@furlpay.com" className="text-neon hover:underline">
            compliance@furlpay.com
          </a>
        </LI>
        <LI>
          <strong>In-app:</strong> Settings → Help &amp; Support → Compliance Inquiries
        </LI>
      </UL>

      <div className="mt-12 border-t border-white/5 pt-6 text-[13px] text-textMuted">
        See also{" "}
        <Link href="/legal/privacy" className="text-neon hover:underline">Privacy Policy</Link>,{" "}
        <Link href="/legal/aml-kyc" className="text-neon hover:underline">AML &amp; KYC Policy</Link>, and{" "}
        <Link href="/legal/subprocessors" className="text-neon hover:underline">Subprocessor List</Link>.
      </div>
    </article>
  );
}
