import { DocTitle, Lead, H2, P, UL, LI, Code, Callout, DocPager } from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/compliance/mica");

export default function MicaPage() {
  return (
    <article>
      <DocTitle eyebrow="Legal &amp; Compliance">MiCA Roadmap</DocTitle>
      <Lead>
        Furlpay is built compliance-first. Licensing is sequenced by jurisdiction, with a shared KYC and
        Travel Rule spine so obligations resolve automatically per user and per transfer.
      </Lead>

      <H2 id="eu">EU — MiCA</H2>
      <P>
        Under the EU <b>Markets in Crypto-Assets</b> (MiCA) regime, the stablecoins Furlpay settles in are
        treated as e-money tokens (EMTs) and asset-referenced tokens (ARTs). The roadmap targets a CASP
        authorization plus EMT issuer partnerships so EURC and USDC balances are fully in-scope.
      </P>
      <UL>
        <LI>CASP (Crypto-Asset Service Provider) authorization in an EU member state.</LI>
        <LI>EMT/ART reserve and disclosure alignment with issuing partners.</LI>
        <LI>Passporting across the EEA once authorized.</LI>
      </UL>

      <H2 id="us">US — GENIUS Act</H2>
      <P>
        In the United States, the <b>GENIUS Act</b> federal stablecoin framework governs permitted issuers
        and reserve requirements. Furlpay integrates with compliant issuers and applies the corresponding
        holding and disclosure rules to US users.
      </P>

      <H2 id="uk">UK — FCA</H2>
      <P>
        UK activity follows <b>FCA regulations</b>, including registration and the cryptoasset financial
        promotions regime. Marketing surfaces and in-app copy are gated to meet the promotions rules for UK
        residents.
      </P>

      <H2 id="kyc">Identity — Sumsub</H2>
      <P>
        Onboarding runs on a tiered, reusable KYC/KYB model via the <Code>Sumsub</Code> integration. A
        user verifies once; the resolved tier then unlocks limits and products across jurisdictions without
        re-collecting documents.
      </P>

      <H2 id="travel-rule">Travel Rule — TRUST</H2>
      <P>
        Cross-VASP transfers carry originator and beneficiary information under the FATF <b>Travel Rule</b>,
        exchanged over the <Code>TRUST</Code> network. The compliance package attaches the required data to
        qualifying transfers automatically.
      </P>

      <Callout title="Jurisdiction resolver">
        The <Code>packages/compliance</Code> jurisdiction resolver maps a user&apos;s residency and the
        counterparty to the applicable ruleset (MiCA, GENIUS Act, FCA) at request time — so route handlers
        stay jurisdiction-agnostic.
      </Callout>

      <DocPager pathname="/docs/compliance/mica" />
    </article>
  );
}
