import { DocTitle, Lead, H2, P, UL, LI, Code, CodeBlock, Callout, EndpointTable, Mermaid, DocPager } from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/payments/cctp");

export default function CctpPage() {
  return (
    <article>
      <DocTitle eyebrow="Payments">CCTP Cross-Chain USDC</DocTitle>
      <Lead>
        Native USDC moves between chains with Circle&apos;s CCTP V2 burn-and-mint — no wrapped tokens, no
        bridge custody. Furlpay builds the calldata; <b>your wallet signs and submits both legs</b>, so
        funds never touch our keys.
      </Lead>

      <H2 id="flow">How a transfer works</H2>
      <Mermaid
        caption="CCTP V2: burn on the source chain, attest off-chain via Iris, mint on the destination."
        chart={`sequenceDiagram
    participant Wallet as Your Wallet
    participant API as Furlpay API
    participant Source as Source Chain
    participant Iris as Circle Iris
    participant Dest as Destination Chain

    Wallet->>API: POST /api/intents/cctp (burn intent)
    API-->>Wallet: unsigned approve + depositForBurn calldata
    Wallet->>Source: sign and submit burn
    Wallet->>API: GET /api/intents/cctp/attestation?txHash=...
    API->>Iris: GET /v2/messages
    Iris-->>API: message + attestation (8-20s fast transfer)
    API-->>Wallet: attestation
    Wallet->>API: POST /api/intents/cctp (mint intent)
    API-->>Wallet: unsigned receiveMessage calldata
    Wallet->>Dest: sign and submit mint
    Dest-->>Wallet: native USDC minted`}
      />

      <H2 id="endpoints">Endpoints</H2>
      <EndpointTable
        rows={[
          { method: "POST", path: "/api/intents/cctp", desc: "Build the burn bundle (approve + depositForBurn) or the mint transaction" },
          { method: "GET", path: "/api/intents/cctp/attestation", desc: "Poll Iris for the burn's message + attestation" },
        ]}
      />
      <CodeBlock lang="bash">{`curl -X POST https://furlpay.com/api/intents/cctp \\
  -H "content-type: application/json" \\
  -b "session" \\
  -d '{
    "kind": "burn",
    "amount": 25,
    "sourceChain": "ethereum",
    "destinationChain": "arbitrum",
    "recipient": "0xYourAddressOnArbitrum",
    "fast": true
  }'`}</CodeBlock>

      <H2 id="guarantees">Guarantees and limits</H2>
      <UL>
        <LI><b>V2 only</b> — TokenMessengerV2 / MessageTransmitterV2 with addresses verified against Circle&apos;s registry; V1 is end-of-life and never used.</LI>
        <LI><b>Fast Transfers</b> — 8–20s attestation with a fee ceiling of 1 basis point, paid from the transferred amount.</LI>
        <LI><b>Supported chains</b> — Ethereum, Arbitrum, Base, Polygon (native Circle-issued USDC on each).</LI>
        <LI><b>Per-transaction cap</b> — burns above the server-side limit (default $500, <Code>FURLPAY_MAX_CCTP_USD</Code>) are refused with <Code>amount_over_limit</Code>.</LI>
        <LI>Every prepared burn/mint and every attestation check feeds the ops event ledger and rail health.</LI>
      </UL>

      <Callout type="warning" title="The mint leg is yours to finish">
        After the burn confirms and the attestation lands, USDC exists nowhere until{" "}
        <Code>receiveMessage</Code> executes on the destination. Keep the message + attestation until
        the mint confirms — they are your claim.
      </Callout>

      <DocPager pathname="/docs/payments/cctp" />
    </article>
  );
}
