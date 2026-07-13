import Link from "next/link";
import { DocTitle, Lead, H2, P, Code, Callout, ParameterTable, DocPager } from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/help/transaction-statuses");

export default function TxStatusHelp() {
  return (
    <article>
      <DocTitle eyebrow="Help Center">Understanding Transaction Statuses</DocTitle>
      <Lead>
        Every payment moves through a small, fixed set of states. Knowing what each one means tells
        you whether to wait, retry, or contact support.
      </Lead>

      <H2 id="states">The states</H2>
      <ParameterTable
        params={[
          { name: "prepared", type: "transient", required: false, desc: "The payment is built and signed but not yet submitted to the network or rail." },
          { name: "pending", type: "in flight", required: false, desc: "Submitted and waiting for on-chain confirmations or rail settlement. On-chain USDC usually settles within minutes; cross-chain transfers can take longer." },
          { name: "settled", type: "final", required: false, desc: "Confirmed and irreversible. The money moved." },
          { name: "failed", type: "final", required: false, desc: "The rail or network rejected it after submission — funds do not leave your balance." },
          { name: "rejected", type: "final", required: false, desc: "Refused before submission: a policy, limit, or validation check said no. The response says which." },
        ]}
      />
      <P>
        Card purchases additionally show <Code>declined</Code> when the card itself refuses — see{" "}
        <Link href="/docs/help/declined-transactions" className="text-neon">Declined Transactions</Link>.
      </P>

      <H2 id="explorer">Checking a transaction on-chain</H2>
      <P>
        On-chain payments carry a transaction hash (<Code>0x…</Code> on EVM chains, a base58
        signature on Solana). Open the transaction in the app and tap the hash to view it on the
        network&apos;s block explorer — if the explorer shows it confirmed but FurlPay still says
        pending, give it a minute for confirmations to reach our required depth; the depth scales
        with the amount.
      </P>

      <H2 id="stuck">When to worry</H2>
      <P>
        A <Code>pending</Code> deposit past 30 minutes is worth a look. First ask the co-pilot
        &quot;where is my deposit?&quot; — it checks your pending transactions directly. If the
        sender&apos;s explorer link shows a different network than you selected on the deposit
        screen, that is the usual cause; open a ticket in the stablecoins category with the tx
        hash (safe to share — a hash reveals nothing secret).
      </P>

      <Callout type="info" title="Deposits credit at network speed, not FurlPay speed">
        FurlPay detects deposits by watching the chain. The wait is the network&apos;s
        confirmation time plus a safety margin that scales with the amount — small deposits
        credit fastest.
      </Callout>

      <DocPager pathname="/docs/help/transaction-statuses" />
    </article>
  );
}
