import Link from "next/link";
import { DocTitle, H2, P, Callout } from "@/components/docs/prose";

export const metadata = {
  title: "Regulatory Disclosures — Furlpay Legal",
  description:
    "SEC/FINRA/SIPC, digital-asset, and EU MiCA regulatory disclosures for Furlpay, plus corporate identity clarifications.",
};

export default function DisclosuresPage() {
  return (
    <article>
      <DocTitle eyebrow="Legal">Regulatory Disclosures</DocTitle>
      <p className="mb-8 text-[13px] text-textMuted">Last updated: July 2, 2026</p>

      <H2 id="securities">Securities &amp; stock trading (US equities)</H2>
      <P>
        Brokerage services are provided by Alpaca Securities LLC (dba &ldquo;Alpaca Clearing&rdquo;), member
        FINRA (brokercheck.finra.org) and SIPC (sipc.org), a wholly-owned subsidiary of AlpacaDB, Inc.
        Furlpay is a technology platform, not a registered broker-dealer or investment adviser. Your
        brokerage account is held directly with Alpaca Securities LLC as the clearing broker-dealer.
      </P>
      <P>
        Fractional share trading involves unique risks and may not be suitable for all investors. All
        investments involve risk, and the past performance of a security or financial product does not
        guarantee future results or returns. System response, execution price, speed, liquidity, market
        data and account access times are subject to market conditions and system availability.
      </P>

      <H2 id="digital-assets">Digital assets &amp; stablecoins</H2>
      <P>
        Cryptocurrency and stablecoin services are made available through Alpaca Crypto LLC
        (&ldquo;Alpaca Crypto&rdquo;), a FinCEN-registered Money Services Business (NMLS&nbsp;#&nbsp;2160858)
        which is not a member of FINRA or SIPC, and through Furlpay&rsquo;s licensed fiat-to-crypto
        integration partner, Bridge.xyz (a Stripe company).
      </P>
      <Callout title="Not FDIC or SIPC insured">
        Digital assets are not legal tender, are highly speculative, and involve a high degree of risk.
        Your digital-asset holdings, stablecoins and wallet balances are not protected by either the
        Federal Deposit Insurance Corporation (FDIC) or the Securities Investor Protection Corporation
        (SIPC). Stablecoins are subject to peg-stability risks and smart-contract security vulnerabilities.
      </Callout>

      <H2 id="mica">European Union — MiCA compliance</H2>
      <P>
        Services provided to residents of the European Economic Area (EEA) are governed by the European
        Union&rsquo;s Markets in Crypto-Assets regulation, Regulation (EU) 2023/1114 (&ldquo;MiCA&rdquo;).
        Rules for e-money tokens (EMTs) and asset-referenced tokens (ARTs) have applied since 30 June 2024
        and the crypto-asset service provider regime since 30 December 2024, with the EU-wide transitional
        period concluding on 1 July 2026. Furlpay operates as an authorized Crypto-Asset Service Provider
        (CASP) / agent of a licensed Electronic Money Institution (EMI).
      </P>
      <P>
        Under MiCA requirements, Furlpay only supports fully compliant EMTs, including USDC and EURC. Any
        non-compliant fiat-pegged tokens deposited by EEA users are automatically converted to compliant
        assets at the point of entry. In compliance with MiCA environmental disclosures, the adverse
        environmental and climate-related impacts of the consensus mechanisms of supported blockchain
        networks (Base, Solana, Arbitrum) are published transparently in our environmental report.
      </P>

      <H2 id="corporate-notice">Corporate identity &amp; historical liquidator reference</H2>
      <P>
        Furlpay is a completely new, independent financial-technology brand launched in 2026. Furlpay has
        no affiliation, legal partnership, corporate relationship, shared assets, or corporate history with
        any previously operated or liquidated peer-to-peer payment application.
      </P>
      <P>
        Specifically, Furlpay is entirely separate from, and unrelated to, the historic UK-registered
        peer-to-peer payment platform &ldquo;VibePay&rdquo; (operated by Vibe Pay Limited, company no.
        11118944), whose members passed winding-up resolutions on 5 February 2026, effective 24 February
        2026, appointing Paul Robert Appleton and Paul Cooper of BTG Begbies Traynor (London) LLP as joint
        liquidators. Furlpay does not use, own or manage any intellectual property, user database or
        software libraries from the liquidated Vibe Pay Limited estate. Any historical assets or inquiries
        regarding Vibe Pay Limited must be directed exclusively to the appointed liquidators at Begbies
        Traynor.
      </P>

      <H2 id="copyright">Copyright &amp; attributions</H2>
      <P>
        © 2026 Furlpay. All rights reserved. All securities products are offered through Alpaca Securities
        LLC. All banking services are provided by FDIC-insured sponsor banks. Stablecoin conversions are
        processed by Bridge.xyz.
      </P>

      <div className="mt-12 border-t border-white/5 pt-6 text-[13px] text-textMuted">
        See also our{" "}
        <Link href="/legal/terms" className="text-neon hover:underline">Terms of Service</Link> and{" "}
        <Link href="/legal/privacy" className="text-neon hover:underline">Privacy Policy</Link>.
      </div>
    </article>
  );
}
