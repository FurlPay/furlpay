import {
  DocTitle,
  Lead,
  H2,
  P,
  UL,
  LI,
  Code,
  CodeBlock,
  Callout,
  DepGraph,
  Mermaid,
  DocPager,
} from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/payments/agent-trust");

export default function AgentTrustPage() {
  return (
    <article>
      <DocTitle eyebrow="Payments">Agent Trust &amp; Mandates (TAP)</DocTitle>
      <Lead>
        An AI agent that can spend money needs more than a payment rail — it needs <b>provable
        permission</b>. <Code>@furlpay/agent-trust</Code> is a developer library for agent identity,
        signed spending mandates, replay-aware intent tokens and request signatures. It supplies
        controls for an integration to evaluate; it does not itself execute or settle payments.
      </Lead>

      <Callout type="warning" title="Library support does not enable a FurlPay payment rail">
        FurlPay agent payment settlement is currently in development. The travel and card examples
        below illustrate how a developer might bind an action to a mandate; production travel booking
        and card issuing are unavailable. Check the service overview and package release notes before
        relying on an API shown here.
      </Callout>

      <H2 id="chain">The trust chain</H2>
      <DepGraph
        caption="User key signs the mandate → mandate names one agent key → agent key signs one exact intent → verifier checks the whole chain before any credential is issued."
        layers={[
          { label: "1 · Identity", nodes: [{ name: "generateKeypair()", sub: "Ed25519 · uk_ / ak_ SPKI fingerprints" }] },
          { label: "2 · Consent", accent: true, nodes: [{ name: "issueMandate()", sub: "user signs: cap · MCC · expiry · single-use" }] },
          { label: "3 · Intent", nodes: [{ name: "createBookingToken()", sub: "agent signs ONE amount/mcc/source + nonce" }] },
          { label: "4 · Verify", nodes: [{ name: "trust.verifyBookingToken()", sub: "chain + constraints + replay → credential" }] },
        ]}
      />
      <P>
        The design has one central invariant: <b>an agent can never widen its own permissions</b>. Only
        the user&apos;s key can sign a mandate, and the verifier refuses any execution whose parameters
        differ — even by one cent or one merchant-category code — from what the agent signed.
      </P>

      <H2 id="decision">How an intent token is judged</H2>
      <P>
        Verification is a strict decision tree — the first failed check refuses the token. A valid
        token is evidence for an integrating service; it is not a payment, booking confirmation or
        settlement receipt:
      </P>
      <Mermaid
        caption="Mandate evaluation: every gate must pass before a single-use credential is issued."
        chart={`flowchart TB
    TOK[Booking token arrives] --> SIG{Agent signature valid?}
    SIG -->|no| REJ1[Refuse - bad signature]
    SIG --> MAN{Mandate signed by the user key?}
    MAN -->|no| REJ2[Refuse - unsigned or tampered mandate]
    MAN --> BIND{Token signed by the agent the mandate names?}
    BIND -->|no| REJ3[Refuse - wrong agent key]
    BIND --> EXP{Mandate unexpired and not consumed?}
    EXP -->|no| REJ4[Refuse - expired or single-use spent]
    EXP --> CON{Amount, MCC, source within constraints?}
    CON -->|no| REJ5[Refuse - constraint violation]
    CON --> RPL{Nonce fresh?}
    RPL -->|no| REJ6[Refuse - replay]
    RPL --> OK[Issue single-use execution credential]`}
      />

      <H2 id="mandates">User-signed spend mandates</H2>
      <P>
        A mandate binds <i>one</i> agent key to explicit constraints. It is a base64url payload signed by
        the user&apos;s Ed25519 key — tamper with any field and the signature fails:
      </P>
      <CodeBlock lang="typescript">{`import { AgentTrust, generateKeypair, issueMandate } from "@furlpay/agent-trust";

const user  = generateKeypair("user");   // uk_…
const agent = generateKeypair("agent");  // ak_…

const mandate = issueMandate({
  userPrivateKeyPem: user.privateKeyPem,
  userPublicKeyPem:  user.publicKeyPem,
  agentKeyId: agent.keyId,               // this ONE agent, no other
  constraints: {
    maxTotalUsd: 500,                    // spend allowance across all bookings
    maxPerBookingUsd: 400,               // per-transaction ceiling
    mccAllowlist: ["7011", "4511"],      // lodging + airlines only
    sourceAllowlist: ["travala", "legacy"],
    expiresAt: new Date(Date.now() + 7 * 864e5).toISOString(),
    singleUse: false,                    // true → consumed by first booking
  },
});`}</CodeBlock>

      <H2 id="tokens">Booking tokens: one signed intent</H2>
      <P>
        For each payment the agent wraps the mandate around one concrete intent and signs it with its own
        key. The token carries a fresh nonce, so it clears verification <b>exactly once</b>:
      </P>
      <CodeBlock lang="typescript">{`import { createBookingToken } from "@furlpay/agent-trust";

const token = createBookingToken({
  mandate,
  agentPrivateKeyPem: agent.privateKeyPem,
  agentPublicKeyPem:  agent.publicKeyPem,
  intent: { amountUsd: 320, source: "legacy", mcc: "7011", merchant: "Hotel CDMX" },
});

// Rail side (MCP server, API, x402 facilitator):
const trust = new AgentTrust();
trust.registerUser(user.publicKeyPem);
trust.registerAgent(agent.publicKeyPem);

const decision = await trust.verifyBookingToken(token, { amountUsd: 320, mcc: "7011", source: "legacy" });
// → { ok: true, agentKeyId: "ak_…", mandateId: "mnd_…", remainingUsd: 180 }`}</CodeBlock>
      <P>Verification is stateful and fails closed. In order, the verifier checks:</P>
      <UL>
        <LI><b>Agent identity</b> — the agent key is registered and really signed this intent.</LI>
        <LI><b>User consent</b> — the mandate verifies against a registered user key and names this agent.</LI>
        <LI><b>Claims equality</b> — the amount/mcc/source the rail is about to execute equal the signed intent byte-for-byte.</LI>
        <LI><b>Constraints</b> — total cap (budgets decrement on success), per-booking cap, MCC and source allowlists, expiry, single-use consumption.</LI>
        <LI><b>Replay</b> — the nonce is burned atomically; a replayed token is rejected and reported as such.</LI>
      </UL>

      <H2 id="rfc9421">RFC 9421 HTTP signatures</H2>
      <P>
        The same identity keys authenticate raw HTTP calls — TAP&apos;s transport binding.{" "}
        <Code>signRequest()</Code> produces <Code>Signature-Input</Code>, <Code>Signature</Code> and{" "}
        <Code>Content-Digest</Code> headers over <Code>@method</Code>, <Code>@target-uri</Code> and the
        body digest, with <Code>tag=&quot;agent-payment&quot;</Code>:
      </P>
      <CodeBlock lang="typescript">{`import { signRequest } from "@furlpay/agent-trust";

const body = JSON.stringify({ action: "prepare", amountUsd: 180, purpose: "example only" });
const headers = signRequest({
  method: "POST",
  url: "https://merchant.example/api/agent-actions",
  body,
  keyId: agent.keyId,
  privateKeyPem: agent.privateKeyPem,
});

await fetch("https://merchant.example/api/agent-actions", {
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body,
});`}</CodeBlock>

      <H2 id="capabilities">Capability tokens: per-call, one server, once</H2>
      <P>
        A mandate says <b>what</b> an agent may spend; a <b>capability</b> says <b>which</b> tool-server it
        may call, <b>for how long</b>, and <b>exactly once</b>. It is the third tier of the multi-tier
        session model — a short-lived, audience-restricted token the agent mints per call, so an
        intercepted token can&apos;t be replayed by another holder or against another server:
      </P>
      <CodeBlock lang="typescript">{`import { mintCapability } from "@furlpay/agent-trust";

// Agent mints a single-use capability for ONE tool-server call:
const cap = mintCapability({
  agentPrivateKeyPem: agent.privateKeyPem,
  agentPublicKeyPem:  agent.publicKeyPem,
  audience: "https://your-tool-server.example", // valid at this server only
  action:   "prepare:payment",
  maxUsd:   400,
  ttlSeconds: 120,                               // minted per call, not held
});

// Tool-server side — accepts the token only when every check passes:
const d = await trust.verifyCapability(cap, {
  audience: "https://your-tool-server.example", // must be THIS server
  action:   "prepare:payment",
  presenterKeyId: verified.keyId,                // PoP: same key that minted it
  maxUsd:   1000,                                // server ceiling
});
// → { ok: true, agentKeyId, jti, audience, action, maxUsd } — and the jti burns`}</CodeBlock>
      <P><Code>verifyCapability</Code> rejects, with a specific reason, any token that:</P>
      <UL>
        <LI><b>Wrong audience</b> — minted for a different tool-server (no cross-server replay).</LI>
        <LI><b>Wrong presenter</b> — presented by a key other than the one that minted it (proof-of-possession; pair with <Code>verifyRequest</Code> to bind the request to that key).</LI>
        <LI><b>Expired</b>, <b>action mismatch</b>, or a <Code>maxUsd</Code> above the server ceiling.</LI>
        <LI><b>Replayed</b> — the <Code>jti</Code> burns on first success via the same nonce store as bookings.</LI>
      </UL>
      <P>
        Together the tiers form one chain: <b>mandate</b> (user consent + budget) → <b>request signature</b>{" "}
        (who is calling now) → <b>capability</b> (this call, this server, once).
      </P>

      <H2 id="escrow">FurlPay agent route boundaries</H2>
      <P>
        FurlPay exposes agent-key management and an escrow-hold route in the codebase. These routes
        do not establish a live card or payment product, and the escrow route can return{" "}
        <Code>503 service_unavailable</Code> when durable hold storage is not configured:
      </P>
      <UL>
        <LI>
          <Code>POST /api/agents/keys</Code> — register an agent&apos;s Ed25519 public key (SPKI PEM).
          Returns a key identifier for the agent&apos;s public key. When registered to an account,
          the key can carry a spend policy with a transaction limit, daily budget and category allowlist.
          Requests to guarded endpoints may be checked against that policy. <Code>GET</Code> lists
          owned keys; <Code>DELETE</Code> revokes a key. Check each route response for the result.
        </LI>
        <LI>
          <Code>POST /api/escrow</Code> — an implementation of create/capture/release hold operations.
          It is not a card authorization or an on-chain settlement service. Its backing store must be
          durable for the route to work; check the response and do not promise a hold from a successful
          signature alone.
        </LI>
      </UL>

      <Callout title="Package and integration status">
        The repository may contain APIs that are newer than the public npm release. Check the
        package&apos;s published version and changelog before importing a method shown here. Review
        settlement status separately in the{" "}
        <a href="/docs" className="text-neon hover:underline">service overview</a>.
      </Callout>

      <DocPager pathname="/docs/payments/agent-trust" />
    </article>
  );
}
