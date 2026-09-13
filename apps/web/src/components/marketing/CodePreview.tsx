"use client";

import { useState } from "react";

// Split-pane developer preview: a TypeScript card-issuance call on the left and
// the mock JSON response on the right. Clicking "Run" simulates the round-trip.
const RESPONSE = `{
  "id": "card_virtual_9f21",
  "kind": "virtual",
  "network": "Visa",
  "last4": "4417",
  "currency": "USD",
  "status": "active",
  "controls": {
    "perPurchase": 2500,
    "daily": 5000
  },
  "safe": "0x7A9f…c31E",
  "signing_policy": "client+server+enclave",
  "createdAt": "2026-07-01T10:04:22Z"
}`;

export default function CodePreview() {
  const [state, setState] = useState<"idle" | "running" | "done">("idle");

  function run() {
    setState("running");
    setTimeout(() => setState("done"), 650);
  }

  return (
    <div className="glow-border overflow-hidden">
      <div className="grid grid-cols-1 md:grid-cols-2">
        {/* Left: request */}
        <div className="border-b border-white/10 md:border-b-0 md:border-r">
          <PaneHeader label="issue-card.ts">
            <button
              onClick={run}
              disabled={state === "running"}
              className="rounded-full bg-neon px-3 py-1 text-[11px] font-semibold text-black disabled:opacity-60"
            >
              {state === "running" ? "Running…" : "Run ▷"}
            </button>
          </PaneHeader>
          <pre className="overflow-x-auto p-5 text-[12.5px] leading-relaxed">
            <code>
              <Tok c="mut">import</Tok> {"{ Furlpay }"} <Tok c="mut">from</Tok> <Tok c="str">
                &apos;@furlpay/node&apos;
              </Tok>;{"\n\n"}
              <Tok c="mut">const</Tok> <Tok c="var">furlpay</Tok> = <Tok c="mut">new</Tok>{" "}
              <Tok c="fn">Furlpay</Tok>(<Tok c="str">&apos;sk_test_123&apos;</Tok>);{"\n\n"}
              <Tok c="mut">const</Tok> <Tok c="var">card</Tok> = <Tok c="mut">await</Tok>{" "}
              <Tok c="var">furlpay</Tok>.<Tok c="var">cards</Tok>.<Tok c="fn">issue</Tok>({"{"}
              {"\n"}  kind: <Tok c="str">&apos;virtual&apos;</Tok>,{"\n"}  currency:{" "}
              <Tok c="str">&apos;USD&apos;</Tok>,{"\n"}  controls: {"{ perPurchase: "}
              <Tok c="num">2500</Tok>, daily: <Tok c="num">5000</Tok> {"}"},{"\n"}
              {"});"}
            </code>
          </pre>
        </div>

        {/* Right: response */}
        <div className="bg-black/40">
          <PaneHeader label="200 OK · response.json">
            <span className={`h-2 w-2 rounded-full ${state === "done" ? "bg-neon" : "bg-white/25"}`} />
          </PaneHeader>
          <pre className="min-h-[220px] overflow-x-auto p-5 text-[12.5px] leading-relaxed text-neon/90">
            <code>
              {state === "idle" && <span className="text-textMuted">{"// press Run ▷ to issue a card"}</span>}
              {state === "running" && <span className="text-textMuted">{"// clearing signing policy gates…"}</span>}
              {state === "done" && RESPONSE}
            </code>
          </pre>
        </div>
      </div>
    </div>
  );
}

function PaneHeader({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
        <span className="text-[11px] text-textSecondary">{label}</span>
      </div>
      {children}
    </div>
  );
}

const COLORS: Record<string, string> = {
  mut: "text-[#c792ea]",
  str: "text-[#c3e88d]",
  fn: "text-[#82aaff]",
  var: "text-white",
  num: "text-[#f78c6c]",
};

function Tok({ c, children }: { c: keyof typeof COLORS | string; children: React.ReactNode }) {
  return <span className={COLORS[c] ?? "text-white"}>{children}</span>;
}
