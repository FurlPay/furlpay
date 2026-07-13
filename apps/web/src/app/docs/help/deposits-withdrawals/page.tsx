import Link from "next/link";
import { DocTitle, Lead, H2, P, UL, LI, Callout, DocPager } from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/help/deposits-withdrawals");

export default function DepositsHelp() {
  return (
    <article>
      <DocTitle eyebrow="Help Center">Deposits &amp; Withdrawals</DocTitle>
      <Lead>
        Money in from a wallet, an exchange, a bank, or a card; money out to a bank account or an
        external wallet.
      </Lead>

      <H2 id="deposit-crypto">Deposit from a wallet or exchange</H2>
      <UL>
        <LI>Dashboard → <b>Add money → Crypto</b>. Pick the token (USDC/USDT) and network.</LI>
        <LI>Scan the QR or copy the address into your wallet or exchange withdrawal screen.</LI>
        <LI><b>Match the network exactly</b> — USDC on Base sent to your Arbitrum address is the number-one cause of missing deposits.</LI>
        <LI>The balance credits when the transfer reaches confirmation depth — see <Link href="/docs/help/transaction-statuses" className="text-neon">Transaction Statuses</Link>.</LI>
      </UL>

      <H2 id="deposit-bank">Deposit by bank transfer</H2>
      <P>
        <b>Banking</b> in the app provisions virtual local account details — IBAN (SEPA), US
        routing/account (ACH and wire), UK sort code (Faster Payments), or UPI/IMPS — that credit
        your balance. Available detail types depend on your region and verification tier
        (bank rails require tier 2 — see the{" "}
        <Link href="/docs/help/kyc-verification" className="text-neon">KYC guide</Link>).
      </P>

      <H2 id="deposit-card">Deposit by card</H2>
      <P>
        <b>Add money → Card</b> buys USDC with a debit card through the onramp. Card purchases
        settle to your balance immediately; the onramp&apos;s fee is shown before you confirm.
      </P>

      <H2 id="withdraw">Withdrawing</H2>
      <UL>
        <LI><b>To an external wallet:</b> a normal send — paste the destination address, confirm with your fingerprint.</LI>
        <LI>
          <b>To your bank (off-ramp):</b> Bills → <b>Off-ramp</b> quotes the conversion to your
          local currency, you confirm biometrically, and the payout goes to your linked account.
          The quote shows the exact amount your bank receives before you commit.
        </LI>
      </UL>

      <Callout type="warning" title="Send a test amount first">
        For a first-time destination — a new wallet address or a fresh exchange deposit address —
        send a small amount, confirm it arrives, then send the rest. On-chain transfers are
        irreversible by design; no support team on earth can claw one back.
      </Callout>

      <DocPager pathname="/docs/help/deposits-withdrawals" />
    </article>
  );
}
