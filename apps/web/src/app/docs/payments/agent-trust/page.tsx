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
  DocPager,
} from "@/components/docs/prose";

export const metadata = { title: "Furlpay Docs — Agent Trust & Mandates (TAP)" };

export default function AgentTrustPage() {
  return (
    <article>
      <DocTitle eyebrow="Payments">Agent Trust &amp; Mandates (TAP)</DocTitle>
      <Lead>
        An AI agent that can spend money needs more than a payment rail — it needs <b>provable
        permission</b>. <Code>@furlpay/agent-trust</Code> implements the trust chain behind Visa&apos;s
        Trusted Agent Protocol (production-live since July 2026): every agent-initiated payment carries
        cryptographic proof of <b>who</b> the agent is, <b>that</b> the user consented, and <b>what</b>{" "}
        exactly it is allowed to do.
      </Lead>

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

const body = JSON.stringify({ action: "create", cardId: "card_x", merchant: "Estadio Azteca", amount: 180 });
const headers = signRequest({
  method: "POST",
  url: "https://furlpay.com/api/escrow",
  body,
  keyId: agent.keyId,
  privateKeyPem: agent.privateKeyPem,
});

await fetch("https://furlpay.com/api/escrow", {
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
  audience: "https://travel-mcp.furlpay.com",   // valid at this server only
  action:   "pay:travala",
  maxUsd:   400,
  ttlSeconds: 120,                               // minted per call, not held
});

// Tool-server side — accepts the token only when every check passes:
const d = await trust.verifyCapability(cap, {
  audience: "https://travel-mcp.furlpay.com",    // must be THIS server
  action:   "pay:travala",
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

      <H2 id="escrow">Live in the Furlpay API</H2>
      <P>Two production routes speak this protocol today:</P>
      <UL>
        <LI>
          <Code>POST /api/agents/keys</Code> — register an agent&apos;s Ed25519 public key (SPKI PEM).
          Returns the <Code>ak_…</Code> key id the agent uses as its RFC 9421 <Code>keyid</Code>.
        </LI>
        <LI>
          <Code>POST /api/escrow</Code> — signed agent requests create/capture/release pre-auth holds
          without a session cookie. A tampered body (content-digest mismatch), an unknown key, or an
          expired signature returns <Code>401</Code> before any hold is touched; the verified agent key id
          is attributed on the resulting transaction.
        </LI>
      </UL>
      <CodeBlock lang="bash">{`# 1. Register the agent key
curl -X POST https://furlpay.com/api/agents/keys \\
  -H "content-type: application/json" \\
  -d '{"publicKeyPem": "-----BEGIN PUBLIC KEY-----\\n…"}'
# → { "keyId": "ak_tWLNNMkyM5S6PM…" }

# 2. Signed escrow hold (headers from signRequest)
curl -X POST https://furlpay.com/api/escrow \\
  -H "content-type: application/json" \\
  -H "content-digest: sha-256=:…:" \\
  -H "signature-input: furlpay=(\\"@method\\" \\"@target-uri\\" \\"content-digest\\");…" \\
  -H "signature: furlpay=:…:" \\
  -d '{"action":"create","cardId":"card_x","merchant":"Estadio Azteca","amount":180}'
# → { "hold": { … }, "agentKeyId": "ak_tWLNNMkyM5S6PM…" }`}</CodeBlock>

      <Callout title="Why this matters in 2026">
        Visa&apos;s TAP executed its first live agentic transactions at European merchants in July 2026;
        Mastercard Agent Pay and the x402 Foundation (Linux Foundation — Visa, Mastercard, Amex, Stripe
        members) all converge on the same idea: signed agent identity + user mandates. Furlpay ships an
        MIT-licensed implementation you can run today — zero dependencies, Ed25519 via node:crypto,
        30-test suite (mandates, capability tokens, RFC 9421). <Code>npm i @furlpay/agent-trust</Code>
      </Callout>

      <DocPager pathname="/docs/payments/agent-trust" />
    </article>
  );
}
