"use client";

/*
 * API playground — five tabs, request on the left, response on the right.
 *
 * Honesty rule for this component: a response pane is labelled either
 * "Example response" (a documented shape, not a call) or "Live response" (this
 * deployment actually answered). The Agents tab is live — /api/x402/fx is a
 * public, unauthenticated endpoint that returns a real HTTP 402 payment
 * challenge, which is the single most convincing thing this API does. The
 * other four need an authenticated account, so they show documented shapes and
 * say so rather than faking a round-trip with setTimeout.
 */

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { Check, Copy, ExternalLink, Play } from "lucide-react";
import { code as hlCode, json as hlJson } from "./highlight";

interface Tab {
  id: string;
  label: string;
  file: string;
  snippet: string;
  docs: string;
  /** Present when "Try it" performs a real, public, unauthenticated request. */
  live?: { method: "GET"; path: string };
  example: string;
}

const TABS: Tab[] = [
  {
    id: "payments",
    label: "Payments",
    file: "payment.ts",
    docs: "/docs/payments/agentic-x402",
    snippet: `import { Furlpay } from '@furlpay/furlpay-node';

const furlpay = new Furlpay(process.env.FURLPAY_API_KEY);

const payment = await furlpay.payments.create({
  amount: '100.00',
  currency: 'USDC',
  chain: 'arbitrum',
  recipient: 'merchant@example.com'
});`,
    example: `{
  "id": "pay_3f81c2",
  "status": "settled",
  "amount": "100.00",
  "currency": "USDC",
  "chain": "arbitrum",
  "recipient": "merchant@example.com",
  "settlementTx": "0x9c4a…d21f"
}`,
  },
  {
    id: "cards",
    label: "Cards",
    file: "issue-card.ts",
    docs: "/docs",
    snippet: `const card = await furlpay.cards.issue({
  kind: 'virtual',
  currency: 'USD',
  controls: {
    perPurchase: 2500,
    daily: 5000
  }
});`,
    example: `{
  "id": "card_virtual_9f21",
  "kind": "virtual",
  "last4": "4417",
  "currency": "USD",
  "status": "active",
  "controls": { "perPurchase": 2500, "daily": 5000 },
  "mpc": "2-of-2"
}`,
  },
  {
    id: "accounts",
    label: "Accounts",
    file: "accounts.ts",
    docs: "/docs/architecture/api-routes",
    snippet: `const account = await furlpay.accounts.create({
  handle: 'acme',
  assets: ['USDC', 'EURC']
});

const balances = await furlpay.accounts
  .balances(account.id);`,
    example: `{
  "id": "acct_7d1e",
  "handle": "acme.furlpay.com",
  "custody": "non-custodial",
  "balances": [
    { "asset": "USDC", "chain": "arbitrum", "amount": "1240.00" },
    { "asset": "EURC", "chain": "base", "amount": "310.55" }
  ]
}`,
  },
  {
    id: "agents",
    label: "Agents",
    file: "x402.sh",
    docs: "/docs/payments/agentic-x402",
    live: { method: "GET", path: "/api/x402/fx?from=USD&to=EUR&amount=100" },
    snippet: `# An agent buys one FX quote for $0.01 USDC.
# No account, no API key — just HTTP 402.

curl -i https://furlpay.com/api/x402/fx\\
  ?from=USD&to=EUR&amount=100

# 402 Payment Required -> sign EIP-3009 ->
# retry with X-PAYMENT -> 200 + the quote.`,
    example: `// Press "Try it" — this calls the real endpoint.`,
  },
  {
    id: "travel",
    label: "Travel",
    file: "travel.ts",
    docs: "/docs/payments/travels-mcp",
    snippet: `const stays = await furlpay.travel.search({
  destination: 'Lisbon',
  checkIn: '2026-09-12',
  nights: 3,
  payWith: 'USDC'
});`,
    example: `{
  "query": { "destination": "Lisbon", "nights": 3 },
  "payWith": "USDC",
  "results": [
    { "id": "stay_41c8", "name": "Baixa House", "total": "486.00" },
    { "id": "stay_9a02", "name": "Alfama Loft",  "total": "312.40" }
  ]
}`,
  },
];

type RunState = { status: "idle" } | { status: "running" } | { status: "done"; code: number; body: string };

export default function ApiPlayground() {
  const [activeId, setActiveId] = useState(TABS[0].id);
  const [run, setRun] = useState<RunState>({ status: "idle" });
  const [copied, setCopied] = useState(false);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const active = TABS.find((t) => t.id === activeId) ?? TABS[0];

  const select = useCallback((id: string) => {
    setActiveId(id);
    setRun({ status: "idle" });
  }, []);

  // Roving tab focus — arrow keys move between tabs, as a tablist should.
  const onTabKeyDown = (e: React.KeyboardEvent, index: number) => {
    const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = (index + delta + TABS.length) % TABS.length;
    select(TABS[next].id);
    tabRefs.current[next]?.focus();
  };

  async function tryIt() {
    if (!active.live) return;
    setRun({ status: "running" });
    try {
      const res = await fetch(active.live.path, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(8000),
        cache: "no-store",
      });
      const text = await res.text();
      let body = text;
      try {
        body = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        /* not JSON — show it raw rather than pretending it parsed */
      }
      setRun({ status: "done", code: res.status, body: body.slice(0, 1600) });
    } catch (err) {
      setRun({
        status: "done",
        code: 0,
        body: `// request failed: ${err instanceof Error ? err.message : "unknown error"}`,
      });
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(active.snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — the snippet is selectable, so this is not fatal */
    }
  }

  const responseLabel =
    run.status === "done"
      ? `${run.code || "—"} · live response`
      : active.live
        ? "live · press Try it"
        : "example response";

  return (
    <div className="overflow-hidden rounded-card border border-white/[0.08] bg-white/[0.02]">
      {/* ── Tabs ──────────────────────────────────────────────────────── */}
      <div
        aria-label="API examples"
        className="no-scrollbar flex gap-1 overflow-x-auto border-b border-white/[0.07] p-2"
        role="tablist"
      >
        {TABS.map((tab, i) => (
          <button
            aria-controls={`panel-${tab.id}`}
            aria-selected={tab.id === activeId}
            className={`shrink-0 rounded-lg px-3.5 py-2 text-[13px] font-semibold transition-colors ${
              tab.id === activeId
                ? "bg-neon/[0.12] text-neon"
                : "text-textSecondary hover:bg-white/[0.04] hover:text-white"
            }`}
            id={`tab-${tab.id}`}
            key={tab.id}
            onClick={() => select(tab.id)}
            onKeyDown={(e) => onTabKeyDown(e, i)}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            role="tab"
            tabIndex={tab.id === activeId ? 0 : -1}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div
        aria-labelledby={`tab-${active.id}`}
        className="grid grid-cols-1 md:grid-cols-2"
        id={`panel-${active.id}`}
        role="tabpanel"
        tabIndex={0}
      >
        {/* ── Request ─────────────────────────────────────────────────── */}
        <div className="border-b border-white/[0.07] md:border-b-0 md:border-r">
          <div className="flex items-center justify-between gap-2 border-b border-white/[0.07] px-4 py-2.5">
            <span className="font-mono text-[11px] text-textSecondary">{active.file}</span>
            <div className="flex items-center gap-1.5">
              <button
                className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-textSecondary transition-colors hover:border-white/25 hover:text-white"
                onClick={copy}
                type="button"
              >
                {copied ? <Check aria-hidden className="h-3 w-3 text-neon" /> : <Copy aria-hidden className="h-3 w-3" />}
                {copied ? "Copied" : "Copy"}
              </button>
              {active.live && (
                <button
                  className="inline-flex items-center gap-1.5 rounded-full bg-neon px-2.5 py-1 text-[11px] font-semibold text-black disabled:opacity-60"
                  disabled={run.status === "running"}
                  onClick={tryIt}
                  type="button"
                >
                  <Play aria-hidden className="h-3 w-3" />
                  {run.status === "running" ? "Running…" : "Try it"}
                </button>
              )}
            </div>
          </div>
          <pre className="overflow-x-auto p-5 text-[12.5px] leading-relaxed">
            <code>{hlCode(active.snippet)}</code>
          </pre>
        </div>

        {/* ── Response ────────────────────────────────────────────────── */}
        <div className="bg-black/40">
          <div className="flex items-center justify-between gap-2 border-b border-white/[0.07] px-4 py-2.5">
            <span className="font-mono text-[11px] text-textSecondary">{responseLabel}</span>
            <Link
              className="inline-flex items-center gap-1 text-[11px] text-textSecondary transition-colors hover:text-neon"
              href={active.docs}
            >
              Open in docs
              <ExternalLink aria-hidden className="h-3 w-3" />
            </Link>
          </div>
          <pre className="min-h-[240px] overflow-x-auto p-5 text-[12.5px] leading-relaxed" aria-live="polite">
            <code>
              {run.status === "running"
                ? hlCode("// calling /api/x402/fx …")
                : run.status === "done"
                  ? hlJson(run.body)
                  : // The live tab's placeholder is a comment, not JSON.
                    (active.live ? hlCode : hlJson)(active.example)}
            </code>
          </pre>
        </div>
      </div>
    </div>
  );
}
