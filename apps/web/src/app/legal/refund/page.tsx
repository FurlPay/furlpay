import Link from "next/link";
import { DocTitle, Lead, H2, H3, P, UL, LI, Code, Callout } from "@/components/docs/prose";

export const metadata = {
  title: "Refund & Cancellation Policy — Furlpay Legal",
  description:
    "Furlpay's refund and cancellation policy covering crypto transaction irreversibility, card disputes, Pro subscription cancellation, and fiat withdrawal timeframes.",
};

export default function RefundPage() {
  return (
    <article>
      <DocTitle eyebrow="Legal">Refund &amp; Cancellation Policy</DocTitle>
      <p className="mb-6 text-[13px] text-textMuted">Last updated: July 2, 2026</p>
      <Lead>
        This policy explains how refunds, cancellations, and chargebacks are handled across
        Furlpay&rsquo;s products — including on-chain crypto transactions, Furlpay Card purchases,
        Pro subscription billing, and fiat withdrawals.
      </Lead>

      <H2 id="crypto-irreversibility">1. Crypto transaction irreversibility</H2>
      <Callout title="Blockchain transactions are final">
        Once a cryptocurrency or stablecoin transaction has been broadcast and confirmed on-chain,
        it cannot be reversed, cancelled, or recalled by Furlpay or any third party. This is a
        fundamental property of blockchain technology, not a Furlpay policy choice.
      </Callout>
      <P>
        Furlpay operates self-custodial MPC wallets. When you sign a transaction using your passkey,
        the combined 2-of-2 key shares produce a valid on-chain signature. Once the transaction
        reaches finality on the relevant network (Base, Solana, Arbitrum, or Ethereum), no party —
        including Furlpay — can reverse it.
      </P>
      <P>
        If you believe you sent funds to an incorrect address, Furlpay&rsquo;s support team will
        make reasonable efforts to help you identify the recipient, but we cannot guarantee recovery.
        We strongly recommend using the address-book and confirmation-preview features before
        signing any transaction.
      </P>

      <H2 id="card-disputes">2. Furlpay Card disputes &amp; chargebacks</H2>
      <P>
        Furlpay Card transactions are issued through our card-issuing partner, Marqeta, Inc., and
        processed on the Visa or Mastercard network. If you believe a card transaction is
        unauthorized, fraudulent, or incorrect, you may initiate a dispute.
      </P>

      <H3 id="dispute-process">How to file a dispute</H3>
      <UL>
        <LI>
          Open the Furlpay app, navigate to <strong>Card → Transactions</strong>, select the
          transaction in question, and tap <strong>&ldquo;Dispute this charge.&rdquo;</strong>
        </LI>
        <LI>
          Alternatively, email{" "}
          <a href="mailto:disputes@furlpay.com" className="text-neon hover:underline">
            disputes@furlpay.com
          </a>{" "}
          with your account email, the transaction date, merchant name, amount, and a description
          of the issue.
        </LI>
        <LI>
          Disputes must be filed within <strong>60 calendar days</strong> of the transaction
          posting date to remain eligible under card-network rules (Regulation E / Regulation Z
          timelines apply).
        </LI>
      </UL>

      <H3 id="dispute-timeline">Resolution timeline</H3>
      <UL>
        <LI>
          <strong>Provisional credit:</strong> For eligible disputes, a provisional credit is
          typically issued within 10 business days while the investigation is ongoing.
        </LI>
        <LI>
          <strong>Investigation:</strong> Marqeta and the card network investigate with the
          merchant&rsquo;s acquiring bank. Investigations are completed within 45 calendar days
          for domestic transactions and 90 calendar days for international transactions.
        </LI>
        <LI>
          <strong>Final resolution:</strong> You will be notified of the outcome by email. If the
          dispute is resolved in your favor, the provisional credit becomes permanent. If it is
          denied, the provisional credit is reversed and an explanation is provided.
        </LI>
      </UL>
      <P>
        Furlpay reserves the right to close accounts that exhibit patterns of dispute abuse or
        first-party fraud in accordance with our{" "}
        <Link href="/legal/acceptable-use" className="text-neon hover:underline">
          Acceptable Use Policy
        </Link>
        .
      </P>

      <H2 id="subscription-cancellation">3. Pro subscription cancellation</H2>
      <P>
        Furlpay Pro is billed monthly or annually at the rates displayed on the{" "}
        <Link href="/pricing" className="text-neon hover:underline">
          pricing page
        </Link>{" "}
        at the time of purchase. Subscription payments are processed by Stripe, Inc.
      </P>
      <UL>
        <LI>
          <strong>Cancel anytime:</strong> You may cancel your Pro subscription at any time from{" "}
          <strong>Settings → Billing → Manage Subscription</strong>. Cancellation takes effect at
          the end of your current billing period — you retain Pro features until then.
        </LI>
        <LI>
          <strong>No partial refunds:</strong> We do not issue prorated refunds for unused portions
          of a billing period. If you cancel mid-cycle, you continue to have access until the
          period expires.
        </LI>
        <LI>
          <strong>Annual plan exception:</strong> If you purchased an annual plan, you may request
          a full refund within 14 calendar days of your initial purchase or renewal, provided you
          have not used Pro-exclusive features (e.g., agent SDK, premium card tiers) during that
          period. Refund requests should be sent to{" "}
          <a href="mailto:billing@furlpay.com" className="text-neon hover:underline">
            billing@furlpay.com
          </a>
          .
        </LI>
        <LI>
          <strong>Free-trial conversion:</strong> If you signed up for a free trial and do not
          cancel before the trial ends, you will be charged at the standard rate. Charges incurred
          after trial conversion are non-refundable.
        </LI>
      </UL>

      <H2 id="fiat-withdrawals">4. Fiat withdrawal timeframes</H2>
      <P>
        When you initiate a withdrawal from your Furlpay balance to an external bank account, the
        following timelines apply:
      </P>
      <UL>
        <LI>
          <strong>Standard ACH (US):</strong> 1–3 business days. Furlpay initiates the ACH credit
          within 1 business day; your bank&rsquo;s processing time determines actual availability.
        </LI>
        <LI>
          <strong>Instant withdrawal (US):</strong> Funds are typically available within minutes via
          the RTP or FedNow networks, subject to your bank&rsquo;s participation. A small fee
          applies as displayed at the time of withdrawal.
        </LI>
        <LI>
          <strong>SEPA (EEA):</strong> 1 business day for SEPA Instant Credit Transfers; up to 2
          business days for standard SEPA Credit Transfers.
        </LI>
        <LI>
          <strong>SWIFT / international wire:</strong> 2–5 business days, depending on
          intermediary banks and the destination country. Correspondent bank fees may be deducted
          in transit.
        </LI>
        <LI>
          <strong>UPI / IMPS (India):</strong> Typically within minutes for amounts up to
          ₹5,00,000 via IMPS. UPI withdrawals settle near-instantly during banking hours.
        </LI>
      </UL>
      <P>
        Once a fiat withdrawal has been submitted to the banking network, it cannot be cancelled by
        Furlpay. If you need to reverse a completed bank transfer, you must contact your receiving
        bank directly.
      </P>

      <H2 id="stablecoin-offramp">5. Stablecoin off-ramp refunds</H2>
      <P>
        Stablecoin-to-fiat off-ramp conversions are processed by Bridge.xyz (a Stripe company). If
        a conversion fails due to a technical error or compliance hold, the stablecoin amount is
        returned to your Furlpay wallet within 5 business days. Exchange-rate fluctuations between
        the time of the original conversion and the return are not compensated.
      </P>

      <H2 id="investment-trades">6. Investment trade cancellations</H2>
      <P>
        Equity and ETF orders placed through our brokerage partner, Alpaca Securities LLC, follow
        standard market-order execution rules. Market orders are typically filled within seconds
        during trading hours and cannot be cancelled after execution. Limit orders that have not
        yet been filled may be cancelled from the order-management screen.
      </P>
      <P>
        Furlpay is not liable for losses arising from market movements between order placement and
        execution. See our{" "}
        <Link href="/legal/disclosures" className="text-neon hover:underline">
          Regulatory Disclosures
        </Link>{" "}
        for full brokerage risk disclosures.
      </P>

      <H2 id="contact">7. Contact us</H2>
      <P>
        For any refund or cancellation inquiries not covered above, please contact our support
        team:
      </P>
      <UL>
        <LI>
          <strong>Email:</strong>{" "}
          <a href="mailto:support@furlpay.com" className="text-neon hover:underline">
            support@furlpay.com
          </a>
        </LI>
        <LI>
          <strong>In-app:</strong> Settings → Help &amp; Support → Contact Us
        </LI>
        <LI>
          <strong>Response time:</strong> We aim to acknowledge all refund requests within 2
          business days and resolve them within 10 business days.
        </LI>
      </UL>

      <div className="mt-12 border-t border-white/5 pt-6 text-[13px] text-textMuted">
        See also{" "}
        <Link href="/legal/terms" className="text-neon hover:underline">Terms of Service</Link>,{" "}
        <Link href="/legal/disclosures" className="text-neon hover:underline">Regulatory Disclosures</Link>, and{" "}
        <Link href="/legal/grievance" className="text-neon hover:underline">Grievance Redressal Policy</Link>.
      </div>
    </article>
  );
}
