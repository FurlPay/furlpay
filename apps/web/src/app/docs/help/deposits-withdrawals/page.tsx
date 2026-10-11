import { DocTitle, Lead, H2, P, UL, LI, Code, Callout, DocPager } from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/help/deposits-withdrawals");

export default function DepositsHelp() {
  return (
    <article>
      <DocTitle eyebrow="Help Center">Funding and withdrawals</DocTitle>
      <Lead>
        FurlPay does not currently provide local bank account issuance, bank payouts, or a
        production fiat on-ramp or off-ramp.
      </Lead>

      <Callout type="warning" title="Only send to an address shown for your account">
        Do not use an address copied from an old guide, code sample or another user. If the
        authenticated FurlPay app does not show a deposit address for a specific asset and
        network, do not send funds to FurlPay.
      </Callout>

      <H2 id="banking">Bank transfers and local accounts</H2>
      <P>
        FurlPay does not currently issue IBAN, ACH, sort-code or other local bank accounts and
        does not accept bank-transfer deposits or send bank payouts. The banking directory is
        informational and is not a connection to a bank.
      </P>

      <H2 id="card">Card purchases of crypto</H2>
      <P>
        FurlPay does not currently provide a production card-funded crypto on-ramp. Do not enter
        card details into a demo or development flow.
      </P>

      <H2 id="external-wallet">External wallet transfers</H2>
      <UL>
        <LI>Use an address only when it is displayed in your signed-in account for the exact asset and network.</LI>
        <LI>Check the network and token contract before sending; similar token names can refer to different assets.</LI>
        <LI>Confirm a small test transfer first when the receiving service explicitly supports deposits.</LI>
        <LI>On-chain transfers may be irreversible after confirmation.</LI>
      </UL>

      <H2 id="offramp">Withdrawals to a bank</H2>
      <P>
        Production fiat off-ramp and bank payout services are not available. A payment intent or
        beneficiary form does not mean a bank transfer can be completed.
      </P>

      <P>
        See <a href="/docs" className="text-neon hover:underline">service availability</a> and the
        current <Code>/api/rails</Code> status before using any payment route.
      </P>

      <DocPager pathname="/docs/help/deposits-withdrawals" />
    </article>
  );
}
