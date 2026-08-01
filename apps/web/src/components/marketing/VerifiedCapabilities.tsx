/**
 * VERIFIED CAPABILITIES — every row anchored to a route that exists.
 *
 * WHY THIS COMPONENT EXISTS. On 22 Jul 2026 an audit of this repo found a
 * banking module whose eight "integrated" endpoints returned AWS API Gateway's
 * unmatched-route error, FX rates that were hardcoded but stamped with a live
 * timestamp, and marketing copy offering to "instantly connect" to banks that
 * were sandbox descriptors. None of it was malicious; each step was individually
 * plausible and nobody checked the layer below.
 *
 * The fix is structural rather than editorial: a claim on the marketing surface
 * carries the path that substantiates it. A reader can verify any line, and an
 * author cannot add a line without naming what backs it.
 *
 * THE RULE. `path` must resolve in this repo. If a capability is real but not
 * yet exercised end-to-end against a live counterparty, it belongs in ROADMAP
 * below with the gate stated plainly — not here with a hedge.
 *
 * Deliberately absent, and why:
 *   - FATF Rec 10/15/16 "alignment". A public compliance claim, and Travel Rule
 *     alignment means messages actually reach counterparty VASPs. The route
 *     exists; a live message has not been sent. Roadmap.
 *   - Per-check compliance pricing. Listing a price is an offer to sell; the
 *     provider is not provisioned.
 *   - SAMA / HKMA sandbox references. FurlPay is in neither.
 *   - Named bank integrations. Sandbox descriptors, not connections.
 */

type Capability = {
  title: string;
  body: string;
  /** Route or module in this repo that substantiates the claim. */
  path: string;
};

const LIVE: Capability[] = [
  {
    title: "Agent spend control plane",
    body: "Owned agent keys with enforced per-agent policies. Money-moving tools return an approval URL requiring human passkey confirmation — the model proposes, the human disposes.",
    path: "/api/agents/keys · lib/agentPolicy.ts · lib/mcp/tools.ts",
  },
  {
    title: "x402 settlement",
    body: "HTTP 402 payment-required flow with EIP-3009 authorization, facilitator verify/settle, and policy evaluation before funds move.",
    path: "/api/x402/facilitator/settle · lib/x402Settler.ts",
  },
  {
    title: "MCP server for autonomous agents",
    body: "Model Context Protocol server exposing tools, resources and prompts over JSON-RPC, with OAuth 2.1 and DPoP-bound tokens.",
    path: "/api/mcp · lib/mcp/oauth.ts · lib/mcp/dpop.ts",
  },
  {
    title: "Hong Kong bank directory",
    body: "Live branch and ATM data covering 20 licensed banks, published by the Hong Kong Monetary Authority. Fails closed: an upstream error returns 502, never an empty list.",
    path: "/api/banking/directory · lib/hkma.ts",
  },
  {
    title: "Corporate actions ledger",
    body: "Splits, dividends with withholding and DRIP, mergers, spin-offs and delistings. Projection is pure and cannot credit cash; settlement is a separate, idempotent step.",
    path: "lib/corporateActions/ · lib/ledger.ts",
  },
  {
    title: "Rail registry",
    body: "One descriptor per payment rail — protocol, chains, asset, fee model, per-transaction cap — merged with live operational status. Execution paths stay independent by design.",
    path: "/api/rails · lib/rails/registry.ts",
  },
  {
    title: "Passkey-first security",
    body: "WebAuthn authentication with step-up challenges on money movement, and a route manifest enforcing the auth posture of every endpoint in CI.",
    path: "lib/webauthn.ts · security/route-manifest.json",
  },
];

/** Real work, not yet exercised against a live counterparty. The gate is stated. */
const ROADMAP: Capability[] = [
  {
    title: "Travel Rule messaging",
    body: "Route and provider integration are written. Pending: a provisioned VASP account and a verified live message exchange.",
    path: "/api/compliance/travel-rule",
  },
  {
    title: "Bank API connectors",
    body: "Provider comparison data is in place. Pending: production credentials and a signed agreement per institution. The previous HSBC sandbox client was deleted on 23 Jul 2026 — its endpoints returned API Gateway's unmatched-route error, so it described connections that did not exist.",
    path: "components/banking/BankingHub.tsx (comparison data only)",
  },
  {
    title: "Production settlement",
    body: "Settlement is proven end-to-end in a local environment with real on-chain transfers. Pending: production fee-payer and RPC configuration.",
    path: "docs/GO-LIVE-MONEY.md",
  },
];

function Row({ c, live }: { c: Capability; live: boolean }) {
  return (
    <li className="border-b border-white/5 py-4 last:border-0">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${live ? "bg-emerald-400" : "bg-amber-400/70"}`}
        />
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-white">{c.title}</h4>
          <p className="mt-1 text-sm leading-relaxed text-slate-400">{c.body}</p>
          <code className="mt-2 block break-words font-mono text-[11px] text-slate-500">{c.path}</code>
        </div>
      </div>
    </li>
  );
}

export default function VerifiedCapabilities() {
  return (
    <section className="mx-auto max-w-3xl px-6 py-16">
      <h2 className="text-2xl font-semibold tracking-tight text-white">What is actually running</h2>
      <p className="mt-2 text-sm text-slate-400">
        Each capability below names the route or module that implements it, so any claim on this page can be
        checked rather than taken on trust.
      </p>

      <h3 className="mt-10 text-xs font-semibold uppercase tracking-wider text-emerald-400">Live</h3>
      <ul className="mt-2">
        {LIVE.map((c) => (
          <Row key={c.title} c={c} live />
        ))}
      </ul>

      <h3 className="mt-10 text-xs font-semibold uppercase tracking-wider text-amber-400/90">
        Built, not yet exercised
      </h3>
      <p className="mt-1 text-xs text-slate-500">
        Written and typechecked, but not yet run against a live counterparty. Listed separately rather than
        blended into the section above.
      </p>
      <ul className="mt-2">
        {ROADMAP.map((c) => (
          <Row key={c.title} c={c} live={false} />
        ))}
      </ul>
    </section>
  );
}
